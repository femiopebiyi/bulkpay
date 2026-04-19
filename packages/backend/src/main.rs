use axum::{routing::get, Router};
use dotenvy::dotenv;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::net::TcpListener;

mod auth;
mod db;
mod routes;
mod scheduler;

// ── App state shared across all handlers ─────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub db:  PgPool,
    pub rpc: Arc<solana_client::rpc_client::RpcClient>,
    pub jwt_secret: String,
}

// ─────────────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv().ok();
    tracing_subscriber::fmt::init();

    // ── Config from environment ───────────────────────────────────────────────
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");
    let rpc_url = std::env::var("RPC_URL")
        .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());
    let jwt_secret = std::env::var("JWT_SECRET")
        .expect("JWT_SECRET must be set");
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "3001".to_string());

    // ── Database pool ─────────────────────────────────────────────────────────
    let db = db::connect(&database_url).await?;
    tracing::info!("Database connected");

    // ── Solana RPC client ─────────────────────────────────────────────────────
    let rpc = Arc::new(solana_client::rpc_client::RpcClient::new(rpc_url));
    tracing::info!("RPC client initialised");

    // ── Shared state ──────────────────────────────────────────────────────────
    let state = AppState { db, rpc, jwt_secret };

    // ── Scheduler background task ─────────────────────────────────────────────
    {
        let state = state.clone();
        tokio::spawn(async move {
            scheduler::run(state).await;
        });
    }

    // ── Router ────────────────────────────────────────────────────────────────
    let app = Router::new()
        .route("/health", get(health))
        .merge(routes::auth::router())
        .merge(routes::batches::router())
        .merge(routes::contacts::router())
        .merge(routes::schedules::router())
        .with_state(state);

    // ── Start server ──────────────────────────────────────────────────────────
    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!("BulkPay backend listening on {addr}");

    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}
