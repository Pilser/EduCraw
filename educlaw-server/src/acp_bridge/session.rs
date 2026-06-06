// acp_bridge/session.rs
//
// SSE-based session orchestrator.
//
//   init_acp_session   — lazy goose spawn + registry registration
//   handle_input_sse   — process user prompt, return SSE event stream
//   handle_cancel      — send CancelNotification to goose
//   handle_replay_sse  — load historical thread, replay as SSE

use std::collections::{HashMap, VecDeque};
use std::os::unix::io::{AsRawFd, FromRawFd, IntoRawFd};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use nix::unistd::pipe;

use sacp::schema::{
    CancelNotification, ContentBlock, NewSessionRequest, PromptRequest, SessionId,
    StopReason, TextContent,
};
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;
use chrono::Utc;

use crate::db::DbBackend;
use crate::db::TurnTokens;
use crate::error::{AppError, Result};
use crate::session::broker::now_secs;
use crate::session::container::{
    self, write_oci_config, cleanup_container_state, BindSources, ContainerEnv, SessionBundle,
};
use crate::session::namespace::{session_ip_block, setup_container_network, setup_veth_pair};
use crate::session::registry::{ManagedSession, RequestDedupeEntry, RequestState, SessionRegistry};

use super::client::spawn_sacp_client;
use super::commands::handle_load_session as acp_handle_load_session;
use super::images;
use super::token_calculator;


/// Strip ANSI escape sequences from a string.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_escape = false;
    for c in s.chars() {
        if in_escape {
            if c == 'm' || c == 'H' {
                in_escape = false;
            }
            // CSI sequences end with a letter in [A–Z@[]_`{|}~]
            else if c.is_ascii_uppercase() || c == 'h' || c == 'l' {
                in_escape = false;
            }
            continue;
        }
        if c == '\x1b' {
            in_escape = true;
            continue;
        }
        out.push(c);
    }
    out
}


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

async fn frame_with_id(managed: &Arc<ManagedSession>, mut frame: serde_json::Value) -> String {
    let frame_id = managed.frame_counter.fetch_add(1, Ordering::Relaxed);
    if let serde_json::Value::Object(ref mut map) = frame {
        map.insert(
            "id".to_string(),
            serde_json::Value::Number(serde_json::Number::from(frame_id)),
        );
    }
    frame.to_string()
}

