use sha2::Digest;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use std::time::Duration;

use crate::AppState;

const POLL_INTERVAL_SECS: u64 = 60;
const MAX_RETRIES: i32 = 3;
use solana_client::rpc_config::RpcSendTransactionConfig;
use solana_sdk::{instruction::Instruction, signer::Signer, transaction::Transaction};
use spl_associated_token_account::{
    get_associated_token_address_with_program_id,
    instruction::create_associated_token_account_idempotent,
};

const ATA_BATCH_SIZE: usize = 20;

// ── Scheduler entry point ─────────────────────────────────────────────────────

pub async fn run(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(POLL_INTERVAL_SECS));
    tracing::info!("Scheduler started — polling every {}s", POLL_INTERVAL_SECS);

    loop {
        interval.tick().await;
        tracing::debug!("Scheduler tick — checking for due batches");

        match find_and_execute_due(&state).await {
            Ok(count) if count > 0 => tracing::info!("Scheduler executed {} batch(es)", count),
            Ok(_) => {}
            Err(e) => tracing::error!("Scheduler loop error: {e}"),
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
                Ok(k) => k,
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
    state: &AppState,
    batch_id: uuid::Uuid,
    recipients: &serde_json::Value,
) -> anyhow::Result<String> {
    // 1. Deserialise recipients from JSONB
    #[derive(serde::Deserialize)]
    struct RecipientEntry {
        wallet: String,
        amount: i64,
    }

    let entries: Vec<RecipientEntry> = serde_json::from_value(recipients.clone())
        .map_err(|e| anyhow::anyhow!("Failed to deserialise recipients: {e}"))?;

    if entries.is_empty() {
        return Err(anyhow::anyhow!("No recipients in batch"));
    }

    // 2. Parse keys
    let mint_address = sqlx::query_scalar!(
        "SELECT mint_address FROM scheduled_batches WHERE id = $1",
        batch_id,
    )
    .fetch_one(&state.db)
    .await?;

    let sender_pubkey = sqlx::query_scalar!(
        "SELECT sender_pubkey FROM scheduled_batches WHERE id = $1",
        batch_id,
    )
    .fetch_one(&state.db)
    .await?;

    let mint = Pubkey::from_str(&mint_address)?;
    let sender = Pubkey::from_str(&sender_pubkey)?;
    let token_prog = spl_token::id();
    let executor = &state.executor_keypair;

    // 3. Derive ATAs for all recipients
    let mut wallets: Vec<Pubkey> = Vec::with_capacity(entries.len());
    let mut atas: Vec<Pubkey> = Vec::with_capacity(entries.len());
    let mut amounts: Vec<u64> = Vec::with_capacity(entries.len());

    for entry in &entries {
        let wallet = Pubkey::from_str(&entry.wallet)
            .map_err(|_| anyhow::anyhow!("Invalid wallet: {}", entry.wallet))?;
        let ata = get_associated_token_address_with_program_id(&wallet, &mint, &token_prog);
        wallets.push(wallet);
        atas.push(ata);
        amounts.push(entry.amount as u64);
    }

    // 4. Pre-ATA pass — create missing ATAs in batches of 20
    // Check existence first using getMultipleAccounts (one RPC call)
    let ata_infos = state.rpc.get_multiple_accounts(&atas)?;

    let missing_ixs: Vec<Instruction> = atas
        .iter()
        .zip(wallets.iter())
        .zip(ata_infos.iter())
        .filter(|(_, info)| info.is_none())
        .map(|((ata, wallet), _)| {
            create_associated_token_account_idempotent(
                &executor.pubkey(),
                wallet,
                &mint,
                &token_prog,
            )
        })
        .collect();

    if !missing_ixs.is_empty() {
        for chunk in missing_ixs.chunks(ATA_BATCH_SIZE) {
            let blockhash = state.rpc.get_latest_blockhash()?;
            let tx = Transaction::new_signed_with_payer(
                chunk,
                Some(&executor.pubkey()),
                &[executor.as_ref()],
                blockhash,
            );
            state.rpc.send_and_confirm_transaction(&tx)?;
        }
    }

    // 5. Fetch schedule PDA from DB
    let created_at_seed = sqlx::query_scalar!(
        "SELECT created_at_seed FROM scheduled_batches WHERE id = $1",
        batch_id,
    )
    .fetch_one(&state.db)
    .await?
    .ok_or_else(|| anyhow::anyhow!("created_at_seed is null for batch {}", batch_id))?;

    let mut seed_buf = [0u8; 8];
    seed_buf.copy_from_slice(&created_at_seed.to_le_bytes());

    let program_id = Pubkey::from_str(
        &std::env::var("PROGRAM_ID")
            .unwrap_or_else(|_| "Bh6ADbE6SmBjta1YYSGvMp3i4Tqomey9NcFdpgHJAhpT".to_string()),
    )?;

    let (schedule_pda, _) =
        Pubkey::find_program_address(&[b"schedule", sender.as_ref(), &seed_buf], &program_id);

    // Derive PDAs needed by execute_schedule
    let (user_account_pda, _) =
        Pubkey::find_program_address(&[b"useraccount", sender.as_ref()], &program_id);
    let (transfer_log_pda, _) =
        Pubkey::find_program_address(&[b"transferlog", sender.as_ref()], &program_id);
    let (delegation_pda, _) = Pubkey::find_program_address(
        &[b"delegation", sender.as_ref(), mint.as_ref()],
        &program_id,
    );
    let (scheduler_authority, _) =
        Pubkey::find_program_address(&[b"scheduler_authority"], &program_id);

    let sender_ata = get_associated_token_address_with_program_id(&sender, &mint, &token_prog);

    // 6. Build execute_schedule instruction accounts
    // remaining_accounts = ATAs only (Option B — wallet read from ATA bytes 32..64)
    let mut account_metas = vec![
        solana_sdk::instruction::AccountMeta::new(executor.pubkey(), true),
        solana_sdk::instruction::AccountMeta::new_readonly(sender, false),
        solana_sdk::instruction::AccountMeta::new(schedule_pda, false),
        solana_sdk::instruction::AccountMeta::new_readonly(delegation_pda, false),
        solana_sdk::instruction::AccountMeta::new(sender_ata, false),
        solana_sdk::instruction::AccountMeta::new(transfer_log_pda, false),
        solana_sdk::instruction::AccountMeta::new_readonly(mint, false),
        solana_sdk::instruction::AccountMeta::new_readonly(scheduler_authority, false),
        solana_sdk::instruction::AccountMeta::new_readonly(spl_token::id(), false),
        solana_sdk::instruction::AccountMeta::new_readonly(
            spl_associated_token_account::id(),
            false,
        ),
        solana_sdk::instruction::AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
    ];

    // Append ATAs as remaining_accounts
    for ata in &atas {
        account_metas.push(solana_sdk::instruction::AccountMeta::new(*ata, false));
    }

    // 7. Encode the instruction discriminator for execute_schedule
    // Anchor discriminator = first 8 bytes of sha256("global:execute_schedule")
    let discriminator = {
        let mut hasher = sha2::Sha256::new();
        hasher.update(b"global:execute_schedule");
        let result = hasher.finalize();
        result[..8].to_vec()
    };

    let ix = Instruction {
        program_id,
        accounts: account_metas,
        data: discriminator, // execute_schedule takes no extra args
    };

    // 8. Send and confirm
    let blockhash = state.rpc.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&executor.pubkey()),
        &[executor.as_ref()],
        blockhash,
    );

    let sig = state
        .rpc
        .send_and_confirm_transaction_with_spinner_and_config(
            &tx,
            state.rpc.commitment(),
            RpcSendTransactionConfig {
                skip_preflight: false,
                ..Default::default()
            },
        )?;

    Ok(sig.to_string())
}

// ── Compute next run timestamp ────────────────────────────────────────────────

fn next_run_timestamp(
    recurrence: &str,
    runs_completed: i32,
    max_runs: i32,
) -> Option<chrono::DateTime<chrono::Utc>> {
    // max_runs = 0 means infinite
    if max_runs > 0 && runs_completed >= max_runs {
        return None; // schedule exhausted
    }

    let now = chrono::Utc::now();
    let next = match recurrence {
        "once" => return None, // one-shot — no next run
        "daily" => now + chrono::Duration::seconds(86_400),
        "weekly" => now + chrono::Duration::seconds(604_800),
        "monthly" => now + chrono::Duration::seconds(2_592_000), // 30 days
        _ => return None,
    };

    Some(next)
}

// ── Failure handling ──────────────────────────────────────────────────────────

async fn handle_failure(state: &AppState, batch_id: uuid::Uuid, retry_count: i32, error: &str) {
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
            batch_id,
            retry_count + 1,
            MAX_RETRIES,
            retry_at
        );
    } else {
        mark_failed(state, batch_id, error).await;
        tracing::error!(
            "Batch {} permanently failed after {} retries: {}",
            batch_id,
            MAX_RETRIES,
            error
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
