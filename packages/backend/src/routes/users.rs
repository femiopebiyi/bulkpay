use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

use crate::{auth::AuthUser, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/:wallet", get(get_user))
        .route("/users/me", put(update_name))
}

// ── Response type ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct UserProfile {
    pub wallet: String,
    pub display_name: Option<String>,
    pub all_time_sent: i64,    // from on-chain UserAccount PDA
    pub total_batches: i64,    // from DB
    pub total_recipients: i64, // from DB
    pub active_schedules: i64, // from DB
}

// ── GET /users/:wallet ────────────────────────────────────────────────────────

pub async fn get_user(
    State(state): State<AppState>,
    Path(wallet): Path<String>,
) -> Result<Json<UserProfile>, (StatusCode, String)> {
    // 1. Validate the wallet pubkey
    let pubkey = Pubkey::from_str(&wallet).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "Invalid wallet address".to_string(),
        )
    })?;

    // 2. Look up user in DB (may not exist for new users)
    let user_row = sqlx::query!("SELECT display_name FROM users WHERE wallet = $1", wallet,)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 3. Read UserAccount PDA on-chain for all_time_amount_sent
    //    Seeds: [b"useraccount", wallet.as_ref()]
    let program_id = Pubkey::from_str(
        std::env::var("PROGRAM_ID")
            .unwrap_or_else(|_| "Bh6ADbE6SmBjta1YYSGvMp3i4Tqomey9NcFdpgHJAhpT".to_string())
            .as_str(),
    )
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid program ID".to_string(),
        )
    })?;

    let (user_account_pda, _) =
        Pubkey::find_program_address(&[b"useraccount", pubkey.as_ref()], &program_id);

    let all_time_sent = match state
        .rpc
        .get_account_with_commitment(&user_account_pda, CommitmentConfig::confirmed())
    {
        Ok(response) => match response.value {
            Some(account) if account.data.len() >= 48 => {
                i64::from_le_bytes(account.data[40..48].try_into().unwrap_or([0u8; 8]))
            }
            _ => 0,
        },
        _ => 0,
    };
    // 4. Count batches from DB
    let total_batches = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM batches WHERE sender_pubkey = $1",
        wallet,
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .unwrap_or(0);

    // 5. Count total recipients across all batches
    let total_recipients = sqlx::query_scalar!(
        "SELECT COUNT(DISTINCT bi.wallet_pubkey)
     FROM batch_items bi
     JOIN batches b ON b.id = bi.batch_id
     WHERE b.sender_pubkey = $1
       AND b.status = 'confirmed'",
        wallet,
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .unwrap_or(0);

    // 6. Count active schedules
    let active_schedules = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM scheduled_batches
         WHERE sender_pubkey = $1
           AND status = 'pending'",
        wallet,
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .unwrap_or(0);

    Ok(Json(UserProfile {
        wallet,
        display_name: user_row.map(|r| r.display_name).flatten(),
        all_time_sent,
        total_batches: total_batches,
        total_recipients: total_recipients,
        active_schedules: active_schedules,
    }))
}

// ── PUT /users/me — update display name ───────────────────────────────────────

#[derive(Deserialize)]
pub struct UpdateNameRequest {
    pub display_name: String,
}

pub async fn update_name(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Json(body): Json<UpdateNameRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    sqlx::query!(
        "INSERT INTO users (wallet, display_name)
         VALUES ($1, $2)
         ON CONFLICT (wallet)
         DO UPDATE SET
             display_name = EXCLUDED.display_name,
             updated_at   = now()",
        wallet,
        body.display_name,
    )
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
