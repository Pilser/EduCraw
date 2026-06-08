// educlaw-server/src/api/sse.rs
//
// SSE (Server-Sent Events) route handlers replacing the WebSocket transport.
//
// POST   /sessions/:id/input              — send message + get SSE stream
// POST   /sessions/:id/cancel             — cancel current prompt
// GET    /sessions/:id/threads/:tid/replay — load thread replay via SSE

use std::convert::Infallible;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::stream;
use serde::Deserialize;

use crate::acp_bridge::{
    handle_cancel, handle_input_sse, handle_replay_sse, init_acp_session, SseEvent, SseEventStream,
};
use crate::api::common::resolve_spawn_params;
use crate::auth::bearer_token;
use crate::error::{AppError, Result};
use crate::session::broker::now_secs;
use crate::session::dirs::SessionDirs;

use super::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sessions/:id/input", post(session_input))
        .route("/sessions/:id/cancel", post(session_cancel))
        .route("/sessions/:id/threads/:thread_id/replay", get(session_replay))
}

#[derive(Deserialize)]
struct InputRequest {
    data: String,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    mime_type: Option<String>,
    #[serde(default)]
    request_id: Option<String>,
}

// ── POST /sessions/:id/input ──────────────────────────────────────────────

async fn session_input(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<InputRequest>,
) -> Result<Response> {
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;

    if claims.session_id.as_deref() != Some(&session_id) {
        return Err(AppError::Unauthorized);
    }

    let session = state.backend.get_session(&session_id)
        .await?
        .ok_or_else(|| AppError::SessionNotFound(format!("session {session_id} not found")))?;

    if session.state != "active" {
        return Err(AppError::SessionNotActive(format!(
            "session {session_id} is not active (state: {})",
            session.state
        )));
    }

    let student_id = session.student_id.clone();
    let dirs = SessionDirs::for_existing_session(&session_id);

    let recent_thread_id = state.backend
        .get_recent_thread_id(&student_id)
        .await
        .unwrap_or(None);

    // Init goose session if not already in registry
    let registry = Arc::clone(&state.registry);
    if registry.get(&session_id).await.is_none() {
        let p = resolve_spawn_params(&state, &session, &student_id, &dirs).await;

        init_acp_session(
            p.goose_bin, p.goose_path_root, p.bundle_root,
            p.student_workspace, p.jail_tools_host, p.subject_dirs,
            p.prompts_path, p.system_recipes_path,
            p.env_vars, p.model, state.backend.clone(),
            &state.helix_client, session_id.clone(), student_id.clone(), p.logs_dir,
            Arc::clone(&registry), recent_thread_id,
        )
        .await?;
    }

    let broker = Arc::clone(&state.broker);
    let last_input_at = broker
        .get_last_input_arc(&session_id)
        .await
        .unwrap_or_else(|| Arc::new(AtomicU64::new(now_secs())));

    let stream = handle_input_sse(
        &session_id,
        &registry,
        body.data,
        body.image,
        body.mime_type,
        body.request_id,
        state.backend.clone(),
        &student_id,
        last_input_at,
    )
    .await?;

    Ok(sse_response(stream))
}

// ── POST /sessions/:id/cancel ─────────────────────────────────────────────

async fn session_cancel(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;

    if claims.session_id.as_deref() != Some(&session_id) {
        return Err(AppError::Unauthorized);
    }

    handle_cancel(&session_id, &state.registry).await?;

    Ok(StatusCode::OK)
}

// ── GET /sessions/:id/threads/:thread_id/replay ──────────────────────────

async fn session_replay(
    State(state): State<AppState>,
    Path((session_id, thread_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Response> {
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;

    if claims.session_id.as_deref() != Some(&session_id) {
        return Err(AppError::Unauthorized);
    }

    let stream = handle_replay_sse(
        &session_id,
        &thread_id,
        &state.registry,
        state.backend.clone(),
    )
    .await?;

    Ok(sse_response(stream))
}

// ── SSE response builder ──────────────────────────────────────────────────

fn sse_response(stream: SseEventStream) -> Response {
    let SseEventStream { rx } = stream;

    let body = Body::from_stream(stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Some(SseEvent::Text(text)) => {
                    let event_type = serde_json::from_str::<serde_json::Value>(&text)
                        .ok()
                        .and_then(|v| v["type"].as_str().map(|s| s.to_string()))
                        .unwrap_or_default();
                    let frame = format!("event: {event_type}\ndata: {text}\n\n");
                    return Some((
                        Ok::<_, Infallible>(axum::body::Bytes::from(frame)),
                        rx,
                    ));
                }
                Some(SseEvent::Close) => {
                    tracing::debug!("📤 [SSE] Stream closed by backend (Close event)");
                    return None;
                }
                None => {
                    tracing::info!("📤 [SSE] Stream ended (channel dropped — frontend likely disconnected)");
                    return None;
                }
            }
        }
    }));

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive")
        .header("X-Accel-Buffering", "no")
        .body(body)
        .unwrap()
}
