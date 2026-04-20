use anyhow::anyhow;
use ed25519_dalek::{Signature, VerifyingKey};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

// ── JWT Claims ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,   // wallet pubkey
    pub exp: usize,    // expiry timestamp
    pub iat: usize,    // issued at
}

// ── Issue a JWT ───────────────────────────────────────────────────────────────

pub fn issue_jwt(wallet: &str, secret: &str) -> anyhow::Result<String> {
    let now = chrono::Utc::now().timestamp() as usize;

    let claims = Claims {
        sub: wallet.to_string(),
        iat: now,
        exp: now + 60 * 60 * 24 * 7, // 7 days
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| anyhow!("JWT encode error: {e}"))
}

// ── Verify a JWT ──────────────────────────────────────────────────────────────

pub fn verify_jwt(token: &str, secret: &str) -> anyhow::Result<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
    .map_err(|e| anyhow!("JWT decode error: {e}"))
}

// ── Verify wallet signature ───────────────────────────────────────────────────

/// Verifies that `signature` was produced by signing `message`
/// with the private key corresponding to `wallet_pubkey`.
pub fn verify_wallet_signature(
    wallet_pubkey: &str,
    message:       &str,
    signature_b58: &str,
) -> anyhow::Result<()> {
    // Decode the base58 pubkey into 32 bytes
    let pubkey_bytes = bs58::decode(wallet_pubkey)
        .into_vec()
        .map_err(|e| anyhow!("Invalid pubkey base58: {e}"))?;

    // Decode the base58 signature into 64 bytes
    let sig_bytes = bs58::decode(signature_b58)
        .into_vec()
        .map_err(|e| anyhow!("Invalid signature base58: {e}"))?;

    let verifying_key = VerifyingKey::from_bytes(
        pubkey_bytes
            .as_slice()
            .try_into()
            .map_err(|_| anyhow!("Pubkey must be 32 bytes"))?,
    )
    .map_err(|e| anyhow!("Invalid verifying key: {e}"))?;

    let signature = Signature::from_bytes(
        sig_bytes
            .as_slice()
            .try_into()
            .map_err(|_| anyhow!("Signature must be 64 bytes"))?,
    );

    verifying_key
        .verify_strict(message.as_bytes(), &signature)
        .map_err(|_| anyhow!("Signature verification failed"))
}

// ── Axum extractor — pulls wallet pubkey from JWT in Authorization header ─────

use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
};

pub struct AuthUser(pub String); // the wallet pubkey

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
    S: AsRef<String>, // AppState must implement AsRef<String> for jwt_secret
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let secret = state.as_ref();

        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or((StatusCode::UNAUTHORIZED, "Missing Authorization header"))?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or((StatusCode::UNAUTHORIZED, "Invalid Authorization format"))?;

        let claims = verify_jwt(token, secret)
            .map_err(|_| (StatusCode::UNAUTHORIZED, "Invalid or expired token"))?;

        Ok(AuthUser(claims.sub))
    }
}
