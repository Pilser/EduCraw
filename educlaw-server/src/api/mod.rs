// educlaw-server/src/api/mod.rs
//
// Shared application state and route assembly.

mod admin;
mod auth_routes;
mod common;
mod files;
mod sessions;
mod students;
mod threads;
mod ws;

use axum::{routing::get, Json, Router};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::Duration;

use crate::auth::AuthConfig;
use crate::db::models as db_models;
use crate::session::broker::SessionBroker;
use crate::session::registry::SessionRegistry;

// ── Shared application state ──────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub auth: AuthConfig,
    pub workspace_root: String,
    pub goose_bin: String,
    pub broker: Arc<SessionBroker>,
    pub registry: Arc<SessionRegistry>,
    /// Root dir containing subject dirs: `{subjects_root}/{cohort_id}/{slug}/`
    /// This is the OverlayFS lower layer — cohort course materials, read-only.
    /// Matches the disk layout defined in the `subjects` DB table.
    pub subjects_root: String,
    /// Root dir containing one sub-dir per student: `{students_root}/{student_id}/`
    /// This is the OverlayFS upper layer — student persistent home, read-write.
    pub students_root: String,
}

impl AppState {
    pub fn new(
        pool: SqlitePool,
        auth: AuthConfig,
        workspace_root: String,
        goose_bin: String,
        broker: Arc<SessionBroker>,
        registry: Arc<SessionRegistry>,
        subjects_root: String,
        students_root: String,
    ) -> Self {
        Self {
            pool,
            auth,
            workspace_root,
            goose_bin,
            broker,
            registry,
            subjects_root,
            students_root,
        }
    }
}

// ── Router assembly ───────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .merge(auth_routes::routes())
        .merge(admin::routes())
        .merge(students::routes())
        .merge(sessions::routes())
        .merge(threads::routes())
        .merge(ws::routes())
        .merge(files::routes())
        .route("/health", get(health))
        // Public model list (enabled only) — used by frontend model picker.
        .route("/models", get(list_enabled_models))
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn list_enabled_models(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<serde_json::Value> {
    match db_models::list_enabled(&state.pool).await {
        Ok(rows) => Json(serde_json::json!(rows)),
        Err(_) => Json(serde_json::json!([])),
    }
}
