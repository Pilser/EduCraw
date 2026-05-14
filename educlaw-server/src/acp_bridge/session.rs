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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use sacp::schema::{
    CancelNotification, ContentBlock, ImageContent, NewSessionRequest, PromptRequest, SessionId,
    StopReason, TextContent,
};
use sacp::{Agent as SacpAgent, ConnectionTo};
use sqlx::SqlitePool;
use tokio::sync::{mpsc, Mutex};

use crate::db::students as db_students;
use crate::error::{AppError, Result};
use crate::session::broker::now_secs;
use crate::session::registry::{ManagedSession, SessionRegistry};

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
    // Registry for session management (None = legacy path, no grace period).
    registry: Option<Arc<SessionRegistry>>,
    // Existing managed session when this is a reconnect (None = fresh session).
    existing_session: Option<Arc<ManagedSession>>,
) -> Result<()> {
    // ── Reconnect vs fresh session ─────────────────────────────────────────
    //
    // managed_session is set when this call is a reconnect to a surviving session.
    // In that case we skip spawning goose and re-use the stored cx / shared state.
    // We still create brand-new per-WS channels so the new writer task has fresh
    // receivers; the sacp notification callback's sender is swapped to the new one.

    // Per-WS channels (fresh on every call, reconnect or not)
    let (notif_tx_new, mut notif_rx) =
        mpsc::channel::<(Option<serde_json::Value>, Option<Vec<u8>>)>(128);
    let (ctrl_tx, mut ctrl_rx) = mpsc::channel::<String>(16);
    let (turn_tx, mut turn_rx) = mpsc::channel::<String>(4);

    // Persistent session components — either brand-new or taken from the registry
    let (cx, acp_session_id_holder, available_models_arc, model_arc, loading_flag, managed_session) =
        if let Some(ref managed) = existing_session {
            // ── RECONNECT ────────────────────────────────────────────────────
            tracing::info!(session_id = %session_id, "🔄 [SESSION] Reconnecting to existing session");
            managed.clear_grace_period().await;

            // Redirect the sacp client's notifications to the new WS channel
            *managed.notif_tx_shared.lock().await = notif_tx_new;

            // Flush any messages buffered at the moment of the previous disconnect
            let buffered = managed.take_buffered_messages().await;
            if !buffered.is_empty() {
                tracing::info!(session_id = %session_id, count = buffered.len(), "📬 [SESSION] Flushing buffered messages");
                for msg in buffered {
                    let _ = ctrl_tx.send(msg).await;
                }
            }

            // Restart model-switch poller with the new ctrl_tx
            spawn_model_poller(
                session_config_dir.join("pending_model.txt"),
                managed.cx.clone(),
                managed.acp_session_id.clone(),
                session_id.clone(),
                pool.clone(),
                managed.model_arc.clone(),
                ctrl_tx.clone(),
            );

            (
                managed.cx.clone(),
                managed.acp_session_id.clone(),
                managed.available_models_arc.clone(),
                managed.model_arc.clone(),
                managed.loading_flag.clone(),
                existing_session.clone(),
            )
        } else {
            // ── FRESH SESSION ────────────────────────────────────────────────
            // Initialize isolated namespace
            tokio::fs::create_dir_all(&goose_path_root).await.ok();

            // Write per-session system-prompt override
            if let Some(ref prompt) = system_prompt {
                let prompt_dir = goose_path_root.join("config").join("prompts");
                tokio::fs::create_dir_all(&prompt_dir).await.ok();
                tokio::fs::write(prompt_dir.join("system.md"), prompt)
                    .await
                    .ok();
            }

            // Spawn goose acp subprocess
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

            let mut child = cmd.spawn().map_err(|e| {
                tracing::error!("✗ [GOOSE] Spawn FAILED: {e}");
                AppError::Session(format!("failed to spawn goose: {e}"))
            })?;

            tracing::info!(session_id = %session_id, "✓ [GOOSE] Subprocess spawned successfully");

            let child_stdin = child.stdin.take().expect("stdin piped");
            let child_stdout = child.stdout.take().expect("stdout piped");
            let child_stderr = child.stderr.take().expect("stderr piped");

            // Drain stderr to tracing
            let sid_stderr = session_id.clone();
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut lines = tokio::io::BufReader::new(child_stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.contains("error") || line.contains("Error") || line.contains("ERROR") {
                        tracing::error!(target: "goose_stderr", session_id = %sid_stderr, "✗ {}", line);
                    } else if line.contains("warn") || line.contains("Warn") {
                        tracing::warn!(target: "goose_stderr", session_id = %sid_stderr, "⚠️  {}", line);
                    } else {
                        tracing::info!(target: "goose_stderr", session_id = %sid_stderr, "📋 {}", line);
                    }
                }
            });

            let model_arc = Arc::new(Mutex::new(model.clone()));
            let loading_flag = Arc::new(AtomicBool::new(false));

            // Wrap notif sender so the sacp callback can have its target swapped on reconnect
            let notif_tx_shared = Arc::new(Mutex::new(notif_tx_new));

            tracing::info!(session_id = %session_id, "🔗 [GOOSE-ACP] Initializing ACP handshake...");
            let (cx, acp_session_id_holder, available_models_from_goose) = spawn_sacp_client(
                child_stdin,
                child_stdout,
                workspace.clone(),
                model.clone(),
                notif_tx_shared.clone(),
                pool.clone(),
                student_id.clone(),
                session_id.clone(),
                loading_flag.clone(),
                model_arc.clone(),
            )
            .await?;

            let available_models_arc = Arc::new(Mutex::new(available_models_from_goose));

            tracing::info!(session_id = %session_id, "✓ [SESSION] ════════════════════════════════════════");
            tracing::info!("✓ [SESSION] Session ready (no goose session yet - lazy init)");
            tracing::info!("✓ [SESSION] ════════════════════════════════════════");

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

            // Register in the registry (if provided) and store child inside it.
            // Pass notif_tx_shared (the Arc) directly so the registry entry and the
            // sacp callback share the exact same Arc — swapping on reconnect works.
            let managed = if let Some(ref reg) = registry {
                let managed = ManagedSession::new(
                    cx.clone(),
                    child,
                    notif_tx_shared.clone(), // <-- same Arc the sacp client holds
                    acp_session_id_holder.clone(),
                    model_arc.clone(),
                    available_models_arc.clone(),
                    loading_flag.clone(),
                    student_id.clone(),
                    pool.clone(),
                    reg.disconnect_timeout,
                    session_config_dir.clone(),
                );
                reg.register(session_id.clone(), managed).await;
                reg.get(&session_id).await
            } else {
                None
            };

            (
                cx,
                acp_session_id_holder,
                available_models_arc,
                model_arc,
                loading_flag,
                managed,
            )
        };

    // ── WebSocket writer task ────────────────────────────────────────────
    // Buffers the current in-flight message into ManagedSession on WS failure
    // so it can be flushed on the next reconnect.
    let (mut ws_sender, mut ws_receiver) = ws.split();
    let managed_for_writer = managed_session.clone();

    let writer_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(ctrl_msg) = ctrl_rx.recv() => {
                    if ws_sender.send(Message::Text(ctrl_msg.clone())).await.is_err() {
                        if let Some(ref m) = managed_for_writer {
                            m.buffer_message(ctrl_msg).await;
                        }
                        break;
                    }
                }
                Some(turn_msg) = turn_rx.recv() => {
                    if ws_sender.send(Message::Text(turn_msg.clone())).await.is_err() {
                        if let Some(ref m) = managed_for_writer {
                            m.buffer_message(turn_msg).await;
                        }
                        break;
                    }
                }
                Some((json_frame, binary_frame)) = notif_rx.recv() => {
                    if let Some(b) = binary_frame {
                        if ws_sender.send(Message::Binary(b.into())).await.is_err() {
                            // Binary frames are not buffered (images/etc)
                            break;
                        }
                    }
                    if let Some(j) = json_frame {
                        if let Ok(text) = serde_json::to_string(&j) {
                            if ws_sender.send(Message::Text(text.clone())).await.is_err() {
                                if let Some(ref m) = managed_for_writer {
                                    m.buffer_message(text).await;
                                }
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
                    &loading_flag,
                )
                .await;
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    writer_task.abort();

    // ── Disconnect handling ──────────────────────────────────────────────
    if let Some(ref managed) = managed_session {
        // Start the 5-minute grace period — goose subprocess stays alive.
        managed.start_grace_period().await;
        tracing::info!(session_id = %session_id, "🕐 [SESSION] WS disconnected — grace period started (5 min)");

        // Spawn a timeout task that kills the child if nobody reconnects.
        let managed_kill = managed.clone();
        let sid_kill = session_id.clone();
        let timeout = managed.disconnect_timeout;
        tokio::spawn(async move {
            tokio::time::sleep(timeout).await;
            if managed_kill.is_in_grace_period().await {
                // Nobody reconnected — kill the subprocess
                let mut child_guard = managed_kill.child.lock().await;
                if let Some(ref mut c) = *child_guard {
                    let _ = c.kill().await;
                }
                *child_guard = None;
                tracing::info!(session_id = %sid_kill, "💀 [SESSION] Grace period expired — goose process killed");
            }
            // If grace period was cleared (reconnect happened) the new run_acp_session
            // owns the session lifecycle and will spawn its own timeout task.
        });
    } else {
        // No registry management — kill immediately (legacy / fallback path)
        tracing::info!(session_id = %session_id, "🔌 [SESSION] WS disconnected — no registry, killing goose immediately");
    }

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
    loading_flag: &Arc<AtomicBool>,
) {
    match msg {
        ClientMessage::Input {
            data,
            image,
            mime_type,
        } => {
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
                let frame = serde_json::json!({"type": "token_limit_reached", "banner": banner})
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
            let ctrl_tx_prompt = ctrl_tx.clone();
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
                                // Notify frontend of the new Goose thread ID
                                let frame = serde_json::json!({
                                    "type": "session_created",
                                    "session_id": new_sid.0,
                                })
                                .to_string();
                                let _ = ctrl_tx_prompt.send(frame).await;
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
                        // Log full token usage including cache tokens from PromptResponse
                        if let Some(usage) = &r.usage {
                            tracing::info!(
                                session_id = %session_id_for_prompt,
                                total_tokens = usage.total_tokens,
                                input_tokens = usage.input_tokens,
                                output_tokens = usage.output_tokens,
                                cached_read_tokens = ?usage.cached_read_tokens,
                                cached_write_tokens = ?usage.cached_write_tokens,
                                "📊 [GOOSE PROMPT RESPONSE] Full token usage from PromptResponse"
                            );
                        }
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
                    }
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

        ClientMessage::LoadSession { thread_id } => {
            // Set loading flag to skip token accounting during session replay
            loading_flag.store(true, Ordering::Relaxed);

            match super::handle_load_session(&cx, thread_id.clone()).await {
                Ok(()) => {
                    // LoadSession succeeded - the thread_id is now our active ACP session_id
                    let loaded_sid = SessionId::new(thread_id.clone());
                    *acp_session_id_holder.lock().await = Some(loaded_sid.clone());

                    // CRITICAL: Wait for notification queue to drain
                    // LoadSessionResponse arrives synchronously, but historical SessionNotifications
                    // are still being forwarded asynchronously via notif_rx channel.
                    // Without this delay, frontend receives load_session_complete before all
                    // assistant_text frames arrive, causing text segments to not render.
                    tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

                    // Clear loading flag AFTER notifications are replayed
                    loading_flag.store(false, Ordering::Relaxed);

                    // Send completion frame so frontend can flush replay buffer
                    let frame = serde_json::json!({
                        "type": "load_session_complete",
                        "thread_id": thread_id,
                    })
                    .to_string();
                    let _ = ctrl_tx.send(frame).await;
                }
                Err(e) => {
                    // Clear loading flag on error too
                    loading_flag.store(false, Ordering::Relaxed);

                    tracing::error!(session_id = %session_id, thread_id = %thread_id, error = %e, "✗ [SESSION] Failed to load session");
                    let frame = serde_json::json!({
                        "type": "error",
                        "message": format!("Failed to load session: {}", e),
                    })
                    .to_string();
                    let _ = ctrl_tx.send(frame).await;
                }
            }
        }

    }
}
