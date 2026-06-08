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

use std::collections::HashSet;
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
    // Debug: verify the goose binary exists at the configured path
    {
        let p = std::path::Path::new(&goose_bin);
        if p.exists() {
            tracing::info!(path = %goose_bin, size = ?std::fs::metadata(&goose_bin).ok().map(|m| m.len()), "GOOSE_BIN found");
        } else {
            tracing::error!(path = %goose_bin, "GOOSE_BIN does NOT exist — container will fail to exec /goose");
        }
    }

    let jail_tools_host = std::env::var("JAIL_TOOLS_HOST")
        .unwrap_or_else(|_| "/srv/educraw/jail-tools".to_string());

    // Root dir for subject content: {subjects_root}/{cohort_id}/{slug}/
    let subjects_root = std::env::var("EDUCLAW_SUBJECTS_ROOT")
        .unwrap_or_else(|_| "/srv/educlaw/data/subjects".to_string());
    std::fs::create_dir_all(&subjects_root)?;

    // Root dir holding one sub-dir per student: {students_root}/{student_id}/
    let students_root = std::env::var("EDUCLAW_STUDENTS_ROOT")
        .unwrap_or_else(|_| "/srv/educlaw/data/students".to_string());
    std::fs::create_dir_all(&students_root)?;

    // Parse GOOSE_EXCLUDED_DIRS into a set of directory basenames to filter
    // from file tree listings (OverlayFS copy-up stubs of system dirs).
    let excluded_dirs: HashSet<String> = std::env::var("GOOSE_EXCLUDED_DIRS")
        .unwrap_or_default()
        .split(',')
        .filter(|s| !s.is_empty())
        .map(|s| {
            std::path::Path::new(s)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| s.trim_start_matches('/').to_string())
        })
        .collect();

    // Per-student disk quota (bytes). 0 = unlimited. Default 500 MiB.
    let student_quota_bytes: u64 = std::env::var("EDUCRAW_STUDENT_QUOTA_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(500 * 1024 * 1024);

    // Path to prompts directory mounted read-only inside the container.
    let prompts_path = std::env::var("EDUCRAW_PROMPTS_PATH")
        .unwrap_or_else(|_| "/srv/educraw/prompts".to_string());

    let system_recipes_path = std::env::var("EDUCRAW_SYSTEM_RECIPES_PATH")
        .unwrap_or_else(|_| "/srv/educraw/systemRecipes".to_string());

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
    let helix_client: Arc<educlaw_helix::HelixClient> = {
        tracing::info!("using HelixDB backend");
        educlaw_helix::validate_queries()?;
        let config = HelixConfig::from_env()
            .map_err(|e| anyhow::anyhow!("HelixDB config error: {e}"))?;
        let client = HelixClient::new(config);
        tracing::info!("testing HelixDB connection...");
        client.test_connection().await
            .map_err(|e| anyhow::anyhow!("HelixDB connection failed: {e}"))?;
        educlaw_helix::init_schema(&client).await?;
        Arc::new(client)
    };
    let backend: Arc<dyn crate::db::DbBackend> = {
        Arc::new(HelixBackend::new((*helix_client).clone()))
    };

    // ── Clean up stale sessions from previous instance ──────────────────
    // 1. Nuke the entire /tmp/craw/ tree — every session bundle is ephemeral.
    //    This catches orphaned dirs that don't have a DB entry.
    crate::session::dirs::cleanup_all_temp_dirs();

    // 2. Mark DB sessions as ended, kill orphaned processes, remove veth pairs,
    //    and release IP reservations.
    // On restart, old sessions in the persistent DB still have state="active"
    // but their veth pairs, overlay mounts, and goose processes are gone.
    // Clean them up to prevent veth name collisions when the frontend
    // tries to restore an old session ID from localStorage.
    {
        use educlaw_helix::DbBackend as HelixDb;
        let active = backend.list_active_sessions().await?;
        if !active.is_empty() {
            tracing::info!("cleaning up {} stale session(s) from previous instance", active.len());
            for s in &active {
                let (b1, b2, b3) = crate::session::namespace::session_ip_block(&s.id);
                crate::session::namespace::cleanup_veth(b1, b2, b3).await;

                // Release IP reservation
                let _ = HelixDb::release_session_subnets(&*helix_client, &s.id).await;

                // Try container stale cleanup first (kills orphaned processes, removes state)
                crate::session::container::cleanup_stale_container(&s.id);

                // Fallback: old unshare session cleanup
                if !s.overlay_mount.is_empty() {
                    use std::path::Path;
                    crate::session::namespace::umount_overlay(Path::new(&s.overlay_mount)).await;
                }
                if let Some(pid) = s.namespace_pid {
                    crate::session::namespace::kill_process_tree(pid, 3).await;
                }
                if let Err(e) = backend.set_session_state(&s.id, "ended").await {
                    tracing::warn!(session_id = %s.id, error = %e, "Failed to mark stale session as ended");
                }
                tracing::info!(session_id = %s.id, "stale session cleaned up");
            }
        }
    }

    // 3. Clean up orphaned veth interfaces from crashed sessions (no DB entry).
    crate::session::namespace::cleanup_orphaned_veths().await;

    // 4. Clean up orphaned youki cgroups and any container processes still
    //    trapped in them (e.g. /goose acp that survived server crash).
    crate::session::container::cleanup_orphaned_cgroups();

    let web_root = std::env::var("EDUCLAW_WEB_ROOT")
        .unwrap_or_else(|_| "./educlaw-web/dist".to_string());

    let state = api::AppState::new(backend, (*helix_client).clone(), auth_config, workspace_root, goose_bin, jail_tools_host, broker, registry, subjects_root, students_root, excluded_dirs, student_quota_bytes, prompts_path, system_recipes_path);

    let state_for_shutdown = state.clone();

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
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            tracing::warn!(%addr, "port in use — retrying once after 2s");
            tokio::time::sleep(Duration::from_secs(2)).await;
            tokio::net::TcpListener::bind(addr).await?
        }
        Err(e) => return Err(e.into()),
    };

    if let Err(e) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        tracing::warn!(error = %e, "server exited with error");
    }

    // Graceful shutdown: clean up all active sessions
    tracing::info!("server shutting down — cleaning up active sessions");
    let cleanup = cleanup_all_sessions(&state_for_shutdown);
    if tokio::time::timeout(Duration::from_secs(30), cleanup).await.is_err() {
        tracing::warn!("cleanup timed out — forcing exit");
    }

    // Force exit — spawned tasks (watchdog, stderr drainer, notification
    // forwarders) keep the tokio runtime alive indefinitely otherwise.
    tracing::info!("forced exit — goodbye");
    std::process::exit(0);
}

