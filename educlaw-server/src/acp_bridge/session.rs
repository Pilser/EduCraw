// acp_bridge/session.rs
//
// Top-level session orchestrator.
//
// `run_acp_session` is the single public entry point called by the WebSocket
// handler.  It:
//   1. Initializes isolated namespace (goose auto-creates config/data/state dirs)
//   2. Validates model name against known xAI grok models
//   3. Writes per-student system-prompt override to goose's config dir
//   4. Spawns `goose acp` as a subprocess with piped stdio (provider config via env vars)
//   5. Drains stderr to the tracing log
//   6. Bootstraps the sacp client (ACP handshake + session creation)
//   7. Starts the model-switch poller
//   8. Runs the WebSocket writer task (single writer for all output channels)
//   9. Runs the WebSocket input loop (prompt dispatch + cancel + resize no-op)

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use sacp::schema::{CancelNotification, ContentBlock, ImageContent, NewSessionRequest, PromptRequest, SessionId, StopReason, TextContent};
use sacp::{Agent as SacpAgent, ConnectionTo};
use sqlx::SqlitePool;
use tokio::sync::mpsc;

use crate::db::students as db_students;
use crate::error::{AppError, Result};
use crate::session::broker::now_secs;

use super::client::spawn_sacp_client;
use super::images;
use super::messages::ClientMessage;
use super::model_poller::spawn_model_poller;

