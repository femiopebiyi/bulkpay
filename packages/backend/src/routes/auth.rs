use axum::{routing::post, Router};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/nonce",  post(nonce))
        .route("/auth/verify", post(verify))
}

async fn nonce()  -> &'static str { "nonce stub" }
async fn verify() -> &'static str { "verify stub" }
