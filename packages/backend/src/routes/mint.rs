use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use solana_sdk::{program_pack::Pack, pubkey::Pubkey, signer::Signer, transaction::Transaction};
use spl_associated_token_account::{
    get_associated_token_address_with_program_id,
    instruction::create_associated_token_account_idempotent,
};
use spl_token::instruction::mint_to;
use std::str::FromStr;

use crate::{auth::AuthUser, AppState};

const MINT_AMOUNT: u64 = 10_000 * 1_000_000; // 10,000 USDC in base units
const COOLDOWN_HOURS: i64 = 24;
const HISTORY_LIMIT: i64 = 10;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/mint", post(mint))
        .route("/mint/history", get(history))
}

#[derive(Serialize)]
pub struct MintResponse {
    pub tx_signature: String,
    pub amount: u64,
}

#[derive(Serialize)]
pub struct MintHistoryEntry {
    pub wallet: String,
    pub amount: i64,
    pub tx_signature: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

// ── POST /mint ────────────────────────────────────────────────────────────────

pub async fn mint(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
) -> Result<Json<MintResponse>, (StatusCode, String)> {
    // 1. Check 24-hour cooldown
    let last_mint = sqlx::query_scalar!(
        "SELECT created_at FROM mints
         WHERE wallet = $1
         ORDER BY created_at DESC
         LIMIT 1",
        wallet,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(last) = last_mint {
        let hours_since = (chrono::Utc::now() - last).num_hours();
        if hours_since < COOLDOWN_HOURS {
            let wait = COOLDOWN_HOURS - hours_since;
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                format!("cooldown:{wait}"), // frontend parses this
            ));
        }
    }

    // 2. Parse addresses
    let usdc_mint = Pubkey::from_str(
        &std::env::var("NEXT_PUBLIC_USDC_MINT")
            .unwrap_or_else(|_| "EaUe6ri7FwqgxVyDcxGAFvfnNczdZVpmosTWo7RCXYZE".to_string()),
    )
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid mint address".to_string(),
        )
    })?;

    let recipient = Pubkey::from_str(&wallet).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "Invalid wallet address".to_string(),
        )
    })?;

    let token_program = spl_token::id();
    let mint_authority = &state.mint_authority_keypair;

    let recipient_ata =
        get_associated_token_address_with_program_id(&recipient, &usdc_mint, &token_program);

    // 3. Create ATA if it doesn't exist
    let ata_exists = state.rpc.get_account(&recipient_ata).is_ok();

    if !ata_exists {
        let create_ata_ix = create_associated_token_account_idempotent(
            &mint_authority.pubkey(),
            &recipient,
            &usdc_mint,
            &token_program,
        );
        let blockhash = state
            .rpc
            .get_latest_blockhash()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let tx = Transaction::new_signed_with_payer(
            &[create_ata_ix],
            Some(&mint_authority.pubkey()),
            &[mint_authority.as_ref()],
            blockhash,
        );
        state.rpc.send_and_confirm_transaction(&tx).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("ATA creation failed: {e}"),
            )
        })?;
    }

    // 4. Mint tokens
    let mint_ix = mint_to(
        &token_program,
        &usdc_mint,
        &recipient_ata,
        &mint_authority.pubkey(),
        &[],
        MINT_AMOUNT,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let blockhash = state
        .rpc
        .get_latest_blockhash()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let tx = Transaction::new_signed_with_payer(
        &[mint_ix],
        Some(&mint_authority.pubkey()),
        &[mint_authority.as_ref()],
        blockhash,
    );

    let sig = state.rpc.send_and_confirm_transaction(&tx).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Mint failed: {e}"),
        )
    })?;

    // 5. Record in DB
    sqlx::query!(
        "INSERT INTO mints (wallet, amount, tx_signature) VALUES ($1, $2, $3)",
        wallet,
        MINT_AMOUNT as i64,
        sig.to_string(),
    )
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!("Minted {} USDC to {} — {}", MINT_AMOUNT, wallet, sig);

    Ok(Json(MintResponse {
        tx_signature: sig.to_string(),
        amount: MINT_AMOUNT,
    }))
}

// ── GET /mint/history ─────────────────────────────────────────────────────────

pub async fn history(
    State(state): State<AppState>,
) -> Result<Json<Vec<MintHistoryEntry>>, (StatusCode, String)> {
    let rows = sqlx::query_as!(
        MintHistoryEntry,
        "SELECT wallet, amount, tx_signature, created_at
         FROM mints
         ORDER BY created_at DESC
         LIMIT $1",
        HISTORY_LIMIT,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(rows))
}