/// Initialise the ACP session (spawn goose, register in registry).
/// Called lazily from the first `POST /sessions/{id}/input` when
/// no managed session exists yet.
pub async fn init_acp_session(
    goose_bin: PathBuf,
    goose_path_root: PathBuf,
    bundle_root: PathBuf,
    student_workspace: PathBuf,
    jail_tools_host: PathBuf,
    subject_dirs: Vec<PathBuf>,
    env_vars: Vec<(String, String)>,
    model: Option<String>,
    backend: Arc<dyn DbBackend>,
    session_id: String,
    student_id: String,
    _logs_dir: PathBuf,
    registry: Arc<SessionRegistry>,
    recent_thread_id: Option<String>,
) -> Result<()> {
    if registry.get(&session_id).await.is_some() {
        return Ok(());
    }

    tokio::fs::create_dir_all(&goose_path_root).await?;
    tokio::fs::create_dir_all(&bundle_root).await?;

    let (b1, b2) = session_ip_block(&session_id);

    // ── Build OCI container bundle ──────────────────────────────────────
    let workspace_root = bundle_root.parent().expect("bundle dir has parent");

    let bundle = SessionBundle::new(
        &session_id,
        bundle_root.clone(),
    );

    // subject_dirs are pre-resolved by the caller using collect_subject_dirs.

    let sources = BindSources {
        goose_bin: goose_bin.clone(),
        jail_tools: jail_tools_host,
        student_home: student_workspace,
        goose_path_root: goose_path_root.clone(),
        ssl_certs: PathBuf::from("/etc/ssl"),
        subject_dirs,
    };

    let env = ContainerEnv {
        env_vars,
        model: model.clone(),
    };

    write_oci_config(&bundle, &sources, &env)?;

    // ── Create pipes for stdio ──────────────────────────────────────────
    // stdin:  parent writes, container reads
    let (stdin_child, stdin_parent) = pipe()
        .map_err(|e| AppError::Session(format!("pipe stdin: {e}")))?;
    // stdout: container writes, parent reads
    let (stdout_parent, stdout_child) = pipe()
        .map_err(|e| AppError::Session(format!("pipe stdout: {e}")))?;
    // stderr: container writes, parent reads
    let (stderr_parent, stderr_child) = pipe()
        .map_err(|e| AppError::Session(format!("pipe stderr: {e}")))?;

    // ── Pre-flight: validate all bind mount sources exist ──────────────
    let bind_sources_to_check = [
        (&sources.goose_bin, "goose_bin"),
        (&sources.jail_tools, "jail_tools"),
        (&sources.student_home, "student_home"),
        (&sources.goose_path_root, "goose_path_root"),
        (&sources.ssl_certs, "ssl_certs"),
    ];
    for (path, label) in &bind_sources_to_check {
        if !path.exists() {
            return Err(AppError::Session(format!(
                "bind mount source {label} does not exist: {}",
                path.display()
            )));
        }
    }

    // Debug: inspect jail-tools structure and PATH
    let tools_path = &sources.jail_tools;
    tracing::debug!(session_id = %session_id, path = %tools_path.display(), "jail-tools source");
    match std::fs::read_dir(tools_path) {
        Ok(rd) => {
            for entry in rd.filter_map(|e| e.ok()) {
                let kind = entry.file_type().ok().map(|t| {
                    if t.is_dir() { "dir" } else if t.is_symlink() { "symlink" } else { "file" }
                }).unwrap_or("?");
                tracing::debug!(session_id = %session_id, name = %entry.path().display(), kind, "jail-tools entry");
            }
        }
        Err(e) => tracing::warn!(session_id = %session_id, error = %e, "jail-tools read_dir failed"),
    }
    for (k, v) in &env.env_vars {
        if k == "PATH" {
            tracing::debug!(session_id = %session_id, value = %v, "PATH env var");
        }
    }

    // ── Clean any stale Youki state from a previous container instance ──
    cleanup_container_state(&bundle.bundle_dir, &session_id);

    // ── Build container (synchronous — ContainerBuilder is !Send) ───────
    let mut container = container::build_container(
        &bundle,
        Some(stdin_child),
        Some(stdout_child),
        Some(stderr_child),
    )
    .map_err(|e| {
        // Give child a moment to flush any output before exit
        std::thread::sleep(std::time::Duration::from_millis(200));

        // Drain stdout pipe (Youki tracing may write to fd 1 not fd 2)
        let mut out_buf = vec![0u8; 65536];
        let mut out_total = 0usize;
        loop {
            match nix::unistd::read(stdout_parent.as_raw_fd(), &mut out_buf[out_total..]) {
                Ok(0) => break,
                Ok(n) => out_total += n,
                Err(_) => break,
            }
        }
        if out_total > 0 {
            let raw = String::from_utf8_lossy(&out_buf[..out_total]);
            let clean = strip_ansi(&raw);
            tracing::error!(
                session_id = %session_id,
                "container child stdout:\n{}",
                clean
            );
        }

        // Drain stderr pipe
        let mut err_buf = vec![0u8; 65536];
        let mut err_total = 0usize;
        loop {
            match nix::unistd::read(stderr_parent.as_raw_fd(), &mut err_buf[err_total..]) {
                Ok(0) => break,
                Ok(n) => err_total += n,
                Err(_) => break,
            }
        }
        if err_total > 0 {
            let raw = String::from_utf8_lossy(&err_buf[..err_total]);
            let clean = strip_ansi(&raw);
            tracing::error!(
                session_id = %session_id,
                "container child stderr:\n{}",
                clean
            );
        }

        // Check if bundle dir is intact
        let bundle_listing = match std::fs::read_dir(&bundle.bundle_dir) {
            Ok(rd) => rd
                .filter_map(|e| e.ok())
                .map(|e| e.path().display().to_string())
                .collect::<Vec<_>>()
                .join(", "),
            Err(e2) => format!("<read_dir error: {e2}>"),
        };
        tracing::error!(
            session_id = %session_id,
            bundle_dir = %bundle.bundle_dir.display(),
            contents = %bundle_listing,
            "bundle dir contents after build failure"
        );

        AppError::Session(format!("build container: {e}"))
    })?;

    let pid = container.pid()
        .ok_or_else(|| AppError::Session("container has no PID".to_string()))?
        .as_raw() as u32;

    tracing::info!(
        session_id = %session_id,
        pid = pid,
        bundle = %bundle.bundle_dir.display(),
        "container built"
    );

    // ── Configure veth + child-side networking before container starts ──
    setup_veth_pair(pid, b1, b2).await?;
    // Configure child-side IP, route, link state via nsenter into container netns
    setup_container_network(pid, b1, b2).await?;
    tracing::info!(session_id = %session_id, b1, b2, "veth pair and container network configured");

    // Start the container (resume paused init process)
    container::start_container(&mut container)
        .map_err(|e| AppError::Session(format!("start container: {e}")))?;
    tracing::info!(session_id = %session_id, pid = pid, "container started");

    // ── Convert parent pipe ends to tokio I/O ───────────────────────────
    let stdin_file: tokio::fs::File = unsafe {
        tokio::fs::File::from_std(std::fs::File::from_raw_fd(
            stdin_parent.into_raw_fd(),
        ))
    };
    let stdout_file: tokio::fs::File = unsafe {
        tokio::fs::File::from_std(std::fs::File::from_raw_fd(
            stdout_parent.into_raw_fd(),
        ))
    };
    let stderr_file: tokio::fs::File = unsafe {
        tokio::fs::File::from_std(std::fs::File::from_raw_fd(
            stderr_parent.into_raw_fd(),
        ))
    };

    // Drain stderr
    let sid_stderr = session_id.clone();
    tokio::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut lines = tokio::io::BufReader::new(stderr_file).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = strip_ansi(&line);
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

    // Persistent notification buffer for reconnect replay (capped at 10 000 frames / 5 MB)
    let message_buffer: Arc<Mutex<VecDeque<String>>> =
        Arc::new(Mutex::new(VecDeque::new()));
    let buffer_bytes: Arc<AtomicU64> = Arc::new(AtomicU64::new(0));
    let frame_counter: Arc<AtomicU64> = Arc::new(AtomicU64::new(0));
    let buffer_last_written = Arc::new(Mutex::new(Instant::now()));
    let buffer_on_disconnect_only = Arc::new(AtomicBool::new(false));

    // Per-request idempotency dedupe table (shared with on_receive_notification callback)
    let request_dedupe: Arc<Mutex<HashMap<String, RequestDedupeEntry>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let request_timeout = Duration::from_secs(
        std::env::var("EDUCLAW_REQUEST_TIMEOUT_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60),
    );

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
        stdin_file,
        stdout_file,
        model.clone(),
        provider,
        notif_tx_shared.clone(),
        backend.clone(),
        student_id.clone(),
        session_id.clone(),
        loading_flag.clone(),
        model_arc.clone(),
        recent_thread_id,
        message_buffer.clone(),
        buffer_bytes.clone(),
        frame_counter.clone(),
        buffer_last_written.clone(),
        buffer_on_disconnect_only.clone(),
        request_dedupe.clone(),
    )
    .await?;

    let available_models_arc = Arc::new(Mutex::new(available_models_from_goose));

    tracing::info!(session_id = %session_id, "✓ [SESSION] SSE-init ready");

    let managed = ManagedSession::new(
        cx.clone(),
        Some(container),
        None,
        pid,
        notif_tx_shared.clone(),
        acp_session_id_holder.clone(),
        model_arc,
        available_models_arc,
        loading_flag,
        student_id.clone(),
        backend.clone(),
        registry.disconnect_timeout,
        message_buffer,
        buffer_bytes,
        frame_counter,
        buffer_last_written,
        buffer_on_disconnect_only,
        request_dedupe,
        request_timeout,
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
    request_id: Option<String>,
    backend: Arc<dyn DbBackend>,
    student_id: &str,
    last_input_at: Arc<AtomicU64>,
) -> Result<SseEventStream> {
    let managed = registry
        .get(session_id)
        .await
        .ok_or_else(|| AppError::SessionNotFound(format!("session {session_id} not found")))?;

    // Active stream is attached now; only start buffering if we detect disconnect later.
    managed
        .buffer_on_disconnect_only
        .store(false, Ordering::Relaxed);

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
                let frame = frame_with_id(&managed, serde_json::json!({
                    "type": "session_terminated",
                    "code": "GOOSE_DEAD",
                    "reason": "goose_dead",
                }))
                .await;
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
        let frame = frame_with_id(
            &managed,
            serde_json::json!({"type": "restriction", "code": "RESTRICTED", "message": message}),
        )
        .await;
        let _ = sse_tx.send(SseEvent::Text(frame)).await;
        let _ = sse_tx.send(SseEvent::Close).await;
        return Ok(SseEventStream { rx: sse_rx });
    }

    // ── Request Idempotency Dedupe Gate ─────────────────────
    if let Some(ref rid) = request_id {
        let mut dedupe = managed.request_dedupe.lock().await;

        // Check in-memory dedupe table
        if let Some(entry) = dedupe.get(rid) {
            match entry.state {
                RequestState::InFlight | RequestState::Streaming => {
                    if managed.buffered_len().await > 0 {
                        // Resume path — drop lock, fall through to buffer replay below
                        drop(dedupe);
                    } else {
                        return Err(AppError::RequestInFlight(
                            format!("request {rid} is still in-flight; retry later")
                        ));
                    }
                }
                RequestState::Completed => {
                    let frames = entry.final_frames.clone();
                    drop(dedupe);
                    let (sse_tx, sse_rx) = mpsc::channel::<SseEvent>(4);
                    for frame_text in &frames {
                        let _ = sse_tx.send(SseEvent::Text(frame_text.clone())).await;
                    }
                    let _ = sse_tx.send(SseEvent::Close).await;
                    return Ok(SseEventStream { rx: sse_rx });
                }
                RequestState::Failed => {
                    return Err(AppError::RequestFailed(
                        format!("request {rid} previously failed; use a new request_id")
                    ));
                }
            }
        } else {
            // Cold-recovery: check HelixDB (after restart, in-memory is empty)
            if let Ok(Some((db_rid, db_state, _db_started_at))) = managed.backend.get_last_request(&managed.student_id).await {
                if db_rid == *rid {
                    match db_state.as_str() {
                        "in_flight" | "streaming" => {
                            // Goose process is gone after restart — treat as failed
                            dedupe.insert(rid.clone(), RequestDedupeEntry {
                                state: RequestState::Failed,
                                started_at: Instant::now(),
                                final_frames: vec![],
                                buffer_start_index: None,
                                cancel_token: CancellationToken::new(),
                            });
                            let _ = managed.backend.clear_last_request(&managed.student_id).await;
                            drop(dedupe);
                            return Err(AppError::RequestFailed(
                                "request lost after backend restart; use a new request_id".into()
                            ));
                        }
                        "completed" => {
                            drop(dedupe);
                            return Err(AppError::RequestInFlight(
                                "request completed — re-query from thread replay".into()
                            ));
                        }
                        "failed" => {
                            drop(dedupe);
                            return Err(AppError::RequestFailed(
                                "request previously failed; use a new request_id".into()
                            ));
                        }
                        _ => {}
                    }
                } else {
                    // Different request_id in DB — stale, clear it
                    let _ = managed.backend.clear_last_request(&managed.student_id).await;
                }
            }

            // Guard: reject new request if another is in-flight
            let has_in_flight = dedupe.values().any(|e| matches!(
                e.state, RequestState::InFlight | RequestState::Streaming
            ));
            if has_in_flight {
                return Err(AppError::Conflict(
                    "a request is already in progress; wait for it to complete".into()
                ));
            }

            // Prune old completed entries (keep last 5 min)
            dedupe.retain(|_, e| {
                if matches!(e.state, RequestState::Completed) {
                    e.started_at.elapsed() < Duration::from_secs(300)
                } else {
                    true
                }
            });

            // First time seeing this request_id — create entry
            let cancel_token = CancellationToken::new();
            dedupe.insert(rid.clone(), RequestDedupeEntry {
                state: RequestState::InFlight,
                started_at: Instant::now(),
                final_frames: vec![],
                buffer_start_index: Some(managed.buffered_len().await),
                cancel_token: cancel_token.clone(),
            });

            // Persist to HelixDB
            let now_iso = Utc::now().to_rfc3339();
            let _ = managed.backend.set_last_request(
                &managed.student_id, rid, "in_flight", &now_iso
            ).await;

            // Spawn timeout task with cancellation token
            let managed_timeout = managed.clone();
            let rid_timeout = rid.clone();
            let timeout_dur = managed.request_timeout;
            let backend_timeout = managed.backend.clone();
            let student_id_timeout = managed.student_id.clone();
            tokio::spawn(async move {
                tokio::select! {
                    _ = cancel_token.cancelled() => {}
                    _ = tokio::time::sleep(timeout_dur) => {
                        let mut dedupe = managed_timeout.request_dedupe.lock().await;
                        if let Some(entry) = dedupe.get_mut(&rid_timeout) {
                            if matches!(entry.state, RequestState::InFlight) {
                                entry.state = RequestState::Failed;
                                let now = Utc::now().to_rfc3339();
                                let _ = backend_timeout.set_last_request(
                                    &student_id_timeout, &rid_timeout, "failed", &now,
                                ).await;
                                tracing::warn!(
                                    request_id = %rid_timeout,
                                    "⏰ [IDEMPOTENCY] Request timed out — marked as failed"
                                );
                            }
                        }
                    }
                }
            });

            drop(dedupe);
        }

        // If we're here via the InFlight resume path, set current_request_id
        // so the prompt task can update state on completion
        // (handled below in the PromptResponse section)
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

    // Expire stale replay buffer and ask frontend to recover from thread replay.
    if managed.buffered_len().await > 0 && managed.is_buffer_timed_out(Duration::from_secs(120)).await {
        managed.clear_buffer().await;
        let frame = frame_with_id(&managed, serde_json::json!({
            "type": "buffer_drained",
            "code": "BUFFER_DRAINED",
            "reason": "buffer_timed_out",
        }))
        .await;
        let _ = sse_tx.send(SseEvent::Text(frame)).await;
        let _ = sse_tx.send(SseEvent::Close).await;
        return Ok(SseEventStream { rx: sse_rx });
    }

    // Drain buffered notifications from prior disconnect (replay missed frames)
    let buffered = managed.take_buffered_messages().await;
    let resume_only = !buffered.is_empty();
    let mut buffered_had_terminal = false;
    if !buffered.is_empty() {
        tracing::info!(
            session_id = %session_id,
            buffered_count = buffered.len(),
            "📥 [SSE] Replaying buffered notifications from prior disconnect"
        );
        for frame_text in buffered {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&frame_text) {
                if let Some(t) = v.get("type").and_then(|x| x.as_str()) {
                    if matches!(
                        t,
                        "chat_end" | "chat_error" | "restriction" | "session_terminated" | "buffer_drained"
                    ) {
                        buffered_had_terminal = true;
                    }
                }
            }
            let _ = sse_tx.send(SseEvent::Text(frame_text)).await;
        }
    }

    // Create notification channel and redirect sacp callback
    let (notif_tx_req, mut notif_rx_req) =
        mpsc::channel::<(Option<serde_json::Value>, Option<Vec<u8>>)>(128);
    *managed.notif_tx_shared.lock().await = notif_tx_req;

    // Spawn notification forwarding task
    let sse_tx_notif = sse_tx.clone();
    let session_id_notif = session_id.to_string();
    let managed_notif = managed.clone();
    tokio::spawn(async move {
        while let Some((json_frame, _binary_frame)) = notif_rx_req.recv().await {
            if let Some(j) = json_frame {
                if let Ok(text) = serde_json::to_string(&j) {
                    if sse_tx_notif.send(SseEvent::Text(text)).await.is_err() {
                        managed_notif
                            .buffer_on_disconnect_only
                            .store(true, Ordering::Relaxed);
                        tracing::warn!(
                            session_id = %session_id_notif,
                            "📤 [SSE] Notification forwarding stopped — frontend disconnected"
                        );
                        break;
                    }
                }
            }
        }
    });

    // Reconnect replay should only resume in-flight stream; do not submit a new prompt.
    if resume_only {
        if buffered_had_terminal {
            let _ = sse_tx.send(SseEvent::Close).await;
        }
        return Ok(SseEventStream { rx: sse_rx });
    }

    // Send chat_start for a fresh prompt only.
    if sse_tx
        .send(SseEvent::Text(
            frame_with_id(&managed, serde_json::json!({"type": "chat_start"})).await,
        ))
        .await
        .is_err()
    {
        tracing::warn!(
            session_id = %session_id,
            "📤 [SSE] Could not send chat_start — frontend already disconnected"
        );
    }

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
    let backend_for_prompt = backend.clone();
    let student_id_for_prompt = student_id.to_string();
    let managed_prompt = managed.clone();
    let request_id_prompt = request_id.clone();

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
                        let frame = frame_with_id(&managed_prompt, serde_json::json!({
                            "type": "session_created",
                            "session_id": new_sid.0,
                        }))
                        .await;
                        let _ = sse_tx_prompt.send(SseEvent::Text(frame)).await;
                        *holder = Some(new_sid.clone());

                        if let Err(e) = backend_for_prompt
                            .set_recent_thread_id(&student_id_for_prompt, &new_sid.0)
                            .await
                        {
                            tracing::warn!(
                                student_id = %student_id_for_prompt,
                                thread_id = %new_sid.0,
                                error = %e,
                                "⚠ [SSE] Failed to persist recent_thread_id on new session"
                            );
                        }

                        new_sid
                    }
                    Err(e) => {
                        tracing::error!(
                            session_id = %session_id_for_prompt,
                            error = %e,
                            "❌ [SSE] ACP session creation failed"
                        );
                        let frame = frame_with_id(&managed_prompt, serde_json::json!({
                            "type": "chat_error",
                            "code": "ACP_SESSION_CREATE_FAILED",
                            "error": format!("Failed to create session: {}", e),
                        }))
                        .await;
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
                            if let Err(e) = token_calculator::calculate_and_deduct(
                                &*backend_clone, &student_id_clone, &sid_clone,
                                &model_name_clone, input_tokens, output_tokens,
                            ).await {
                                tracing::error!(
                                    student_id = %student_id_clone,
                                    session_id = %sid_clone,
                                    error = %e,
                                    "Failed to calculate and deduct tokens"
                                );
                            }
                        });
                    }
                }
            }
        }

        // Determine result type before moving resp into the frame match
        let is_end_turn = matches!(&resp, Ok(r) if matches!(r.stop_reason, StopReason::EndTurn | StopReason::Cancelled));

        let frame = match resp {
            Ok(r) => {
                match r.stop_reason {
                    StopReason::EndTurn | StopReason::Cancelled => {
                        frame_with_id(&managed_prompt, serde_json::json!({"type": "chat_end"})).await
                    }
                    other => frame_with_id(&managed_prompt, serde_json::json!({
                        "type": "chat_error",
                        "code": "UNEXPECTED_STOP_REASON",
                        "error": format!("stop_reason: {other:?}")
                    }))
                    .await,
                }
            }
            Err(e) => {
                tracing::error!(
                    session_id = %session_id_for_prompt,
                    error = %e,
                    "❌ [SSE] Prompt failed"
                );
                frame_with_id(&managed_prompt, serde_json::json!({
                    "type": "chat_error",
                    "code": "PROMPT_FAILED",
                    "error": e.to_string()
                }))
                .await
            }
        };

        // ── Update dedupe state (completed / failed) ──────────
        if let Some(ref rid) = request_id_prompt {
            let mut dedupe = managed_prompt.request_dedupe.lock().await;
            if let Some(entry) = dedupe.get_mut(rid) {
                // Don't overwrite a cancel-set Failed state
                if matches!(entry.state, RequestState::Failed) {
                    tracing::info!(
                        request_id = %rid,
                        "🛑 [IDEMPOTENCY] PromptResponse received but request was already failed (cancel)"
                    );
                } else {
                    if is_end_turn {
                        entry.state = RequestState::Completed;
                        let frame_text = frame.clone();
                        entry.final_frames.push(frame_text);
                        let now = Utc::now().to_rfc3339();
                        let _ = backend_for_prompt.set_last_request(
                            &student_id_for_prompt, rid, "completed", &now,
                        ).await;
                        tracing::info!(
                            request_id = %rid,
                            "✓ [IDEMPOTENCY] Request completed"
                        );
                    } else {
                        entry.state = RequestState::Failed;
                        let now = Utc::now().to_rfc3339();
                        let _ = backend_for_prompt.set_last_request(
                            &student_id_for_prompt, rid, "failed", &now,
                        ).await;
                        tracing::info!(
                            request_id = %rid,
                            "✗ [IDEMPOTENCY] Request failed"
                        );
                    }
                }
            }
        }
        if sse_tx_prompt.send(SseEvent::Text(frame)).await.is_err() {
            tracing::warn!(
                session_id = %session_id_for_prompt,
                "📤 [SSE] Could not send final frame — frontend already disconnected"
            );
        }
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
        .ok_or_else(|| AppError::SessionNotFound(format!("session {session_id} not found")))?;

    // ── Clear dedupe state for any in-flight request ──────────
    {
        let mut dedupe = managed.request_dedupe.lock().await;
        let now = Utc::now().to_rfc3339();
        for (request_id, entry) in dedupe.iter_mut() {
            if matches!(entry.state, RequestState::InFlight | RequestState::Streaming) {
                entry.state = RequestState::Failed;
                let _ = managed.backend.set_last_request(
                    &managed.student_id, request_id, "failed", &now,
                ).await;
                tracing::info!(
                    request_id = %request_id,
                    "🛑 [IDEMPOTENCY] Request marked failed by cancel"
                );
            }
        }
    }

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
) -> Result<SseEventStream> {
    let managed = registry
        .get(session_id)
        .await
        .ok_or_else(|| AppError::SessionNotFound(format!("session {session_id} not found")))?;

    let (sse_tx, sse_rx) = mpsc::channel::<SseEvent>(256);

    // Fresh notification channel for this replay
    let (notif_tx_req, mut notif_rx_req) =
        mpsc::channel::<(Option<serde_json::Value>, Option<Vec<u8>>)>(128);
    *managed.notif_tx_shared.lock().await = notif_tx_req;

    // Forward notifications to SSE
    let sse_tx_notif = sse_tx.clone();
    let session_id_replay_notif = session_id.to_string();
    let managed_replay_notif = managed.clone();
    tokio::spawn(async move {
        while let Some((json_frame, _binary_frame)) = notif_rx_req.recv().await {
            if let Some(j) = json_frame {
                if let Ok(text) = serde_json::to_string(&j) {
                    if sse_tx_notif.send(SseEvent::Text(text)).await.is_err() {
                        managed_replay_notif
                            .buffer_on_disconnect_only
                            .store(true, Ordering::Relaxed);
                        tracing::warn!(
                            session_id = %session_id_replay_notif,
                            "📤 [SSE] Replay notification forwarding stopped — frontend disconnected"
                        );
                        break;
                    }
                }
            }
        }
    });

    let cx = managed.cx.clone();
    let loading_flag = managed.loading_flag.clone();
    let acp_sid_holder = managed.acp_session_id.clone();
    let tid = thread_id.to_string();
    let student_id = managed.student_id.clone();
    let backend = managed.backend.clone();
    let managed_load = managed.clone();

    let sse_tx_load = sse_tx.clone();
    tokio::spawn(async move {
        loading_flag.store(true, Ordering::Relaxed);

        match acp_handle_load_session(&cx, tid.clone()).await {
            Ok(()) => {
                let loaded_sid = SessionId::new(tid.clone());
                *acp_sid_holder.lock().await = Some(loaded_sid);

                if let Err(e) = backend.set_recent_thread_id(&student_id, &tid).await {
                    tracing::warn!(
                        student_id = %student_id,
                        thread_id = %tid,
                        error = %e,
                        "⚠ [SSE] Failed to persist recent_thread_id on thread switch"
                    );
                }

                tokio::time::sleep(Duration::from_millis(150)).await;
                loading_flag.store(false, Ordering::Relaxed);

                let frame = serde_json::json!({
                    "type": "load_session_complete",
                    "thread_id": tid,
                });
                let frame = frame_with_id(&managed_load, frame).await;
                let _ = sse_tx_load.send(SseEvent::Text(frame)).await;
            }
            Err(e) => {
                tracing::warn!(
                    thread_id = %tid,
                    error = %e,
                    "⚠ [SSE] LoadSession failed — creating new thread"
                );
                let nsr = NewSessionRequest::new("/");
                match cx.send_request(nsr).block_task().await {
                    Ok(new_sess_resp) => {
                        let new_sid = new_sess_resp.session_id.clone();
                        *acp_sid_holder.lock().await = Some(new_sid.clone());
                        if let Err(e) = backend.set_recent_thread_id(&student_id, &new_sid.0).await {
                            tracing::warn!(
                                student_id = %student_id,
                                thread_id = %new_sid.0,
                                error = %e,
                                "⚠ [SSE] Failed to persist recent_thread_id on new session"
                            );
                        }
                        tokio::time::sleep(Duration::from_millis(150)).await;
                        loading_flag.store(false, Ordering::Relaxed);
                        let frame = serde_json::json!({
                            "type": "load_session_complete",
                            "thread_id": new_sid.0,
                        });
                        let frame = frame_with_id(&managed_load, frame).await;
                        let _ = sse_tx_load.send(SseEvent::Text(frame)).await;
                    }
                    Err(e2) => {
                        loading_flag.store(false, Ordering::Relaxed);
                        tracing::error!(
                            thread_id = %tid,
                            error = %e2,
                            "❌ [SSE] Replay fallback (new session) failed"
                        );
                        let frame = serde_json::json!({
                            "type": "chat_error",
                            "code": "REPLAY_FALLBACK_FAILED",
                            "error": format!("Failed to create new session: {}", e2),
                        });
                        let frame = frame_with_id(&managed_load, frame).await;
                        let _ = sse_tx_load.send(SseEvent::Text(frame)).await;
                    }
                }
            }
        }
        let _ = sse_tx_load.send(SseEvent::Close).await;
    });

    Ok(SseEventStream { rx: sse_rx })
}
