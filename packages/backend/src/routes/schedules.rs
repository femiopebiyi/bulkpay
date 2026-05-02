use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::AuthUser, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/schedules", get(list).post(create))
        .route("/schedules/:id", get(detail).delete(cancel))
        .route("/schedules/:id/history", get(history))
        .route("/delegate/instruction", get(delegate_instruction))
        .route(
            "/delegate",
            get(check_delegate)
                .post(register_delegate)
                .patch(update_delegate)
                .delete(revoke_delegate),
        )
}

#[derive(Serialize)]
pub struct DelegationStatus {
    pub active: bool,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub max_amount: Option<i64>,
}

#[derive(Deserialize)]
pub struct RegisterDelegateRequest {
    pub delegate_pda: String,
    pub mint_address: String,
    pub max_amount: i64,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
pub struct UpdateDelegateRequest {
    pub max_amount: i64,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
pub struct CreateScheduleRequest {
    pub schedule_pda: String,
    pub created_at_seed: i64,
    pub mint_address: String,
    pub recipients: Vec<ScheduledRecipientInput>,
    pub recurrence: String,
    pub scheduled_at: chrono::DateTime<chrono::Utc>,
    pub max_runs: i32,
    pub notes: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct ScheduledRecipientInput {
    pub wallet: String,
    pub amount: i64,
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Serialize)]
pub struct ScheduleListItem {
    pub id: Uuid,
    pub schedule_pda: String,
    pub created_at_seed: Option<i64>,
    pub mint_address: String,
    pub recipients: serde_json::Value,
    pub recurrence: String,
    pub scheduled_at: chrono::DateTime<chrono::Utc>,
    pub status: String,
    pub runs_completed: i32,
    pub max_runs: i32,
    pub last_error: Option<String>,
    pub tx_signature: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub confirmed_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize)]
pub struct DelegateInstructionResponse {
    pub message: String,
}

pub async fn check_delegate(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
) -> Result<Json<DelegationStatus>, (StatusCode, String)> {
    let row = sqlx::query!(
        "SELECT max_amount, expires_at FROM scheduler_delegations
         WHERE sender_pubkey = $1
           AND is_active     = true
           AND expires_at    > now()
         ORDER BY created_at DESC
         LIMIT 1",
        wallet,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(match row {
        Some(r) => DelegationStatus {
            active: true,
            expires_at: Some(r.expires_at),
            max_amount: Some(r.max_amount),
        },
        None => DelegationStatus {
            active: false,
            expires_at: None,
            max_amount: None,
        },
    }))
}

pub async fn register_delegate(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Json(body): Json<RegisterDelegateRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    sqlx::query!(
        "INSERT INTO scheduler_delegations
             (sender_pubkey, delegate_pda, mint_address, max_amount, expires_at, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (sender_pubkey, mint_address)
         DO UPDATE SET
             delegate_pda = EXCLUDED.delegate_pda,
             max_amount   = EXCLUDED.max_amount,
             expires_at   = EXCLUDED.expires_at,
             is_active    = true,
             revoked_at   = NULL",
        wallet,
        body.delegate_pda,
        body.mint_address,
        body.max_amount,
        body.expires_at,
    )
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn update_delegate(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Json(body): Json<UpdateDelegateRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let result = sqlx::query!(
        "UPDATE scheduler_delegations
         SET max_amount = $1,
             expires_at = $2,
             is_active  = true,
             revoked_at = NULL
         WHERE sender_pubkey = $3
           AND is_active     = true",
        body.max_amount,
        body.expires_at,
        wallet,
    )
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "No active delegation found to update".to_string(),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
) -> Result<Json<Vec<ScheduleListItem>>, (StatusCode, String)> {
    let rows = sqlx::query!(
        "SELECT id, schedule_pda, created_at_seed, mint_address, recipients,
                recurrence, scheduled_at, status, runs_completed, max_runs,
                last_error, tx_signature, created_at, confirmed_at
         FROM scheduled_batches
         WHERE sender_pubkey = $1
         ORDER BY scheduled_at ASC",
        wallet,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let schedules: Vec<ScheduleListItem> = rows
        .into_iter()
        .map(|r| ScheduleListItem {
            id: r.id,
            schedule_pda: r.schedule_pda,
            created_at_seed: r.created_at_seed,
            mint_address: r.mint_address,
            recipients: r.recipients,
            recurrence: r.recurrence,
            scheduled_at: r.scheduled_at,
            status: r.status,
            runs_completed: r.runs_completed,
            max_runs: r.max_runs,
            last_error: r.last_error,
            tx_signature: r.tx_signature,
            created_at: r.created_at,
            confirmed_at: r.confirmed_at,
        })
        .collect();

    Ok(Json(schedules))
}

pub async fn create(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Json(body): Json<CreateScheduleRequest>,
) -> Result<Json<ScheduleListItem>, (StatusCode, String)> {
    let valid = ["once", "daily", "weekly", "monthly"];
    if !valid.contains(&body.recurrence.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            "recurrence must be one of: once, daily, weekly, monthly".to_string(),
        ));
    }

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

    let row = sqlx::query!(
        "INSERT INTO scheduled_batches
         (sender_pubkey, schedule_pda, created_at_seed, delegation_id, mint_address,
          recipients, recurrence, scheduled_at, max_runs, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
         RETURNING id, schedule_pda, created_at_seed, mint_address, recipients,
                   recurrence, scheduled_at, status, runs_completed, max_runs,
                   last_error, tx_signature, created_at, confirmed_at",
        wallet,
        body.schedule_pda,
        body.created_at_seed,
        delegation.id,
        body.mint_address,
        recipients_json,
        body.recurrence,
        body.scheduled_at,
        body.max_runs,
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ScheduleListItem {
        id: row.id,
        schedule_pda: row.schedule_pda,
        created_at_seed: row.created_at_seed,
        mint_address: row.mint_address,
        recipients: row.recipients,
        recurrence: row.recurrence,
        scheduled_at: row.scheduled_at,
        status: row.status,
        runs_completed: row.runs_completed,
        max_runs: row.max_runs,
        last_error: row.last_error,
        tx_signature: row.tx_signature,
        created_at: row.created_at,
        confirmed_at: row.confirmed_at,
    }))
}

pub async fn detail(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ScheduleListItem>, (StatusCode, String)> {
    let row = sqlx::query!(
        "SELECT id, schedule_pda, created_at_seed, mint_address, recipients,
                recurrence, scheduled_at, status, runs_completed, max_runs,
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

    Ok(Json(ScheduleListItem {
        id: row.id,
        schedule_pda: row.schedule_pda,
        created_at_seed: row.created_at_seed,
        mint_address: row.mint_address,
        recipients: row.recipients,
        recurrence: row.recurrence,
        scheduled_at: row.scheduled_at,
        status: row.status,
        runs_completed: row.runs_completed,
        max_runs: row.max_runs,
        last_error: row.last_error,
        tx_signature: row.tx_signature,
        created_at: row.created_at,
        confirmed_at: row.confirmed_at,
    }))
}

pub async fn history(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<ScheduleListItem>>, (StatusCode, String)> {
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

    let rows = sqlx::query!(
        "SELECT id, schedule_pda, created_at_seed, mint_address, recipients,
                recurrence, scheduled_at, status, runs_completed, max_runs,
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

    let schedules: Vec<ScheduleListItem> = rows
        .into_iter()
        .map(|r| ScheduleListItem {
            id: r.id,
            schedule_pda: r.schedule_pda,
            created_at_seed: r.created_at_seed,
            mint_address: r.mint_address,
            recipients: r.recipients,
            recurrence: r.recurrence,
            scheduled_at: r.scheduled_at,
            status: r.status,
            runs_completed: r.runs_completed,
            max_runs: r.max_runs,
            last_error: r.last_error,
            tx_signature: r.tx_signature,
            created_at: r.created_at,
            confirmed_at: r.confirmed_at,
        })
        .collect();

    Ok(Json(schedules))
}

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

    Ok(StatusCode::NO_CONTENT)
}

pub async fn delegate_instruction(AuthUser(wallet): AuthUser) -> Json<DelegateInstructionResponse> {
    Json(DelegateInstructionResponse {
        message: format!(
            "Build and sign the delegate instruction client-side for wallet {}. \
             Call the on-chain delegate instruction, then POST /delegate to register.",
            wallet
        ),
    })
}

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
