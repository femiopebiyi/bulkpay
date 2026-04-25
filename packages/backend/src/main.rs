use axum::{routing::get, Router};
use dotenvy::dotenv;
use solana_sdk::{signature::Keypair, signer::Signer};
use sqlx::PgPool;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};

mod auth;
mod db;
mod routes;
mod scheduler;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub rpc: Arc<solana_client::rpc_client::RpcClient>,
    pub jwt_secret: String,
    // Funded keypair — pays ATA creation rent on behalf of senders.
    // Load from EXECUTOR_KEYPAIR env var (base58 secret key).
    // Keep this keypair funded with ~0.5 SOL on devnet, ~2 SOL on mainnet.
    pub executor_keypair: Arc<Keypair>,
}

impl AsRef<String> for AppState {
    fn as_ref(&self) -> &String {
        &self.jwt_secret
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv().ok();
    tracing_subscriber::fmt::init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let rpc_url =
        std::env::var("RPC_URL").unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());
    let jwt_secret = std::env::var("JWT_SECRET").expect("JWT_SECRET must be set");
    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let executor_keypair_path =
        std::env::var("EXECUTOR_KEYPAIR_PATH").expect("EXECUTOR_KEYPAIR_PATH must be set");

    let db = db::connect(&database_url).await?;
    tracing::info!("Database connected");

    let rpc = Arc::new(solana_client::rpc_client::RpcClient::new(rpc_url));
    tracing::info!("RPC client initialised");

    let executor_keypair_bytes: Vec<u8> = {
        let json = std::fs::read_to_string(&executor_keypair_path)
            .unwrap_or_else(|_| panic!("Could not read keypair file at {executor_keypair_path}"));
        let byte_array: Vec<u8> =
            serde_json::from_str(&json).expect("Keypair file must be a JSON array of bytes");
        byte_array
    };

    let executor_keypair = Arc::new(
        Keypair::try_from(executor_keypair_bytes.as_slice())
            .expect("Invalid keypair bytes in executor keypair file"),
    );
    tracing::info!("Executor keypair loaded: {}", executor_keypair.pubkey());

    let state = AppState {
        db,
        rpc,
        jwt_secret,
        executor_keypair,
    };

    {
        let state = state.clone();
        tokio::spawn(async move {
            scheduler::run(state).await;
        });
    }

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .merge(routes::auth::router())
        .merge(routes::batches::router())
        .merge(routes::contacts::router())
        .merge(routes::schedules::router())
        .merge(routes::users::router())
        .layer(cors)
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!("BulkPay backend listening on {addr}");

    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}
