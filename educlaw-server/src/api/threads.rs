// educlaw-server/src/api/threads.rs
//
// REST endpoints for thread (session/thread) management.
// These replace the WebSocket-based list_sessions, fork_session,
// export_session, import_session, and get_models operations.
//
// GET  /sessions/:id/threads                   — list threads
// POST /sessions/:id/threads/:thread_id/fork    — fork a thread
// GET  /sessions/:id/threads/:thread_id/export  — export thread as JSON
// POST /sessions/:id/threads/import             — import thread from JSON

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::acp_bridge::{
    handle_export_session, handle_fork_session, handle_import_session, handle_list_sessions,
    ForkSessionResult, ImportSessionResponse, SessionListItem,
};
use crate::error::{AppError, Result};

use super::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sessions/:id/threads", get(list_threads))
        .route("/sessions/:id/threads/import", axum::routing::post(import_thread))
        .route(
            "/sessions/:id/threads/:thread_id/fork",
            axum::routing::post(fork_thread),
        )
        .route(
            "/sessions/:id/threads/:thread_id/export",
            get(export_thread),
        )
}

async fn get_managed_session(
    state: &AppState,
    session_id: &str,
) -> Result<std::sync::Arc<crate::session::registry::ManagedSession>> {
    state
        .registry
        .get(session_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))
}

// ── GET /sessions/:id/threads ─────────────────────────────────────────────

async fn list_threads(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse> {
    let managed = get_managed_session(&state, &session_id).await?;
    let items: Vec<SessionListItem> = handle_list_sessions(&managed.cx).await?;
    Ok(Json(items))
}

// ── POST /sessions/:id/threads/:thread_id/fork ────────────────────────────

async fn fork_thread(
    State(state): State<AppState>,
    Path((session_id, thread_id)): Path<(String, String)>,
) -> Result<impl IntoResponse> {
    let managed = get_managed_session(&state, &session_id).await?;
    let result: ForkSessionResult =
        handle_fork_session(&managed.cx, thread_id).await?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "new_session_id": result.new_session_id,
    }))))
}

// ── GET /sessions/:id/threads/:thread_id/export ───────────────────────────

async fn export_thread(
    State(state): State<AppState>,
    Path((session_id, thread_id)): Path<(String, String)>,
) -> Result<impl IntoResponse> {
    let managed = get_managed_session(&state, &session_id).await?;
    let data: String = handle_export_session(&managed.cx, thread_id).await?;
    Ok(Json(serde_json::json!({ "data": data })))
}

// ── POST /sessions/:id/threads/import ─────────────────────────────────────

#[derive(Deserialize)]
struct ImportThreadBody {
    data: String,
}

async fn import_thread(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(body): Json<ImportThreadBody>,
) -> Result<impl IntoResponse> {
    let managed = get_managed_session(&state, &session_id).await?;
    let result: ImportSessionResponse = handle_import_session(&managed.cx, body.data).await?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "session_id": result.session_id,
        "title": result.title,
        "message_count": result.message_count,
    }))))
}
