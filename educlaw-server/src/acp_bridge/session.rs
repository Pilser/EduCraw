// acp_bridge/session.rs
//
// SSE-based session orchestrator.
//
//   init_acp_session   — lazy goose spawn + registry registration
//   handle_input_sse   — process user prompt, return SSE event stream
//   handle_cancel      — send CancelNotification to goose
//   handle_replay_sse  — load historical thread, replay as SSE

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sacp::schema::{
    CancelNotification, ContentBlock, NewSessionRequest, PromptRequest, SessionId,
    StopReason, TextContent,
};
use tokio::sync::{mpsc, Mutex};

use crate::db::DbBackend;
use crate::db::TurnTokens;
use crate::error::{AppError, Result};
use crate::session::broker::now_secs;
use crate::session::namespace::{build_pivot_root_script, session_ip_block, setup_veth_pair};
use crate::session::registry::{ManagedSession, SessionRegistry};

use super::client::spawn_sacp_client;
use super::commands::handle_load_session as acp_handle_load_session;
use super::images;
use super::model_poller::spawn_model_poller;
use super::token_calculator;


// ════════════════════════════════════════════════════════════════════════════
// SSE Migration — new types and functions
// ════════════════════════════════════════════════════════════════════════════

/// SSE event that flows from the backend to the HTTP response stream.
#[derive(Debug, Clone)]
pub enum SseEvent {
    /// A JSON frame string ready to be wrapped as an SSE event.
    Text(String),
    /// End the current SSE stream (close connection).
    Close,
}

/// An SSE event stream that can be consumed by an axum handler to produce
/// a `text/event-stream` response body.
pub struct SseEventStream {
    pub rx: mpsc::Receiver<SseEvent>,
}

/// Initialise the ACP session (spawn goose, register in registry).
/// Called lazily from the first `POST /sessions/{id}/input` when
/// no managed session exists yet.
pub async fn init_acp_session(
    goose_bin: PathBuf,
    workspace: PathBuf,
    goose_path_root: PathBuf,
    session_config_dir: PathBuf,
    env_vars: Vec<(String, String)>,
    model: Option<String>,
    backend: Arc<dyn DbBackend>,
    session_id: String,
    student_id: String,
    _logs_dir: PathBuf,
    system_prompt: Option<String>,
    registry: Arc<SessionRegistry>,
) -> Result<()> {
    // Already initialised?
    if registry.get(&session_id).await.is_some() {
        return Ok(());
    }

    tokio::fs::create_dir_all(&goose_path_root).await.ok();
    tokio::fs::create_dir_all(&session_config_dir).await.ok();

    if let Some(ref prompt) = system_prompt {
        let prompt_dir = goose_path_root.join("config").join("prompts");
        tokio::fs::create_dir_all(&prompt_dir).await.ok();
        tokio::fs::write(prompt_dir.join("system.md"), prompt)
            .await
            .ok();
    }

    // Resolve IP block from session_id (deterministic, no external state)
    let (b1, b2) = session_ip_block(&session_id);

    // Build pivot_root inner script (filesystem jail + network config inside ns)
    let merged = workspace.display().to_string();
    let goose_bin_path = goose_bin.display().to_string();
    let goose_path_root_host = goose_path_root.display().to_string();
    let claw_config_home_host = session_config_dir.display().to_string();
    let goose_path_root_in_jail = "/goose_home";
    let claw_config_home_in_jail = "/claw_config";
    let inner_script = build_pivot_root_script(
        &merged,
        &session_id,
        &goose_bin_path,
        &goose_path_root_host,
        &claw_config_home_host,
        b1,
        b2,
    );

    let mut cmd = tokio::process::Command::new("unshare");
    let is_root = unsafe { libc::getuid() } == 0;
    if is_root {
        cmd.args([
            "--mount", "--pid", "--net", "--fork",
            "sh", "-c", &inner_script,
        ]);
    } else {
        cmd.args([
            "--user", "--map-root-user", "--mount", "--pid", "--net", "--fork",
            "sh", "-c", &inner_script,
        ]);
    }
    cmd.current_dir(&workspace);
    cmd.env_clear();
    cmd.env("GOOSE_PATH_ROOT", goose_path_root_in_jail);
    cmd.env("CLAW_CONFIG_HOME", claw_config_home_in_jail);
    for (k, v) in &env_vars {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // seccomp + setsid in pre_exec
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                if let Ok(filter) = crate::security::seccomp::build_student_filter() {
                    seccompiler::apply_filter(&filter)
                        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
                }
                Ok(())
            });
        }
    }

    tracing::info!(
        session_id = %session_id,
        model = ?model,
        goose_path_root_host = %goose_path_root.display(),
        config_home_host = %session_config_dir.display(),
        goose_path_root_in_jail = goose_path_root_in_jail,
        config_home_in_jail = claw_config_home_in_jail,
        "📦 [GOOSE] Spawning ACP subprocess (SSE init)..."
    );

    let mut child = cmd.spawn().map_err(|e| {
        AppError::Session(format!("failed to spawn goose: {e}"))
    })?;

    let pid = child.id().ok_or_else(|| {
        AppError::Session("goose spawn produced no PID".to_string())
    })?;

    tracing::info!(session_id = %session_id, pid = pid, "✓ [GOOSE] Subprocess spawned (SSE init)");

    // Configure veth pair from host side (Option B: nsenter from host)
    setup_veth_pair(pid, b1, b2).await?;
    tracing::info!(session_id = %session_id, b1, b2, "veth pair configured");

    let child_stdin = child.stdin.take().expect("stdin piped");
    let child_stdout = child.stdout.take().expect("stdout piped");
    let child_stderr = child.stderr.take().expect("stderr piped");

    // Drain stderr
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

    let (notif_tx_new, _notif_rx) =
        mpsc::channel::<(Option<serde_json::Value>, Option<Vec<u8>>)>(128);
    let notif_tx_shared = Arc::new(Mutex::new(notif_tx_new));

    // Resolve provider
    let provider = match &model {
        Some(model_name) => {
            match backend.get_model_by_name(model_name).await {
                Ok(Some(m)) => m.provider,
                _ => None,
            }
        }
        None => None,
    };

    let (cx, acp_session_id_holder, available_models_from_goose) = spawn_sacp_client(
        child_stdin,
        child_stdout,
        workspace.clone(),
        model.clone(),
        provider,
        notif_tx_shared.clone(),
        backend.clone(),
        student_id.clone(),
        session_id.clone(),
        loading_flag.clone(),
        model_arc.clone(),
    )
    .await?;

    let available_models_arc = Arc::new(Mutex::new(available_models_from_goose));

    tracing::info!(session_id = %session_id, "✓ [SESSION] SSE-init ready");

    spawn_model_poller(
        session_config_dir.join("pending_model.txt"),
        cx.clone(),
        acp_session_id_holder.clone(),
        session_id.clone(),
        backend.clone(),
        model_arc.clone(),
        // Model poller ctrl_tx is a dummy channel — no persistent connection needed
        {
            let (tx, _) = mpsc::channel::<String>(1);
            tx
        },
    );

    let managed = ManagedSession::new(
        cx.clone(),
        child,
        pid,
        notif_tx_shared.clone(),
        acp_session_id_holder.clone(),
        model_arc,
        available_models_arc,
        loading_flag,
        student_id.clone(),
        backend.clone(),
        registry.disconnect_timeout,
        session_config_dir.clone(),
    );
    registry.register(session_id.clone(), managed).await;

    Ok(())
}