pub async fn run_acp_session(
    ws: WebSocket,
    goose_bin: PathBuf,
    workspace: PathBuf,
    // GOOSE_PATH_ROOT — student's persistent OverlayFS upper layer.
    goose_path_root: PathBuf,
    // Per-session ephemeral config directory; contains `pending_model.txt`.
    session_config_dir: PathBuf,
    env_vars: Vec<(String, String)>,
    model: Option<String>,
    last_input_at: Arc<AtomicU64>,
    pool: SqlitePool,
    session_id: String,
    student_id: String,
    // Logs directory path (reserved for future use / external log shipping).
    _logs_dir: PathBuf,
    system_prompt: Option<String>,
) -> Result<()> {
    // Initialize isolated namespace (config pre-populated during student onboarding)
    tokio::fs::create_dir_all(&goose_path_root).await.ok();

    // Write per-session system-prompt override
    if let Some(ref prompt) = system_prompt {
        let goose_config_dir = goose_path_root.join("config");
        let prompt_dir = goose_config_dir.join("prompts");
        tokio::fs::create_dir_all(&prompt_dir).await.ok();
        tokio::fs::write(prompt_dir.join("system.md"), prompt)
            .await
            .ok();
    }

    // Spawn goose acp subprocess with piped stdio
    let mut cmd = tokio::process::Command::new(&goose_bin);
    cmd.arg("acp");
    cmd.current_dir(&workspace);
    cmd.env_clear();
    cmd.env("GOOSE_PATH_ROOT", goose_path_root.display().to_string());
    for (k, v) in &env_vars {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    tracing::info!(
        session_id = %session_id,
        model = ?model,
        has_xai_key = env_vars.iter().any(|(k, _)| k == "XAI_API_KEY"),
        "📦 [GOOSE] Spawning ACP subprocess..."
    );

    let mut child = cmd
        .spawn()
        .map_err(|e| {
            tracing::error!("✗ [GOOSE] Spawn FAILED: {e}");
            AppError::Session(format!("failed to spawn goose: {e}"))
        })?;

    tracing::info!(
        session_id = %session_id,
        "✓ [GOOSE] Subprocess spawned successfully"
    );

    let child_stdin = child.stdin.take().expect("stdin piped");
    let child_stdout = child.stdout.take().expect("stdout piped");
    let child_stderr = child.stderr.take().expect("stderr piped");

    // Drain goose stderr to logs
    let session_id_for_stderr = session_id.clone();
    tokio::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut lines = tokio::io::BufReader::new(child_stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            // Log goose stderr with visual markers for errors/warnings
            if line.contains("error") || line.contains("Error") || line.contains("ERROR") {
                tracing::error!(target: "goose_stderr", session_id = %session_id_for_stderr, "✗ {}", line);
            } else if line.contains("warn") || line.contains("Warn") {
                tracing::warn!(target: "goose_stderr", session_id = %session_id_for_stderr, "⚠️  {}", line);
            } else {
                tracing::info!(target: "goose_stderr", session_id = %session_id_for_stderr, "📋 {}", line);
            }
        }
    });

    // Output channels for notifications, control messages, and turn completions
    let (notif_tx, mut notif_rx) =
        mpsc::channel::<(Option<serde_json::Value>, Option<Vec<u8>>)>(128);
    let (ctrl_tx, mut ctrl_rx) = mpsc::channel::<String>(16);
    let (turn_tx, mut turn_rx) = mpsc::channel::<String>(4);

    // Shared current-model tracker updated by model_poller and read by notifications.
    let model_arc = Arc::new(tokio::sync::Mutex::new(model.clone()));

    // Bootstrap SACP client and create ACP session
    tracing::info!(session_id = %session_id, "🔗 [GOOSE-ACP] Initializing ACP handshake...");
    let (cx, acp_session_id_holder, available_models_from_goose) = spawn_sacp_client(
        child_stdin,
        child_stdout,
        workspace.clone(),
        model.clone(),
        notif_tx,
        pool.clone(),
        student_id.clone(),
    )
    .await?;

    // Store available models from goose in Arc for WebSocket GetModels handler
    let available_models_arc = Arc::new(tokio::sync::Mutex::new(available_models_from_goose.clone()));

    tracing::info!(
        session_id = %session_id,
        "✓ [SESSION] ════════════════════════════════════════"
    );
    tracing::info!(
        "✓ [SESSION] Session ready (no goose session yet - lazy init)"
    );
    tracing::info!(
        "✓ [SESSION] ════════════════════════════════════════"
    );

    // Start model-switch poller
    spawn_model_poller(
        session_config_dir.join("pending_model.txt"),
        cx.clone(),
        acp_session_id_holder.clone(),
        session_id.clone(),
        pool.clone(),
        model_arc.clone(),
        ctrl_tx.clone(),
    );

    // WebSocket writer task (single writer for all output channels)
    let (mut ws_sender, mut ws_receiver) = ws.split();

    let writer_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(ctrl_msg) = ctrl_rx.recv() => {
                    if ws_sender.send(Message::Text(ctrl_msg)).await.is_err() {
                        break;
                    }
                }
                Some(turn_msg) = turn_rx.recv() => {
                    if ws_sender.send(Message::Text(turn_msg)).await.is_err() {
                        break;
                    }
                }
                Some((json_frame, binary_frame)) = notif_rx.recv() => {
                    if let Some(b) = binary_frame {
                        if ws_sender.send(Message::Binary(b.into())).await.is_err() {
                            break;
                        }
                    }
                    if let Some(j) = json_frame {
                        if let Ok(text) = serde_json::to_string(&j) {
                            if ws_sender.send(Message::Text(text)).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                else => break,
            }
        }
    });

    // WebSocket input loop (prompt dispatch, cancel, resize no-op)
    while let Some(msg) = ws_receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) else {
                    tracing::debug!(session_id = %session_id, "✗ [WS] Failed to parse: {}", text.chars().take(100).collect::<String>());
                    continue;
                };
                
                // Only log non-resize messages to reduce noise
                match &client_msg {
                    ClientMessage::Resize { .. } => {
                        tracing::debug!(session_id = %session_id, "🔧 [WS] Resize: {}", text);
                    }
                    _ => {
                        tracing::info!(session_id = %session_id, "📨 [WS] Message: {}", text);
                    }
                }
                
                handle_client_message(
                    client_msg,
                    &cx,
                    &acp_session_id_holder,
                    &workspace,
                    &pool,
                    &student_id,
                    &session_id,
                    &ctrl_tx,
                    &turn_tx,
                    &last_input_at,
                    &available_models_arc,
                )
                .await;
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    writer_task.abort();
    let _ = child.kill().await;
    Ok(())
}

