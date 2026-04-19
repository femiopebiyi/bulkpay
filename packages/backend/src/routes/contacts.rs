use axum::{routing::{get, post}, Router};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/contacts", get(list).post(create))
}

async fn list()   -> &'static str { "contacts stub" }
async fn create() -> &'static str { "create stub" }
