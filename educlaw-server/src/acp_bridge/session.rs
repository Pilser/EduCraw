// acp_bridge/session.rs
//
// Top-level session orchestrator.
//
// `run_acp_session` is the single public entry point called by the WebSocket
// handler.  It:
//   1. Writes the per-student system-prompt override to goose's config dir.
//   2. Spawns `goose acp` as a subprocess with piped stdio.
//   3. Drains stderr to the tracing log.
//   4. Bootstraps the sacp client (ACP handshake + session creation).
//   5. Starts the model-switch poller.
//   6. Runs the WebSocket writer task (single writer for all output channels).
//   7. Runs the WebSocket input loop (prompt dispatch + cancel + resize no-op).

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use sacp::schema::{CancelNotification, ContentBlock, ImageContent, PromptRequest, SessionId, StopReason, TextContent};
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
    // ── 1. Write system-prompt override ───────────────────────────────────
    if let Some(ref prompt) = system_prompt {
        let prompt_dir = goose_path_root.join("config/prompts");
        tokio::fs::create_dir_all(&prompt_dir).await.ok();
        tokio::fs::write(prompt_dir.join("system.md"), prompt)
            .await
            .ok();
        tracing::debug!(session_id = %session_id, "wrote system prompt override");
    }

    // ── 2. Spawn `goose acp` ──────────────────────────────────────────────
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
        bin = %goose_bin.display(),
        model = ?model,
        workspace = %workspace.display(),
        goose_path_root = %goose_path_root.display(),
        xai_key = env_vars.iter().any(|(k, _)| k == "XAI_API_KEY"),
        anthropic_key = env_vars.iter().any(|(k, _)| k == "ANTHROPIC_API_KEY"),
        "acp: spawning goose"
    );

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Session(format!("failed to spawn goose: {e}")))?;

    let child_stdin = child.stdin.take().expect("stdin piped");
    let child_stdout = child.stdout.take().expect("stdout piped");
    let child_stderr = child.stderr.take().expect("stderr piped");

    // ── 3. Drain stderr to tracing ────────────────────────────────────────
    tokio::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut lines = tokio::io::BufReader::new(child_stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::debug!(target: "goose_stderr", "{}", line);
        }
    });

    // ── 4. Output channels ────────────────────────────────────────────────
    // notification frames (assistant text, tool events, token usage)
    let (notif_tx, mut notif_rx) =
        mpsc::channel::<(Option<serde_json::Value>, Option<Vec<u8>>)>(128);
    // control frames (chat_start, model_changed, token_limit_reached)
    let (ctrl_tx, mut ctrl_rx) = mpsc::channel::<String>(16);
    // per-turn completion frames (chat_end / chat_error)
    let (turn_tx, mut turn_rx) = mpsc::channel::<String>(4);

    // Shared current-model tracker updated by model_poller and read by notifications.
    let model_arc = Arc::new(tokio::sync::Mutex::new(model.clone()));

    // ── 5. Bootstrap sacp client ──────────────────────────────────────────
    let (cx, acp_session_id) = spawn_sacp_client(
        child_stdin,
        child_stdout,
        workspace.clone(),
        model.clone(),
        notif_tx,
        pool.clone(),
        student_id.clone(),
    )
    .await?;

    tracing::info!(
        session_id = %session_id,
        acp_session_id = %acp_session_id.0,
        "ACP session ready"
    );

    // ── 6. Model-switch poller ────────────────────────────────────────────
    spawn_model_poller(
        session_config_dir.join("pending_model.txt"),
        cx.clone(),
        acp_session_id.clone(),
        session_id.clone(),
        pool.clone(),
        model_arc.clone(),
        ctrl_tx.clone(),
    );

    // ── 7. WebSocket split + single writer task ───────────────────────────
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

    // ── 8. WebSocket input loop ───────────────────────────────────────────
    while let Some(msg) = ws_receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) else {
                    continue;
                };
                handle_client_message(
                    client_msg,
                    &cx,
                    &acp_session_id,
                    &pool,
                    &student_id,
                    &session_id,
                    &ctrl_tx,
                    &turn_tx,
                    &last_input_at,
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

// ---------------------------------------------------------------------------
// Input dispatch helper (keeps the main loop readable)
// ---------------------------------------------------------------------------

async fn handle_client_message(
    msg: ClientMessage,
    cx: &ConnectionTo<SacpAgent>,
    acp_session_id: &SessionId,
    pool: &SqlitePool,
    student_id: &str,
    session_id: &str,
    ctrl_tx: &mpsc::Sender<String>,
    turn_tx: &mpsc::Sender<String>,
    last_input_at: &Arc<AtomicU64>,
) {
    match msg {
        ClientMessage::Input { data, image, mime_type } => {
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
            let sid_prompt = acp_session_id.clone();
            let turn_tx_prompt = turn_tx.clone();
            tokio::spawn(async move {
                let resp = cx_prompt
                    .send_request(PromptRequest::new(sid_prompt, content_blocks))
                    .block_task()
                    .await;

                let frame = match resp {
                    Ok(r) => match r.stop_reason {
                        StopReason::EndTurn | StopReason::Cancelled => {
                            r#"{"type":"chat_end"}"#.to_string()
                        }
                        other => serde_json::json!({
                            "type": "chat_error",
                            "error": format!("stop_reason: {other:?}")
                        })
                        .to_string(),
                    },
                    Err(e) => serde_json::json!({
                        "type": "chat_error",
                        "error": e.to_string()
                    })
                    .to_string(),
                };
                let _ = turn_tx_prompt.send(frame).await;
            });
        }

        ClientMessage::Cancel => {
            if let Err(e) =
                cx.send_notification(CancelNotification::new(acp_session_id.clone()))
            {
                tracing::warn!(
                    session_id = %session_id,
                    error = %e,
                    "failed to send cancel notification"
                );
            }
        }

        // Resize events are no-ops for ACP (goose runs headless, no PTY).
        ClientMessage::Resize { .. } => {}
    }
}
