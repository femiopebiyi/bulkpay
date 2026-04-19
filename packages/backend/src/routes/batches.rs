use axum::{routing::{get, post}, Router};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/batches",         get(list).post(prepare))
        .route("/batches/confirm", post(confirm))
}

async fn list()    -> &'static str { "batches stub" }
async fn prepare() -> &'static str { "prepare stub" }
async fn confirm() -> &'static str { "confirm stub" }
