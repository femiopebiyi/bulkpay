use axum::{routing::{get, post}, Router};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/schedules",            get(list).post(create))
        .route("/schedules/:id",        get(detail))
        .route("/delegate/instruction", get(delegate_instruction))
        .route("/delegate",             post(revoke))
}

async fn list()                 -> &'static str { "schedules stub" }
async fn create()               -> &'static str { "create stub" }
async fn detail()               -> &'static str { "detail stub" }
async fn delegate_instruction() -> &'static str { "delegate stub" }
async fn revoke()               -> &'static str { "revoke stub" }