/// Process user input for an existing managed session and return an SSE event
/// stream.  This replaces the old input loop's `Input` arm.
pub async fn handle_input_sse(
    session_id: &str,
    registry: &Arc<SessionRegistry>,
    data: String,
    image: Option<String>,
    mime_type: Option<String>,
    backend: Arc<dyn DbBackend>,
    student_id: &str,
    workspace: &PathBuf,
    last_input_at: Arc<AtomicU64>,
) -> Result<SseEventStream> {
    let managed = registry
        .get(session_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

    // Check if goose child has exited
    {
        let mut child_guard = managed.child.lock().await;
        if let Some(ref mut c) = *child_guard {
            if let Ok(Some(_status)) = c.try_wait() {
                // Goose is dead — clean up registry and tell the frontend
                *child_guard = None;
                drop(child_guard);
                registry.remove(session_id).await;
                tracing::info!(session_id = %session_id, "💀 [SSE] Goose dead — removed from registry");

                let (sse_tx, sse_rx) = mpsc::channel::<SseEvent>(4);
                let frame = serde_json::json!({
                    "type": "session_terminated",
                    "reason": "goose_dead",
                })
                .to_string();
                let _ = sse_tx.send(SseEvent::Text(frame)).await;
                let _ = sse_tx.send(SseEvent::Close).await;
                return Ok(SseEventStream { rx: sse_rx });
            }
        }
    }

    // Restriction gate
    let restricted = backend.get_student(student_id)
        .await
        .ok()
        .flatten()
        .map(|s| s.restriction_status.is_some())
        .unwrap_or(false);

    if restricted {
        let message = backend.get_student(student_id)
            .await
            .ok()
            .flatten()
            .and_then(|s| s.restriction_message)
            .unwrap_or_else(|| {
                "Your account has been restricted. Please contact your administrator.".to_string()
            });
        let (sse_tx, sse_rx) = mpsc::channel::<SseEvent>(4);
        let frame = serde_json::json!({"type": "restriction", "message": message}).to_string();
        let _ = sse_tx.send(SseEvent::Text(frame)).await;
        let _ = sse_tx.send(SseEvent::Close).await;
        return Ok(SseEventStream { rx: sse_rx });
    }

    last_input_at.store(now_secs(), Ordering::Relaxed);
    if data.trim().is_empty() && image.is_none() {
        // Empty input — return an immediate close
        let (sse_tx, sse_rx) = mpsc::channel::<SseEvent>(4);
        let _ = sse_tx.send(SseEvent::Close).await;
        return Ok(SseEventStream { rx: sse_rx });
    }

    // Create the SSE channel for this request
    let (sse_tx, sse_rx) = mpsc::channel::<SseEvent>(256);

    // Create notification channel and redirect sacp callback
    let (notif_tx_req, mut notif_rx_req) =
        mpsc::channel::<(Option<serde_json::Value>, Option<Vec<u8>>)>(128);
    *managed.notif_tx_shared.lock().await = notif_tx_req;

    // Spawn notification forwarding task
    let sse_tx_notif = sse_tx.clone();
    tokio::spawn(async move {
        while let Some((json_frame, _binary_frame)) = notif_rx_req.recv().await {
            if let Some(j) = json_frame {
                if let Ok(text) = serde_json::to_string(&j) {
                    if sse_tx_notif.send(SseEvent::Text(text)).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Send chat_start
    let _ = sse_tx
        .send(SseEvent::Text(r#"{"type":"chat_start"}"#.to_string()))
        .await;

    // Build content blocks
    let mut content_blocks = Vec::new();
    if !data.trim().is_empty() {
        content_blocks.push(ContentBlock::Text(TextContent::new(data.clone())));
    }
    if let Some(img_data) = image {
        if let Some((base64, parsed_mime)) = images::parse_image_data(&img_data) {
            let actual_mime = mime_type.unwrap_or(parsed_mime);
            if let Some(img_content) = images::create_image_content(&base64, &actual_mime) {
                content_blocks.push(ContentBlock::Image(img_content));
            }
        }
    }

    // Spawn prompt task
    let cx_prompt = managed.cx.clone();
    let sid_holder_prompt = managed.acp_session_id.clone();
    let sse_tx_prompt = sse_tx.clone();
    let session_id_for_prompt = session_id.to_string();
    let workspace_for_prompt = workspace.clone();
    let backend_for_prompt = backend.clone();

    tokio::spawn(async move {
        let sid_prompt = {
            let mut holder = sid_holder_prompt.lock().await;
            if let Some(existing_sid) = holder.as_ref() {
                existing_sid.clone()
            } else {
                // First prompt — create NewSession
                let provider = {
                    let model_name = backend_for_prompt.get_session(&session_id_for_prompt)
                        .await
                        .ok()
                        .flatten()
                        .and_then(|s| s.model);
                    match model_name {
                        Some(ref mn) => {
                            backend_for_prompt.get_model_by_name(mn)
                                .await
                                .ok()
                                .flatten()
                                .and_then(|m| m.provider)
                        }
                        None => None,
                    }
                };
                // Inside the pivot_root jail, workspace root is '/'.
                let mut nsr = NewSessionRequest::new("/");
                if let Some(ref provider) = provider {
                    let mut meta = serde_json::Map::new();
                    meta.insert("provider".to_string(), serde_json::Value::String(provider.clone()));
                    nsr = nsr.meta(meta);
                }
                match cx_prompt.send_request(nsr).block_task().await {
                    Ok(new_sess_resp) => {
                        let new_sid = new_sess_resp.session_id.clone();
                        let frame = serde_json::json!({
                            "type": "session_created",
                            "session_id": new_sid.0,
                        })
                        .to_string();
                        let _ = sse_tx_prompt.send(SseEvent::Text(frame)).await;
                        *holder = Some(new_sid.clone());
                        new_sid
                    }
                    Err(e) => {
                        let frame = serde_json::json!({
                            "type": "chat_error",
                            "error": format!("Failed to create session: {}", e),
                        })
                        .to_string();
                        let _ = sse_tx_prompt.send(SseEvent::Text(frame)).await;
                        let _ = sse_tx_prompt.send(SseEvent::Close).await;
                        return;
                    }
                }
            }
        };

        let resp = cx_prompt
            .send_request(PromptRequest::new(sid_prompt, content_blocks))
            .block_task()
            .await;

        // Token accounting
        if let Ok(ref r) = resp {
            if let Some(usage) = &r.usage {
                let input_tokens = usage.input_tokens as i64;
                let output_tokens = usage.output_tokens as i64;
                if input_tokens + output_tokens > 0 {
                    let backend_clone = backend_for_prompt.clone();
                    let sid_clone = session_id_for_prompt.clone();
                    let student_id_clone = match backend_for_prompt.get_session(&session_id_for_prompt).await {
                        Ok(Some(s)) => s.student_id,
                        _ => String::new(),
                    };
                    let model_name_clone = backend_for_prompt.get_session(&session_id_for_prompt)
                        .await
                        .ok()
                        .flatten()
                        .and_then(|s| s.model)
                        .unwrap_or_else(|| "grok-4-1-fast-reasoning".to_string());
                    if !student_id_clone.is_empty() {
                        tokio::spawn(async move {
                            let tokens = TurnTokens {
                                model: model_name_clone.clone(),
                                input_tokens,
                                output_tokens,
                                cache_creation_input_tokens: 0,
                                cache_read_input_tokens: 0,
                            };
                            let _ = backend_clone.record_turn(&student_id_clone, &sid_clone, &tokens).await;
                            let _ = token_calculator::calculate_and_deduct(
                                &*backend_clone, &student_id_clone, &sid_clone,
                                &model_name_clone, input_tokens, output_tokens,
                            ).await;
                        });
                    }
                }
            }
        }

        let frame = match resp {
            Ok(r) => {
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
                serde_json::json!({
                    "type": "chat_error",
                    "error": e.to_string()
                })
                .to_string()
            }
        };
        let _ = sse_tx_prompt.send(SseEvent::Text(frame)).await;
        let _ = sse_tx_prompt.send(SseEvent::Close).await;
    });

    Ok(SseEventStream { rx: sse_rx })
}

/// Cancel the current in-flight prompt for a managed session.
pub async fn handle_cancel(
    session_id: &str,
    registry: &Arc<SessionRegistry>,
) -> Result<()> {
    let managed = registry
        .get(session_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

    let Some(sid) = managed.acp_session_id.lock().await.clone() else {
        return Ok(()); // No active session to cancel — no-op
    };

    if let Err(e) = managed.cx.send_notification(CancelNotification::new(sid)) {
        tracing::warn!(session_id = %session_id, error = %e, "cancel notification failed");
    } else {
        tracing::info!(session_id = %session_id, "✓ [SSE] Cancel sent");
    }

    Ok(())
}

/// Load a thread and replay its history as an SSE event stream.
pub async fn handle_replay_sse(
    session_id: &str,
    thread_id: &str,
    registry: &Arc<SessionRegistry>,
    backend: Arc<dyn DbBackend>,
    session_config_dir: PathBuf,
) -> Result<SseEventStream> {
    let managed = registry
        .get(session_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

    let (sse_tx, sse_rx) = mpsc::channel::<SseEvent>(256);

    // Fresh notification channel for this replay
    let (notif_tx_req, mut notif_rx_req) =
        mpsc::channel::<(Option<serde_json::Value>, Option<Vec<u8>>)>(128);
    *managed.notif_tx_shared.lock().await = notif_tx_req;

    // Forward notifications to SSE
    let sse_tx_notif = sse_tx.clone();
    tokio::spawn(async move {
        while let Some((json_frame, _binary_frame)) = notif_rx_req.recv().await {
            if let Some(j) = json_frame {
                if let Ok(text) = serde_json::to_string(&j) {
                    if sse_tx_notif.send(SseEvent::Text(text)).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Restart model poller so pending model switches work during replay
    spawn_model_poller(
        session_config_dir.join("pending_model.txt"),
        managed.cx.clone(),
        managed.acp_session_id.clone(),
        session_id.to_string(),
        backend.clone(),
        managed.model_arc.clone(),
        {
            let (tx, _) = mpsc::channel::<String>(1);
            tx
        },
    );

    let cx = managed.cx.clone();
    let loading_flag = managed.loading_flag.clone();
    let acp_sid_holder = managed.acp_session_id.clone();
    let tid = thread_id.to_string();

    let sse_tx_load = sse_tx.clone();
    tokio::spawn(async move {
        loading_flag.store(true, Ordering::Relaxed);

        match acp_handle_load_session(&cx, tid.clone()).await {
            Ok(()) => {
                let loaded_sid = SessionId::new(tid.clone());
                *acp_sid_holder.lock().await = Some(loaded_sid);
                tokio::time::sleep(Duration::from_millis(150)).await;
                loading_flag.store(false, Ordering::Relaxed);

                let frame = serde_json::json!({
                    "type": "load_session_complete",
                    "thread_id": tid,
                })
                .to_string();
                let _ = sse_tx_load.send(SseEvent::Text(frame)).await;
            }
            Err(e) => {
                loading_flag.store(false, Ordering::Relaxed);
                let frame = serde_json::json!({
                    "type": "error",
                    "message": format!("Failed to load session: {}", e),
                })
                .to_string();
                let _ = sse_tx_load.send(SseEvent::Text(frame)).await;
            }
        }
        let _ = sse_tx_load.send(SseEvent::Close).await;
    });

    Ok(SseEventStream { rx: sse_rx })
}
