use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::AuthUser, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/batches",         post(prepare))
        .route("/batches/confirm", post(confirm))
        .route("/batches",         get(list))
        .route("/batches/:id",     get(detail))
}

// ── Request / Response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RecipientInput {
    pub wallet:      String,
    pub amount:      i64,
    pub name:        Option<String>,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct PrepareRequest {
    pub recipients:   Vec<RecipientInput>,
    pub mint_address: String,
    pub notes:        Option<String>,
}

#[derive(Serialize)]
pub struct PreparedAta {
    pub wallet:      String,
    pub ata_address: String,
    pub ata_exists:  bool,
}

#[derive(Serialize)]
pub struct PrepareResponse {
    pub batch_id:    Uuid,
    pub atas:        Vec<PreparedAta>, // ordered — use directly as remaining_accounts
    pub total_amount: i64,
}

#[derive(Deserialize)]
pub struct ConfirmRequest {
    pub batch_id:     Uuid,
    pub tx_signature: String,
}

#[derive(Serialize)]
pub struct ConfirmResponse {
    pub batch_id:     Uuid,
    pub tx_signature: String,
}

#[derive(Serialize)]
pub struct BatchSummary {
    pub id:              Uuid,
    pub tx_signature:    Option<String>,
    pub status:          String,
    pub total_amount:    i64,
    pub recipient_count: i32,
    pub mint_address:    String,
    pub notes:           Option<String>,
    pub created_at:      chrono::DateTime<chrono::Utc>,
    pub confirmed_at:    Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize)]
pub struct BatchItem {
    pub id:            Uuid,
    pub wallet_pubkey: String,
    pub name:          Option<String>,
    pub description:   Option<String>,
    pub amount:        i64,
    pub ata_address:   Option<String>,
}

#[derive(Serialize)]
pub struct BatchDetail {
    pub batch:  BatchSummary,
    pub items:  Vec<BatchItem>,
}

// ── POST /batches — prepare a bulk transfer ───────────────────────────────────

pub async fn prepare(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Json(body): Json<PrepareRequest>,
) -> Result<Json<PrepareResponse>, (StatusCode, String)> {
    let total_amount: i64 = body.recipients.iter().map(|r| r.amount).sum();
    let recipient_count = body.recipients.len() as i32;

    // 1. Create a pending batch record
    let batch_id = sqlx::query_scalar!(
        "INSERT INTO batches
             (sender_pubkey, status, total_amount, recipient_count, mint_address, notes)
         VALUES ($1, 'pending', $2, $3, $4, $5)
         RETURNING id",
        wallet,
        total_amount,
        recipient_count,
        body.mint_address,
        body.notes,
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 2. Derive ATAs and check existence via RPC
    let mint_pubkey = body.mint_address.parse::<solana_sdk::pubkey::Pubkey>()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid mint address".to_string()))?;

    let token_program = spl_associated_token_account::id();
    let mut atas: Vec<PreparedAta> = Vec::with_capacity(body.recipients.len());

    for recipient in &body.recipients {
        let owner = recipient.wallet.parse::<solana_sdk::pubkey::Pubkey>()
            .map_err(|_| (StatusCode::BAD_REQUEST,
                format!("Invalid wallet address: {}", recipient.wallet)))?;

        let ata = spl_associated_token_account::get_associated_token_address_with_program_id(
            &owner,
            &mint_pubkey,
            &token_program,
        );

        // Check if ATA exists
        let ata_exists = state.rpc
            .get_account(&ata)
            .is_ok();

        // Insert batch item
        sqlx::query!(
            "INSERT INTO batch_items
                 (batch_id, wallet_pubkey, name, description, amount, ata_address, ata_exists)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
            batch_id,
            recipient.wallet,
            recipient.name,
            recipient.description,
            recipient.amount,
            ata.to_string(),
            ata_exists,
        )
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        atas.push(PreparedAta {
            wallet:      recipient.wallet.clone(),
            ata_address: ata.to_string(),
            ata_exists,
        });
    }

    Ok(Json(PrepareResponse { batch_id, atas, total_amount }))
}

// ── POST /batches/confirm ─────────────────────────────────────────────────────

pub async fn confirm(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Json(body): Json<ConfirmRequest>,
) -> Result<Json<ConfirmResponse>, (StatusCode, String)> {
    let result = sqlx::query!(
        "UPDATE batches
         SET status       = 'confirmed',
             tx_signature = $1,
             confirmed_at = now()
         WHERE id            = $2
           AND sender_pubkey = $3
           AND status        = 'pending'",
        body.tx_signature,
        body.batch_id,
        wallet,
    )
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND,
            "Batch not found or already confirmed".to_string()));
    }

    Ok(Json(ConfirmResponse {
        batch_id:     body.batch_id,
        tx_signature: body.tx_signature,
    }))
}

// ── GET /batches ──────────────────────────────────────────────────────────────

pub async fn list(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
) -> Result<Json<Vec<BatchSummary>>, (StatusCode, String)> {
    let rows = sqlx::query_as!(
        BatchSummary,
        "SELECT id, tx_signature, status, total_amount, recipient_count,
                mint_address, notes, created_at, confirmed_at
         FROM batches
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

// ── GET /batches/:id ──────────────────────────────────────────────────────────

pub async fn detail(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<BatchDetail>, (StatusCode, String)> {
    let batch = sqlx::query_as!(
        BatchSummary,
        "SELECT id, tx_signature, status, total_amount, recipient_count,
                mint_address, notes, created_at, confirmed_at
         FROM batches
         WHERE id = $1 AND sender_pubkey = $2",
        id,
        wallet,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Batch not found".to_string()))?;

    let items = sqlx::query_as!(
        BatchItem,
        "SELECT id, wallet_pubkey, name, description, amount, ata_address
         FROM batch_items
         WHERE batch_id = $1
         ORDER BY created_at ASC",
        id,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(BatchDetail { batch, items }))
}
