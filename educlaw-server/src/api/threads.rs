// educlaw-server/src/api/threads.rs
//
// REST endpoints for thread (session/thread) management.
// These replace the WebSocket-based list_sessions, fork_session,
// export_session, import_session, and get_models operations.
//
// GET  /sessions/:id/threads                   — list threads
// POST /sessions/:id/threads/new              — create new thread
// POST /sessions/:id/threads/:thread_id/fork    — fork a thread
// GET  /sessions/:id/threads/:thread_id/export  — export thread as JSON
// POST /sessions/:id/threads/import             — import thread from JSON

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use sacp::schema::NewSessionRequest;
use serde::Deserialize;

use crate::acp_bridge::{
    handle_export_session, handle_fork_session, handle_import_session, handle_list_sessions,
    init_acp_session, ForkSessionResult, ImportSessionResponse, SessionListItem,
};
use crate::error::{AppError, Result};
use crate::session::dirs::SessionDirs;
use crate::session::registry::ManagedSession;

use super::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sessions/:id/threads", get(list_threads))
        .route("/sessions/:id/threads/new", axum::routing::post(create_thread))
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
) -> Result<Arc<ManagedSession>> {
    if let Some(managed) = state.registry.get(session_id).await {
        return Ok(managed);
    }

    // Session not in registry — spawn goose and register it (lazy init)
    let session = state.backend.get_session(session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

    if session.state != "active" {
        return Err(AppError::BadRequest(format!(
            "session {session_id} is not active (state: {})",
            session.state
        )));
    }

    let student_id = session.student_id.clone();
    let dirs = SessionDirs::for_existing_session(&state.workspace_root, session_id);

    let system_prompt = std::fs::read_to_string(dirs.config.join("student.json"))
        .ok()
        .and_then(|blob| serde_json::from_str::<serde_json::Value>(&blob).ok())
        .and_then(|v| v["system_prompt"].as_str().map(|s| s.to_string()))
        .and_then(|b64| {
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            STANDARD.decode(b64).ok().and_then(|bytes| String::from_utf8(bytes).ok())
        });

    let mut env_vars: Vec<(String, String)> = Vec::new();
    for key in &[
        "HOME", "USER", "PATH", "TERM",
        "XAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
        "GOOGLE_API_KEY", "OPENROUTER_API_KEY",
        "DEEPSEEK_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY",
        "MOONSHOT_API_KEY", "MINIMAX_API_KEY", "NOVITA_API_KEY",
        "NVIDIA_API_KEY", "CEREBRAS_API_KEY", "INCEPTION_API_KEY",
        "OLLAMA_CLOUD_API_KEY", "ZHIPU_API_KEY", "TANZU_AI_API_KEY",
        "TENSORIX_API_KEY", "OVHCLOUD_API_KEY",
        "OPENAI_BASE_URL",
    ] {
        if let Ok(val) = std::env::var(key) {
            env_vars.push((key.to_string(), val));
        }
    }

    let model = session.model.clone()
        .filter(|m| !m.is_empty())
        .or_else(|| std::env::var("GOOSE_MODEL").ok());

    let goose_path_root = std::path::PathBuf::from(&state.students_root).join(&student_id);
    let logs_dir = std::path::PathBuf::from(&state.workspace_root)
        .parent()
        .unwrap_or(std::path::Path::new("/data"))
        .join(format!("students/{}", student_id))
        .join(".goose/logs");

    init_acp_session(
        std::path::PathBuf::from(&state.goose_bin),
        dirs.merged.clone(),
        goose_path_root,
        dirs.config.clone(),
        env_vars,
        model,
        state.backend.clone(),
        session_id.to_string(),
        student_id,
        logs_dir,
        system_prompt,
        Arc::clone(&state.registry),
    )
    .await?;

    state
        .registry
        .get(session_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found after init")))
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

// ── POST /sessions/:id/threads/new ──────────────────────────────────────────

async fn create_thread(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse> {
    let managed = get_managed_session(&state, &session_id).await?;
    let dirs = SessionDirs::for_existing_session(&state.workspace_root, &session_id);

    let resp = managed
        .cx
        .send_request(NewSessionRequest::new("/"))
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("NewSession ACP error: {e}")))?;

    *managed.acp_session_id.lock().await = Some(resp.session_id.clone());

    tracing::info!(
        session_id = %session_id,
        thread_id = %resp.session_id.0,
        "new thread created"
    );

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "thread_id": resp.session_id.0,
    }))))
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
