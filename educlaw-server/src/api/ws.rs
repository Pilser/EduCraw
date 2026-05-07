// educlaw-server/src/api/ws.rs
//
// GET /sessions/:id/ws?token=<jwt>
// Validates the session JWT, registers with the broker, opens ACP bridge.

use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use serde::Deserialize;

use crate::acp_bridge::run_acp_session;
use crate::db::sessions as db_sess;
use crate::error::{AppError, Result};
use crate::session::{broker::now_secs, dirs::SessionDirs};
use crate::session::registry::SessionRegistry;

use super::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/sessions/:id/ws", get(session_ws))
}

#[derive(Deserialize)]
struct WsQuery {
    token: String,
}

async fn session_ws(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(q): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse> {
    // Validate JWT and check it belongs to this session
    let claims = state.auth.verify(&q.token)?;
    if claims.session_id.as_deref() != Some(&session_id) {
        return Err(AppError::Unauthorized);
    }

    let session = db_sess::get_session(&state.pool, &session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

    if session.state != "active" {
        return Err(AppError::BadRequest(format!(
            "session {session_id} is not active (state: {})",
            session.state
        )));
    }

    // The mount was already done in create_session; we only need the ephemeral paths.
    let dirs = SessionDirs::for_existing_session(&state.workspace_root, &session_id);
    let goose_bin = state.goose_bin.clone();
    let broker = Arc::clone(&state.broker);
    let pool = state.pool.clone();
    let sid = session_id.clone();
    let student_id = session.student_id.clone();
    // Capture the model from the DB row so a reconnecting WS uses the last-set model.
    let db_model = session.model.clone();

    // Read student.json once for system_prompt extraction.
    let student_json_blob =
        std::fs::read_to_string(dirs.config.join("student.json")).ok();

    let registry = Arc::clone(&state.registry);

    Ok(ws.on_upgrade(move |socket| async move {
        let last_input_at = broker
            .get_last_input_arc(&sid)
            .await
            .unwrap_or_else(|| Arc::new(AtomicU64::new(now_secs())));

        // No broker PTY sender needed for ACP (goose is not a PTY).
        broker.set_pty_sender(&sid, None).await;

        // Extract system prompt (base64-encoded) from student.json.
        let system_prompt: Option<String> = student_json_blob
            .as_deref()
            .and_then(|blob| serde_json::from_str::<serde_json::Value>(blob).ok())
            .and_then(|v| v["system_prompt"].as_str().map(|s| s.to_string()))
            .and_then(|b64| {
                use base64::{engine::general_purpose::STANDARD, Engine as _};
                STANDARD.decode(&b64).ok().and_then(|bytes| String::from_utf8(bytes).ok())
            });

        // Forward API keys to goose subprocess.
        let mut env_vars: Vec<(String, String)> = Vec::new();
        for key in &[
            "HOME", "USER", "PATH", "TERM",
            "XAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
            "GEMINI_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY",
            "GROQ_API_KEY", "OPENAI_BASE_URL",
        ] {
            if let Ok(val) = std::env::var(key) {
                env_vars.push((key.to_string(), val));
            }
        }

        // Model priority: DB session row → GOOSE_MODEL env var → None.
        let model = db_model
            .filter(|m| !m.is_empty())
            .or_else(|| std::env::var("GOOSE_MODEL").ok());

        // Logs directory in student's persistent home.
        let logs_dir = std::path::PathBuf::from(&state.workspace_root)
            .parent()
            .unwrap_or(std::path::Path::new("/data"))
            .join(format!("students/{}", student_id))
            .join(".goose/logs");

        // GOOSE_PATH_ROOT = student's persistent upper layer (OverlayFS upper).
        let goose_path_root = std::path::PathBuf::from(&state.students_root)
            .join(&student_id);

        let xai_present = env_vars.iter().any(|(k, _)| k == "XAI_API_KEY");
        let anthropic_present = env_vars.iter().any(|(k, _)| k == "ANTHROPIC_API_KEY");
        tracing::info!(
            session_id = %sid,
            model = ?model,
            xai_key = xai_present,
            anthropic_key = anthropic_present,
            goose_path_root = %goose_path_root.display(),
            "ACP spawn: credentials check"
        );

        // ── Check registry for a surviving session (reconnect path) ────────
        let existing_session = registry.get(&sid).await;
        let existing_session = if let Some(ref managed) = existing_session {
            if managed.is_in_grace_period().await {
                tracing::info!(session_id = %sid, "🔄 [WS] Reconnecting to session in grace period");
                Some(managed.clone())
            } else {
                // Grace period already expired — remove stale entry, start fresh
                tracing::info!(session_id = %sid, "⚠️ [WS] Stale session in registry (grace period expired), starting fresh");
                registry.remove(&sid).await;
                None
            }
        } else {
            None
        };

        let result = run_acp_session(
            socket,
            goose_bin.into(),
            dirs.merged.clone(),
            goose_path_root,
            dirs.config.clone(),
            env_vars,
            model,
            last_input_at,
            pool,
            sid.clone(),
            student_id,
            logs_dir,
            system_prompt,
            Some(registry.clone()),
            existing_session,
        )
        .await;

        if let Err(e) = result {
            tracing::error!(session_id = %sid, error = %e, "ACP session error");
        }

        broker.set_pty_sender(&sid, None).await;
        tracing::info!(session_id = %sid, "WebSocket handler exited");
    }))
}
