use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::Signer;
use solana_sdk::transaction::Transaction;
use spl_associated_token_account::{
    get_associated_token_address_with_program_id,
    instruction::create_associated_token_account_idempotent,
};
use uuid::Uuid;

use crate::{auth::AuthUser, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/batches", post(prepare))
        .route("/batches/confirm", post(confirm))
        .route("/batches", get(list))
        .route("/batches/fail", post(fail))
        .route("/batches/:id", get(detail))
}

const ATA_BATCH_SIZE: usize = 20;

#[derive(Deserialize)]
pub struct RecipientInput {
    pub wallet: String,
    pub amount: i64,
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct PrepareRequest {
    pub recipients: Vec<RecipientInput>,
    pub mint_address: String,
    pub notes: Option<String>,
}

#[derive(Serialize)]
pub struct PreparedAta {
    pub wallet: String,
    pub ata_address: String,
    pub ata_exists: bool,
}

#[derive(Serialize)]
pub struct PrepareResponse {
    pub batch_id: Uuid,
    pub atas: Vec<PreparedAta>,
    pub total_amount: i64,
    pub atas_created: usize,
}

#[derive(Deserialize)]
pub struct ConfirmRequest {
    pub batch_id: Uuid,
    pub tx_signature: String,
}

#[derive(Serialize)]
pub struct ConfirmResponse {
    pub batch_id: Uuid,
    pub tx_signature: String,
}

#[derive(Serialize)]
pub struct BatchSummary {
    pub id: Uuid,
    pub tx_signature: Option<String>,
    pub status: String,
    pub total_amount: i64,
    pub recipient_count: i32,
    pub mint_address: String,
    pub notes: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub confirmed_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Deserialize)]
pub struct FailRequest {
    pub batch_id: Uuid,
}

#[derive(Serialize)]
pub struct BatchItem {
    pub id: Uuid,
    pub wallet_pubkey: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub amount: i64,
    pub ata_address: Option<String>,
}

#[derive(Serialize)]
pub struct BatchDetail {
    pub batch: BatchSummary,
    pub items: Vec<BatchItem>,
}

// ── POST /batches ─────────────────────────────────────────────────────────────

pub async fn prepare(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Json(body): Json<PrepareRequest>,
) -> Result<Json<PrepareResponse>, (StatusCode, String)> {
    let total_amount: i64 = body.recipients.iter().map(|r| r.amount).sum();
    let recipient_count = body.recipients.len() as i32;

    let mint_pubkey = body
        .mint_address
        .parse::<Pubkey>()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid mint address".to_string()))?;

    let token_program = spl_token::id();

    // Validate + derive ATAs
    let mut parsed: Vec<(String, Pubkey, Pubkey)> = Vec::new();
    for r in &body.recipients {
        let owner = r.wallet.parse::<Pubkey>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                format!("Invalid wallet: {}", r.wallet),
            )
        })?;
        let ata =
            get_associated_token_address_with_program_id(&owner, &mint_pubkey, &token_program);
        parsed.push((r.wallet.clone(), owner, ata));
    }

    // Batch check existence via getMultipleAccounts
    let ata_keys: Vec<Pubkey> = parsed.iter().map(|(_, _, ata)| *ata).collect();
    let accounts = state
        .rpc
        .get_multiple_accounts(&ata_keys)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut missing: Vec<(Pubkey, Pubkey)> = Vec::new();
    let mut exists_map: Vec<bool> = Vec::new();

    for (i, info) in accounts.iter().enumerate() {
        let exists = info.is_some();
        exists_map.push(exists);
        if !exists {
            let (_, owner, ata) = &parsed[i];
            missing.push((*owner, *ata));
        }
    }

    let atas_created = missing.len();

    // Create missing ATAs — executor pays rent
    if !missing.is_empty() {
        for chunk in missing.chunks(ATA_BATCH_SIZE) {
            let instructions: Vec<_> = chunk
                .iter()
                .map(|(owner, _)| {
                    create_associated_token_account_idempotent(
                        &state.executor_keypair.pubkey(),
                        owner,
                        &mint_pubkey,
                        &token_program,
                    )
                })
                .collect();

            let blockhash = state
                .rpc
                .get_latest_blockhash()
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            let tx = Transaction::new_signed_with_payer(
                &instructions,
                Some(&state.executor_keypair.pubkey()),
                &[state.executor_keypair.as_ref()],
                blockhash,
            );

            state.rpc.send_and_confirm_transaction(&tx).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("ATA creation failed: {e}"),
                )
            })?;
        }
    }

    // Insert batch record
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

    // Insert batch items + build response
    let mut atas: Vec<PreparedAta> = Vec::with_capacity(parsed.len());
    for (i, ((wallet_str, _, ata), recipient)) in
        parsed.iter().zip(body.recipients.iter()).enumerate()
    {
        sqlx::query!(
            "INSERT INTO batch_items
                 (batch_id, wallet_pubkey, name, description, amount, ata_address, ata_exists)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
            batch_id,
            wallet_str,
            recipient.name,
            recipient.description,
            recipient.amount,
            ata.to_string(),
            true,
        )
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        atas.push(PreparedAta {
            wallet: wallet_str.clone(),
            ata_address: ata.to_string(),
            ata_exists: exists_map[i],
        });
    }

    Ok(Json(PrepareResponse {
        batch_id,
        atas,
        total_amount,
        atas_created,
    }))
}

// ── POST /batches/confirm ─────────────────────────────────────────────────────

pub async fn confirm(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Json(body): Json<ConfirmRequest>,
) -> Result<Json<ConfirmResponse>, (StatusCode, String)> {
    let result = sqlx::query!(
        "UPDATE batches
         SET status = 'confirmed', tx_signature = $1, confirmed_at = now()
         WHERE id = $2 AND sender_pubkey = $3 AND status = 'pending'",
        body.tx_signature,
        body.batch_id,
        wallet,
    )
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "Batch not found or already confirmed".to_string(),
        ));
    }

    Ok(Json(ConfirmResponse {
        batch_id: body.batch_id,
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
         FROM batches WHERE sender_pubkey = $1 ORDER BY created_at DESC LIMIT 50",
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
         FROM batches WHERE id = $1 AND sender_pubkey = $2",
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
         FROM batch_items WHERE batch_id = $1 ORDER BY created_at ASC",
        id,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(BatchDetail { batch, items }))
}

// ── POST fail /batches ─────────────────────────────────────────────────────────────

pub async fn fail(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Json(body): Json<FailRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    sqlx::query!(
        "UPDATE batches SET status = 'failed'
         WHERE id = $1 AND sender_pubkey = $2 AND status = 'pending'",
        body.batch_id,
        wallet,
    )
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