/// Listen for SIGINT (Ctrl+C) and SIGTERM to trigger graceful shutdown.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutdown signal received");
}

/// Clean up all active sessions on graceful shutdown.
///
/// Kills all managed containers, removes veth pairs, cleans up temp dirs,
/// and marks DB sessions as ended. Runs both against the in-memory registry
/// and as a defense-in-depth pass against any remaining DB entries.
async fn cleanup_all_sessions(state: &api::AppState) {
    use crate::session::container;
    use crate::session::dirs::cleanup_session_dir;
    use crate::session::namespace::{cleanup_orphaned_veths, cleanup_veth, session_ip_block};
    use educlaw_helix::DbBackend as HelixDb;

    // 1. Kill actively managed containers from the registry
    let session_ids: Vec<String> = state.registry.list_all().await;
    if !session_ids.is_empty() {
        tracing::info!(
            "shutdown: cleaning up {} managed session(s)",
            session_ids.len()
        );
        for session_id in &session_ids {
            if let Some(managed) = state.registry.get(session_id).await {
                let mut cg = managed.container.lock().await;
                if cg.is_some() {
                    tracing::info!(session_id = %session_id, "shutdown: killing container");
                    container::kill_and_delete_container(&mut cg);
                }
            }
            let (b1, b2, b3) = session_ip_block(session_id);
            cleanup_veth(b1, b2, b3).await;
            let _ = HelixDb::release_session_subnets(&state.helix_client, session_id).await;
            state.broker.remove_entry(session_id).await;
            cleanup_session_dir(session_id);
            let _ = state
                .backend
                .set_session_state(session_id, "ended")
                .await;
        }
    }

    // 2. Defense-in-depth: clean up any DB sessions still marked active
    if let Ok(active) = state.backend.list_active_sessions().await {
        if !active.is_empty() {
            tracing::info!(
                "shutdown: cleaning up {} DB active session(s)",
                active.len()
            );
            for s in &active {
                let (b1, b2, b3) = session_ip_block(&s.id);
                cleanup_veth(b1, b2, b3).await;
                let _ = HelixDb::release_session_subnets(&state.helix_client, &s.id).await;
                container::cleanup_stale_container(&s.id);
                let _ = state.backend.set_session_state(&s.id, "ended").await;
            }
        }
    }

    // 3. Remove any orphaned veths from sessions already marked "ended" before crash
    cleanup_orphaned_veths().await;

    // 4. Clean up orphaned youki cgroups and any processes still trapped in them
    container::cleanup_orphaned_cgroups();

    // 5. Reap zombie youki init children so they don't clutter the process table
    container::reap_zombie_children();

    tracing::info!("graceful shutdown complete");
}
