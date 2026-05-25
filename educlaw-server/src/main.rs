// educlaw-server/src/main.rs
//
// EduClaw backend — entry point.

mod acp_bridge;
mod api;
mod auth;
mod db;
mod error;
mod security;
mod session;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::{Router, extract::DefaultBodyLimit};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::auth::AuthConfig;
use crate::db::HelixBackend;
use crate::session::broker::SessionBroker;
use crate::session::namespace::ensure_host_networking;
use crate::session::registry::SessionRegistry;

use educlaw_helix::{HelixClient, HelixConfig};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dotenv_result = dotenvy::dotenv();

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,educlaw_server=debug".into()))
        .with(
            tracing_subscriber::fmt::layer()
                .without_time()
                .with_target(true)
                .with_line_number(true)
                .with_ansi(true)
                .compact()
        )
        .init();

    // ── startup env diagnostics ──
    match &dotenv_result {
        Ok(path) => tracing::info!(path = %path.display(), "dotenv loaded"),
        Err(e)   => tracing::warn!(error = %e, "dotenv NOT loaded — running on OS environment only"),
    }
    tracing::info!(
        xai_key       = std::env::var("XAI_API_KEY").is_ok(),
        exa_key       = std::env::var("EXA_API_KEY").is_ok(),
        goose_model   = ?std::env::var("GOOSE_MODEL").ok(),
        goose_bin     = ?std::env::var("GOOSE_BIN").ok(),
        cwd           = %std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default(),
        "startup env"
    );

    let jwt_secret = std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| "change-me-in-production".to_string());
    let auth_config = AuthConfig::new(jwt_secret);

    let workspace_root = std::env::var("EDUCLAW_WORKSPACE_ROOT")
        .unwrap_or_else(|_| "/var/lib/educlaw/sessions".to_string());
    std::fs::create_dir_all(&workspace_root)?;

    let goose_bin = std::env::var("GOOSE_BIN").unwrap_or_else(|_| "goose".to_string());

    // Root dir for subject content: {subjects_root}/{cohort_id}/{slug}/
    let subjects_root = std::env::var("EDUCLAW_SUBJECTS_ROOT")
        .unwrap_or_else(|_| "/srv/educlaw/data/subjects".to_string());
    std::fs::create_dir_all(&subjects_root)?;

    // Root dir holding one sub-dir per student: {students_root}/{student_id}/
    let students_root = std::env::var("EDUCLAW_STUDENTS_ROOT")
        .unwrap_or_else(|_| "/srv/educlaw/data/students".to_string());
    std::fs::create_dir_all(&students_root)?;

    // Ensure host routing/NAT prerequisites for per-session network namespaces.
    ensure_host_networking().await
        .map_err(|e| anyhow::anyhow!("host networking bootstrap failed: {e}"))?;

    let broker = SessionBroker::new();

    let registry = Arc::new(SessionRegistry::new(Duration::from_secs(300)));

    // Periodic cleanup: remove registry entries whose grace period has expired.
    let registry_cleanup = Arc::clone(&registry);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            registry_cleanup.cleanup_expired().await;
        }
    });

    // ── HelixDB backend ────────────────────────────────────────────────
    let backend: Arc<dyn crate::db::DbBackend> = {
        tracing::info!("using HelixDB backend");
        educlaw_helix::validate_queries()?;
        let config = HelixConfig::from_env()
            .map_err(|e| anyhow::anyhow!("HelixDB config error: {e}"))?;
        let client = HelixClient::new(config);
        tracing::info!("testing HelixDB connection...");
        client.test_connection().await
            .map_err(|e| anyhow::anyhow!("HelixDB connection failed: {e}"))?;
        educlaw_helix::init_schema(&client).await?;
        Arc::new(HelixBackend::new(client))
    };

    let web_root = std::env::var("EDUCLAW_WEB_ROOT")
        .unwrap_or_else(|_| "./educlaw-web/dist".to_string());

    let state = api::AppState::new(backend, auth_config, workspace_root, goose_bin, broker, registry, subjects_root, students_root);

    let app = Router::new()
        .merge(api::routes())
        .with_state(state)
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        .layer(tower_http::cors::CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .fallback_service(tower_http::services::ServeDir::new(&web_root));

    let addr: SocketAddr = std::env::var("BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()?;

    tracing::info!("educlaw-server listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
