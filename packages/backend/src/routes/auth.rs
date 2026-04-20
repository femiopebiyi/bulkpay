use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::post,
    Json, Router,
};
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::{auth, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/nonce",  axum::routing::get(nonce))
        .route("/auth/verify", post(verify))
}

// ── GET /auth/nonce?wallet=<pubkey> ───────────────────────────────────────────

#[derive(Deserialize)]
pub struct NonceQuery {
    pub wallet: String,
}

#[derive(Serialize)]
pub struct NonceResponse {
    pub nonce:   String,
    pub message: String, // the full string the user must sign
}

pub async fn nonce(
    State(state): State<AppState>,
    Query(params): Query<NonceQuery>,
) -> Result<Json<NonceResponse>, (StatusCode, String)> {
    // Generate a random 32-byte nonce encoded as hex
    let raw: [u8; 32] = rand::thread_rng().gen();
    let nonce = hex::encode(raw);

    let message = format!(
        "BulkPay authentication\nWallet: {}\nNonce: {}\n\nSign this message to log in.",
        params.wallet, nonce
    );

    // Store nonce in DB — expires in 5 minutes (set by migration default)
    sqlx::query!(
        "INSERT INTO nonces (wallet, nonce) VALUES ($1, $2)",
        params.wallet,
        nonce,
    )
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(NonceResponse { nonce, message }))
}

// ── POST /auth/verify ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct VerifyRequest {
    pub wallet:    String,
    pub nonce:     String,
    pub signature: String, // base58 encoded
}

#[derive(Serialize)]
pub struct VerifyResponse {
    pub token: String, // JWT
}

pub async fn verify(
    State(state): State<AppState>,
    Json(body): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, (StatusCode, String)> {
    // 1. Look up the nonce — must exist and not be expired
    let record = sqlx::query!(
        "SELECT wallet, nonce FROM nonces
         WHERE nonce = $1
           AND wallet = $2
           AND expires_at > now()",
        body.nonce,
        body.wallet,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::UNAUTHORIZED, "Nonce not found or expired".to_string()))?;

    // 2. Reconstruct the exact message the user signed
    let message = format!(
        "BulkPay authentication\nWallet: {}\nNonce: {}\n\nSign this message to log in.",
        record.wallet, record.nonce
    );

    // 3. Verify the wallet signature
    auth::verify_wallet_signature(&body.wallet, &message, &body.signature)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;

    // 4. Delete the nonce — single use
    sqlx::query!("DELETE FROM nonces WHERE nonce = $1", body.nonce)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 5. Issue JWT
    let token = auth::issue_jwt(&body.wallet, &state.jwt_secret)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(VerifyResponse { token }))
}
