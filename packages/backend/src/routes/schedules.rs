use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::AuthUser, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/schedules",             get(list).post(create))
        .route("/schedules/:id",         get(detail).delete(cancel))
        .route("/schedules/:id/history", get(history))
        .route("/delegate/instruction",  get(delegate_instruction))
        .route("/delegate",              delete(revoke_delegate))
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateScheduleRequest {
    pub schedule_pda: String,
    pub mint_address: String,
    pub recipients:   Vec<ScheduledRecipientInput>,
    pub recurrence:   String, // "once" | "daily" | "weekly" | "monthly"
    pub scheduled_at: chrono::DateTime<chrono::Utc>,
    pub max_runs:     i32,    // 0 = infinite, mirrors on-chain ScheduleAccount
    pub notes:        Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct ScheduledRecipientInput {
    pub wallet:      String,
    pub amount:      i64,
    pub name:        Option<String>,
    pub description: Option<String>,
}

#[derive(Serialize)]
pub struct ScheduleSummary {
    pub id:             Uuid,
    pub schedule_pda:   String,
    pub mint_address:   String,
    pub recurrence:     String,
    pub scheduled_at:   chrono::DateTime<chrono::Utc>,
    pub status:         String,
    pub runs_completed: i32,
    pub max_runs:       i32,
    pub last_error:     Option<String>,
    pub tx_signature:   Option<String>,
    pub created_at:     chrono::DateTime<chrono::Utc>,
    pub confirmed_at:   Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize)]
pub struct DelegateInstructionResponse {
    pub message: String,
}

// ── GET /schedules ────────────────────────────────────────────────────────────

pub async fn list(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
) -> Result<Json<Vec<ScheduleSummary>>, (StatusCode, String)> {
    let rows = sqlx::query_as!(
        ScheduleSummary,
        "SELECT id, schedule_pda, mint_address, recurrence,
                scheduled_at, status, runs_completed, max_runs,
                last_error, tx_signature, created_at, confirmed_at
         FROM scheduled_batches
         WHERE sender_pubkey = $1
         ORDER BY created_at DESC
         LIMIT 50",
        wallet,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(rows))
}

// ── POST /schedules ───────────────────────────────────────────────────────────

pub async fn create(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Json(body): Json<CreateScheduleRequest>,
) -> Result<Json<ScheduleSummary>, (StatusCode, String)> {
    let valid = ["once", "daily", "weekly", "monthly"];
    if !valid.contains(&body.recurrence.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            "recurrence must be one of: once, daily, weekly, monthly".to_string(),
        ));
    }

    // Verify active delegation exists for this sender + mint
    let delegation = sqlx::query!(
        "SELECT id FROM scheduler_delegations
         WHERE sender_pubkey = $1
           AND mint_address  = $2
           AND is_active     = true
           AND expires_at    > now()",
        wallet,
        body.mint_address,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((
        StatusCode::FORBIDDEN,
        "No active delegation found — call /delegate/instruction first".to_string(),
    ))?;

    let recipients_json = serde_json::to_value(&body.recipients)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // ✅ $8 = max_runs, $9 = 'pending' hardcoded as status
    let row = sqlx::query_as!(
        ScheduleSummary,
        "INSERT INTO scheduled_batches
             (sender_pubkey, schedule_pda, delegation_id, mint_address,
              recipients, recurrence, scheduled_at, max_runs, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
         RETURNING id, schedule_pda, mint_address, recurrence,
                   scheduled_at, status, runs_completed, max_runs,
                   last_error, tx_signature, created_at, confirmed_at",
        wallet,
        body.schedule_pda,
        delegation.id,
        body.mint_address,
        recipients_json,
        body.recurrence,
        body.scheduled_at,
        body.max_runs,   // ✅ was missing
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(row))
}

// ── GET /schedules/:id ────────────────────────────────────────────────────────

pub async fn detail(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ScheduleSummary>, (StatusCode, String)> {
    let row = sqlx::query_as!(
        ScheduleSummary,
        "SELECT id, schedule_pda, mint_address, recurrence,
                scheduled_at, status, runs_completed, max_runs,
                last_error, tx_signature, created_at, confirmed_at
         FROM scheduled_batches
         WHERE id = $1 AND sender_pubkey = $2",
        id,
        wallet,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Schedule not found".to_string()))?;

    Ok(Json(row))
}

// ── GET /schedules/:id/history ────────────────────────────────────────────────

pub async fn history(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<ScheduleSummary>>, (StatusCode, String)> {
    let schedule = sqlx::query_scalar!(
        "SELECT schedule_pda FROM scheduled_batches
         WHERE id = $1 AND sender_pubkey = $2",
        id,
        wallet,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Schedule not found".to_string()))?;

    let rows = sqlx::query_as!(
        ScheduleSummary,
        "SELECT id, schedule_pda, mint_address, recurrence,
                scheduled_at, status, runs_completed, max_runs,
                last_error, tx_signature, created_at, confirmed_at
         FROM scheduled_batches
         WHERE schedule_pda  = $1
           AND sender_pubkey = $2
         ORDER BY scheduled_at ASC",
        schedule,
        wallet,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(rows))
}

// ── DELETE /schedules/:id — cancel ───────────────────────────────────────────

pub async fn cancel(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let result = sqlx::query!(
        "UPDATE scheduled_batches
         SET status = 'cancelled'
         WHERE id            = $1
           AND sender_pubkey = $2
           AND status        = 'pending'",
        id,
        wallet,
    )
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "Schedule not found or already running/completed".to_string(),
        ));
    }

    // Frontend must also call close_schedule on-chain to emit
    // ScheduleCancelled event and reclaim rent
    Ok(StatusCode::NO_CONTENT)
}

// ── GET /delegate/instruction ─────────────────────────────────────────────────

pub async fn delegate_instruction(
    AuthUser(wallet): AuthUser,
) -> Json<DelegateInstructionResponse> {
    Json(DelegateInstructionResponse {
        message: format!(
            "Build and sign the delegate instruction client-side for wallet {}. \
             Call the on-chain delegate instruction, then POST /delegate to register.",
            wallet
        ),
    })
}

// ── DELETE /delegate — revoke ─────────────────────────────────────────────────

pub async fn revoke_delegate(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
) -> Result<StatusCode, (StatusCode, String)> {
    sqlx::query!(
        "UPDATE scheduler_delegations
         SET is_active  = false,
             revoked_at = now()
         WHERE sender_pubkey = $1
           AND is_active     = true",
        wallet,
    )
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