// Dispatch client messages to ACP session
async fn handle_client_message(
    msg: ClientMessage,
    cx: &ConnectionTo<SacpAgent>,
    acp_session_id_holder: &Arc<tokio::sync::Mutex<Option<SessionId>>>,
    workspace: &PathBuf,
    pool: &SqlitePool,
    student_id: &str,
    session_id: &str,
    ctrl_tx: &mpsc::Sender<String>,
    turn_tx: &mpsc::Sender<String>,
    last_input_at: &Arc<AtomicU64>,
    available_models_arc: &Arc<tokio::sync::Mutex<Vec<String>>>,
) {
    match msg {
        ClientMessage::Input { data, image, mime_type } => {
            tracing::info!(session_id = %session_id, "📥 [INPUT] Processing input message (len={}, has_image={})", data.len(), image.is_some());
            
            // ── Token-block gate ──────────────────────────────────────
            let blocked = db_students::get_student(pool, student_id)
                .await
                .ok()
                .flatten()
                .map(|s| s.token_blocked_at.is_some())
                .unwrap_or(false);

            if blocked {
                let banner = db_students::get_student(pool, student_id)
                    .await
                    .ok()
                    .flatten()
                    .and_then(|s| s.token_block_banner)
                    .unwrap_or_else(|| {
                        "Your token allowance has been reached. \
                         Please contact your administrator to continue."
                            .to_string()
                    });
                let frame =
                    serde_json::json!({"type": "token_limit_reached", "banner": banner})
                        .to_string();
                let _ = ctrl_tx.send(frame).await;
                return;
            }

            last_input_at.store(now_secs(), Ordering::Relaxed);

            if data.trim().is_empty() && image.is_none() {
                return;
            }

            let _ = ctrl_tx.send(r#"{"type":"chat_start"}"#.to_string()).await;

            // ── Build content blocks (text + optional image) ──────────
            let mut content_blocks = Vec::new();
            
            // Add text if present
            if !data.trim().is_empty() {
                content_blocks.push(ContentBlock::Text(TextContent::new(data.clone())));
            }

            // Add image if present
            if let Some(img_data) = image {
                if let Some((base64, parsed_mime)) = images::parse_image_data(&img_data) {
                    // Prefer user-provided mime_type, otherwise use parsed mime, otherwise "image/png"
                    let actual_mime = mime_type.unwrap_or(parsed_mime);
                    if let Some(img_content) = images::create_image_content(&base64, &actual_mime) {
                        content_blocks.push(ContentBlock::Image(img_content));
                        tracing::debug!(mime_type = %actual_mime, "image content block added");
                    } else {
                        tracing::warn!("failed to create image content block");
                    }
                } else {
                    tracing::warn!("invalid image data format");
                }
            }

            // ── Spawn prompt task ─────────────────────────────────────
            let cx_prompt = cx.clone();
            let sid_holder_prompt = acp_session_id_holder.clone();
            let turn_tx_prompt = turn_tx.clone();
            let session_id_for_prompt = session_id.to_string();
            let workspace_for_prompt = workspace.clone();
            tokio::spawn(async move {
                // Ensure we have an active ACP session - create NewSession if needed
                let sid_prompt = {
                    let mut holder = sid_holder_prompt.lock().await;
                    if let Some(existing_sid) = holder.as_ref() {
                        tracing::info!(
                            session_id = %session_id_for_prompt,
                            acp_session_id = %existing_sid.0,
                            "✅ [ACP] Using existing session for prompt"
                        );
                        existing_sid.clone()
                    } else {
                        // First prompt - create NewSession now
                        tracing::info!(session_id = %session_id_for_prompt, "🆕 [ACP] No session yet - creating NewSession for first prompt");
                        match cx_prompt
                            .send_request(NewSessionRequest::new(&workspace_for_prompt))
                            .block_task()
                            .await
                        {
                            Ok(new_sess_resp) => {
                                let new_sid = new_sess_resp.session_id.clone();
                                tracing::info!(
                                    session_id = %session_id_for_prompt,
                                    acp_session_id = %new_sid.0,
                                    "✓ [ACP] NewSession created for first prompt"
                                );
                                *holder = Some(new_sid.clone());
                                new_sid
                            }
                            Err(e) => {
                                tracing::error!(
                                    session_id = %session_id_for_prompt,
                                    "✗ [ACP] Failed to create NewSession: {}", e
                                );
                                // Send error frame and return early
                                let frame = serde_json::json!({
                                    "type": "chat_error",
                                    "error": format!("Failed to create session: {}", e)
                                })
                                .to_string();
                                let _ = turn_tx_prompt.send(frame).await;
                                return;
                            }
                        }
                    }
                };

                tracing::info!(session_id = %session_id_for_prompt, "🚀 [ACP] Sending PromptRequest to goose...");
                let resp = cx_prompt
                    .send_request(PromptRequest::new(sid_prompt, content_blocks))
                    .block_task()
                    .await;
                tracing::info!(session_id = %session_id_for_prompt, "📡 [ACP] PromptRequest response received: {:?}", resp.is_ok());

                let frame = match resp {
                    Ok(r) => {
                        tracing::info!(session_id = %session_id_for_prompt, "✓ [ACP] Response OK, stop_reason: {:?}", r.stop_reason);
                        match r.stop_reason {
                            StopReason::EndTurn | StopReason::Cancelled => {
                                r#"{"type":"chat_end"}"#.to_string()
                            }
                            other => serde_json::json!({
                                "type": "chat_error",
                                "error": format!("stop_reason: {other:?}")
                            })
                            .to_string(),
                        }
                    },
                    Err(e) => {
                        tracing::error!(session_id = %session_id_for_prompt, "✗ [ACP] PromptRequest failed: {}", e);
                        serde_json::json!({
                            "type": "chat_error",
                            "error": e.to_string()
                        })
                        .to_string()
                    }
                };
                tracing::info!(session_id = %session_id_for_prompt, "📤 [WS] Sending frame back to frontend: {}", frame);
                let _ = turn_tx_prompt.send(frame).await;
            });
        }

        ClientMessage::GetModels => {
            tracing::info!(session_id = %session_id, "📋 [GET-MODELS] Requesting available models");
            // Get available models from goose (source of truth)
            let goose_models = available_models_arc.lock().await.clone();
            tracing::debug!(models_from_goose = ?goose_models, count = goose_models.len(), "📋 [GET-MODELS] Got models from goose");

            // Check if student has specific model restrictions in educlaw DB
            let has_restrictions = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM student_models WHERE student_id = ?"
            )
            .bind(student_id)
            .fetch_one(pool)
            .await
            .map(|count| count > 0)
            .unwrap_or(false);

            // If NO restrictions, use all goose models. If restrictions exist, filter by them.
            let filtered_models = if !has_restrictions {
                tracing::info!(student_id = %student_id, count = goose_models.len(), "✓ [GET-MODELS] No restrictions - returning all goose models");
                goose_models.clone()
            } else {
                // Student has specific model restrictions - filter goose models by allowed list
                match crate::db::models::models_for_student(pool, student_id).await {
                    Ok(allowed_models) => {
                        let filtered: Vec<String> = goose_models
                            .iter()
                            .filter(|m| allowed_models.contains(m))
                            .cloned()
                            .collect();
                        tracing::debug!(
                            allowed_by_educlaw = ?allowed_models,
                            after_filtering = ?filtered,
                            "📋 [GET-MODELS] Filtered goose models by educlaw restrictions"
                        );
                        filtered
                    }
                    Err(e) => {
                        tracing::warn!(student_id = %student_id, error = %e, "✗ [GET-MODELS] Failed to check restrictions");
                        goose_models.clone()
                    }
                }
            };

            // Get the session's current model (if any), otherwise first available
            let active = match crate::db::sessions::get_session(pool, session_id).await {
                Ok(Some(sess)) => {
                    if let Some(current) = sess.model {
                        if filtered_models.contains(&current) {
                            current
                        } else {
                            filtered_models.first().cloned().unwrap_or_default()
                        }
                    } else {
                        filtered_models.first().cloned().unwrap_or_default()
                    }
                }
                _ => filtered_models.first().cloned().unwrap_or_default(),
            };

            let frame = serde_json::json!({
                "type": "models",
                "models": filtered_models,
                "active": active,
            })
            .to_string();
            let _ = ctrl_tx.send(frame).await;
            tracing::info!(session_id = %session_id, count = filtered_models.len(), active = %active, "✓ [MODELS] Sent to frontend ({} models)", filtered_models.len());
        }

        ClientMessage::Cancel => {
            tracing::info!(session_id = %session_id, "🛑 [CANCEL] Received cancel request");
            
            // Check if we have an active session to cancel
            let Some(sid) = acp_session_id_holder.lock().await.clone() else {
                tracing::warn!(session_id = %session_id, "⚠️ [CANCEL] No active session to cancel");
                return;
            };
            
            if let Err(e) = cx.send_notification(CancelNotification::new(sid)) {
                tracing::warn!(
                    session_id = %session_id,
                    error = %e,
                    "✗ [CANCEL] Failed to send cancel notification"
                );
            } else {
                tracing::info!(session_id = %session_id, "✓ [CANCEL] Cancel notification sent");
            }
        }

        // Resize events are no-ops for ACP (goose runs headless, no PTY).
        ClientMessage::Resize { .. } => {}

        ClientMessage::ListSessions => {
            tracing::info!(session_id = %session_id, "📝 [LIST-SESSIONS] Fetching threads from Goose");
            match super::handle_list_sessions(&cx).await {
                Ok(sessions) => {
                    let frame = serde_json::json!({
                        "type": "sessions_list",
                        "sessions": sessions,
                    })
                    .to_string();
                    let _ = ctrl_tx.send(frame).await;
                    tracing::info!(session_id = %session_id, count = sessions.len(), "✓ [LIST-SESSIONS] Sent {} sessions to frontend", sessions.len());
                }
                Err(e) => {
                    tracing::error!(session_id = %session_id, error = %e, "✗ [LIST-SESSIONS] Failed to list sessions");
                    let frame = serde_json::json!({
                        "type": "error",
                        "message": format!("Failed to list sessions: {}", e),
                    })
                    .to_string();
                    let _ = ctrl_tx.send(frame).await;
                }
            }
        }

        ClientMessage::LoadSession { thread_id } => {
            tracing::info!(session_id = %session_id, thread_id = %thread_id, "🔄 [LOAD-SESSION] Loading thread");
            match super::handle_load_session(&cx, thread_id.clone()).await {
                Ok(()) => {
                    // LoadSession succeeded - the thread_id is now our active ACP session_id
                    let loaded_sid = SessionId::new(thread_id.clone());
                    *acp_session_id_holder.lock().await = Some(loaded_sid.clone());
                    tracing::info!(
                        session_id = %session_id,
                        thread_id = %thread_id,
                        acp_session_id = %loaded_sid.0,
                        "✓ [LOAD-SESSION] LoadSession complete, session_id set to thread_id"
                    );
                    
                    // Send completion frame so frontend can flush replay buffer
                    let frame = serde_json::json!({
                        "type": "load_session_complete",
                        "thread_id": thread_id,
                    })
                    .to_string();
                    let _ = ctrl_tx.send(frame).await;
                }
                Err(e) => {
                    tracing::error!(session_id = %session_id, thread_id = %thread_id, error = %e, "✗ [LOAD-SESSION] Failed to load session");
                    let frame = serde_json::json!({
                        "type": "error",
                        "message": format!("Failed to load session: {}", e),
                    })
                    .to_string();
                    let _ = ctrl_tx.send(frame).await;
                }
            }
        }

        ClientMessage::ForkSession { thread_id } => {
            tracing::info!(session_id = %session_id, thread_id = %thread_id, "🔗 [FORK-SESSION] Forking thread with message history");
            match super::handle_fork_session(&cx, thread_id.clone()).await {
                Ok(result) => {
                    // ForkSession succeeded - the new session_id becomes our active ACP session_id
                    let forked_sid = SessionId::new(result.new_session_id.clone());
                    *acp_session_id_holder.lock().await = Some(forked_sid.clone());
                    tracing::info!(
                        session_id = %session_id,
                        thread_id = %thread_id,
                        new_session_id = %result.new_session_id,
                        acp_session_id = %forked_sid.0,
                        "✓ [FORK-SESSION] Successfully forked, session_id set to new fork"
                    );
                    let frame = serde_json::json!({
                        "type": "forked_session",
                        "new_session_id": result.new_session_id,
                    })
                    .to_string();
                    let _ = ctrl_tx.send(frame).await;
                }
                Err(e) => {
                    tracing::error!(session_id = %session_id, thread_id = %thread_id, error = %e, "✗ [FORK-SESSION] Failed to fork session");
                    let frame = serde_json::json!({
                        "type": "error",
                        "message": format!("Failed to fork session: {}", e),
                    })
                    .to_string();
                    let _ = ctrl_tx.send(frame).await;
                }
            }
        }
    }
}
