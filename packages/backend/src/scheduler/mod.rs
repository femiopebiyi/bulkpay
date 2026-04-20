use std::time::Duration;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

use crate::AppState;

const POLL_INTERVAL_SECS: u64 = 60;
const MAX_RETRIES: i32 = 3;

// ── Scheduler entry point ─────────────────────────────────────────────────────

pub async fn run(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(POLL_INTERVAL_SECS));
    tracing::info!("Scheduler started — polling every {}s", POLL_INTERVAL_SECS);

    loop {
        interval.tick().await;
        tracing::debug!("Scheduler tick — checking for due batches");

        match find_and_execute_due(&state).await {
            Ok(count) if count > 0 => tracing::info!("Scheduler executed {} batch(es)", count),
            Ok(_)                  => {}
            Err(e)                 => tracing::error!("Scheduler loop error: {e}"),
        }
    }
}

// ── Find and execute all due scheduled batches ────────────────────────────────

async fn find_and_execute_due(state: &AppState) -> anyhow::Result<usize> {
    // Atomically claim pending rows — status = 'running' prevents double execution
    // if the loop fires twice before a slow execution finishes
    let due = sqlx::query!(
        "UPDATE scheduled_batches
         SET status = 'running'
         WHERE id IN (
             SELECT id FROM scheduled_batches
             WHERE status      = 'pending'
               AND scheduled_at <= now()
             ORDER BY scheduled_at ASC
             LIMIT 10
             FOR UPDATE SKIP LOCKED
         )
         RETURNING id, sender_pubkey, schedule_pda, mint_address,
                   recipients, recurrence, runs_completed, max_runs, retry_count",
    )
    .fetch_all(&state.db)
    .await?;

    let count = due.len();

    for batch in due {
        let state = state.clone();

        tokio::spawn(async move {
            let batch_id = batch.id;

            // Step 1 — Verify schedule account still exists on-chain
            // (handles cancellation race where close_schedule was called
            //  between our DB poll and now)
            let schedule_pda = match Pubkey::from_str(&batch.schedule_pda) {
                Ok(k)  => k,
                Err(e) => {
                    mark_failed(&state, batch_id, &e.to_string()).await;
                    return;
                }
            };

            if state.rpc.get_account(&schedule_pda).is_err() {
                tracing::warn!(
                    "Schedule {} account not found on-chain — likely cancelled. Marking cancelled.",
                    batch_id
                );
                let _ = sqlx::query!(
                    "UPDATE scheduled_batches SET status = 'cancelled' WHERE id = $1",
                    batch_id,
                )
                .execute(&state.db)
                .await;
                return;
            }

            // Step 2 — Execute the batch
            match execute_batch(&state, batch_id, &batch.recipients).await {
                Ok(sig) => {
                    tracing::info!("Batch {} confirmed: {}", batch_id, sig);

                    // Step 3 — Mark confirmed and schedule next run if recurring
                    let _ = sqlx::query!(
                        "UPDATE scheduled_batches
                         SET status        = 'confirmed',
                             tx_signature  = $1,
                             confirmed_at  = now(),
                             runs_completed = runs_completed + 1
                         WHERE id = $2",
                        sig,
                        batch_id,
                    )
                    .execute(&state.db)
                    .await;

                    // Step 4 — Insert next execution row if recurring
                    let next_run_at = next_run_timestamp(
                        &batch.recurrence,
                        batch.runs_completed + 1,
                        batch.max_runs,
                    );

                    if let Some(next_at) = next_run_at {
                        let _ = sqlx::query!(
                            "INSERT INTO scheduled_batches
                                 (sender_pubkey, schedule_pda, mint_address,
                                  recipients, recurrence, scheduled_at, max_runs, status)
                             SELECT sender_pubkey, schedule_pda, mint_address,
                                    recipients, recurrence, $1, max_runs, 'pending'
                             FROM scheduled_batches
                             WHERE id = $2",
                            next_at,
                            batch_id,
                        )
                        .execute(&state.db)
                        .await;
                    }
                }
                Err(e) => {
                    tracing::warn!("Batch {} failed: {}", batch_id, e);
                    handle_failure(&state, batch_id, batch.retry_count, &e.to_string()).await;
                }
            }
        });
    }

    Ok(count)
}

// ── Execute a single scheduled batch ─────────────────────────────────────────

async fn execute_batch(
    state:      &AppState,
    batch_id:   uuid::Uuid,
    _recipients: &serde_json::Value,
) -> anyhow::Result<String> {
    // TODO Phase 3 — build and send execute_schedule transaction:
    //
    // 1. Deserialise recipients from JSONB
    // 2. Derive ATAs for each wallet
    // 3. Pre-ATA pass — create_idempotent for missing ATAs
    // 4. Build execute_schedule versioned transaction
    // 5. Sign with executor keypair
    // 6. Send and confirm
    //
    // Returning a stub signature for now so the scheduler loop
    // compiles and runs — replace with real implementation in Phase 3

    tracing::info!("execute_batch called for {} — stub, returning placeholder", batch_id);
    Ok("STUB_SIGNATURE_REPLACE_IN_PHASE_3".to_string())
}

// ── Compute next run timestamp ────────────────────────────────────────────────

fn next_run_timestamp(
    recurrence:     &str,
    runs_completed: i32,
    max_runs:       i32,
) -> Option<chrono::DateTime<chrono::Utc>> {
    // max_runs = 0 means infinite
    if max_runs > 0 && runs_completed >= max_runs {
        return None; // schedule exhausted
    }

    let now = chrono::Utc::now();
    let next = match recurrence {
        "once"    => return None, // one-shot — no next run
        "daily"   => now + chrono::Duration::seconds(86_400),
        "weekly"  => now + chrono::Duration::seconds(604_800),
        "monthly" => now + chrono::Duration::seconds(2_592_000), // 30 days
        _         => return None,
    };

    Some(next)
}

// ── Failure handling ──────────────────────────────────────────────────────────

async fn handle_failure(
    state:       &AppState,
    batch_id:    uuid::Uuid,
    retry_count: i32,
    error:       &str,
) {
    if retry_count < MAX_RETRIES {
        // Retry in 1 hour — back off between attempts
        let retry_at = chrono::Utc::now() + chrono::Duration::hours(1);

        let _ = sqlx::query!(
            "UPDATE scheduled_batches
             SET status       = 'pending',
                 retry_count  = retry_count + 1,
                 scheduled_at = $1,
                 last_error   = $2
             WHERE id = $3",
            retry_at,
            error,
            batch_id,
        )
        .execute(&state.db)
        .await;

        tracing::warn!(
            "Batch {} scheduled for retry {} of {} at {}",
            batch_id, retry_count + 1, MAX_RETRIES, retry_at
        );
    } else {
        mark_failed(state, batch_id, error).await;
        tracing::error!(
            "Batch {} permanently failed after {} retries: {}",
            batch_id, MAX_RETRIES, error
        );
    }
}

async fn mark_failed(state: &AppState, batch_id: uuid::Uuid, error: &str) {
    let _ = sqlx::query!(
        "UPDATE scheduled_batches
         SET status     = 'failed',
             last_error = $1
         WHERE id = $2",
        error,
        batch_id,
    )
    .execute(&state.db)
    .await;
}
