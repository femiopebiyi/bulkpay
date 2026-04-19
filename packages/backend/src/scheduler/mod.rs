use crate::AppState;
use std::time::Duration;

pub async fn run(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    tracing::info!("Scheduler started — polling every 60s");

    loop {
        interval.tick().await;
        tracing::debug!("Scheduler tick");
        // execution logic added in Phase 3
        let _ = &state;
    }
}
