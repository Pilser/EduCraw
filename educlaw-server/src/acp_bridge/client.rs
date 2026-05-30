// acp_bridge/client.rs
//
// Bootstraps the sacp (SACP) client over a `goose acp` stdio subprocess.
//
// `spawn_sacp_client` takes the child's stdin/stdout, drives the ACP
// initialization + session-creation handshake, and returns the ready
// `(ConnectionTo<SacpAgent>, SessionId)` pair for use by the session loop.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

use sacp::schema::{
    ClientCapabilities, InitializeRequest, LoadSessionRequest, NewSessionRequest, ProtocolVersion,
    RequestPermissionRequest, SessionId, SessionNotification, SessionUpdate,
};
use sacp::{Agent as SacpAgent, ByteStreams, Client, ConnectionTo};
use serde_json::Value;
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{mpsc, Mutex};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::db::DbBackend;
use crate::error::{AppError, Result};
use crate::session::registry::{RequestDedupeEntry, RequestState};

use super::notifications::notification_to_frames;
use super::permissions::auto_approve;
use chrono::Utc;

/// Spawns the sacp Client task, performs the ACP handshake (Initialize only).
/// Returns connection, session_id holder (None initially - set by LoadSession or first Prompt),
/// and available models from goose.
pub async fn spawn_sacp_client(
    child_stdin: ChildStdin,
    child_stdout: ChildStdout,
    workspace: PathBuf,
    model: Option<String>,
    provider: Option<String>,
    notif_tx: Arc<Mutex<mpsc::Sender<(Option<serde_json::Value>, Option<Vec<u8>>)>>>,
    backend: Arc<dyn DbBackend>,
    student_id: String,
    session_id: String,
    loading_flag: Arc<AtomicBool>,
    model_arc: Arc<tokio::sync::Mutex<Option<String>>>,
    recent_thread_id: Option<String>,
    message_buffer: Arc<Mutex<VecDeque<String>>>,
    buffer_bytes: Arc<AtomicU64>,
    frame_counter: Arc<AtomicU64>,
    buffer_last_written: Arc<Mutex<Instant>>,
    buffer_on_disconnect_only: Arc<AtomicBool>,
    request_dedupe: Arc<Mutex<HashMap<String, RequestDedupeEntry>>>,
) -> Result<(ConnectionTo<SacpAgent>, Arc<tokio::sync::Mutex<Option<SessionId>>>, Vec<String>)> {
    let transport = ByteStreams::new(child_stdin.compat_write(), child_stdout.compat());

    // Shared handles for extracting cx / session_id from inside connect_with.
    let cx_holder: Arc<tokio::sync::Mutex<Option<ConnectionTo<SacpAgent>>>> =
        Arc::new(tokio::sync::Mutex::new(None));
    let cx_holder_spawn = cx_holder.clone();

    let acp_sid_holder: Arc<tokio::sync::Mutex<Option<SessionId>>> =
        Arc::new(tokio::sync::Mutex::new(None));
    let acp_sid_spawn = acp_sid_holder.clone();

    // Shared holder for available models from NewSessionResponse
    let models_holder: Arc<tokio::sync::Mutex<Vec<String>>> =
        Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let models_holder_spawn = models_holder.clone();

    let acp_sid_holder: Arc<tokio::sync::Mutex<Option<SessionId>>> =
        Arc::new(tokio::sync::Mutex::new(None));
    let acp_sid_spawn = acp_sid_holder.clone();

    // Oneshot used by the connect_with closure to signal success or failure.
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<Result<()>>();
    let ready_tx = Arc::new(tokio::sync::Mutex::new(Some(ready_tx)));
    let ready_tx_spawn = ready_tx.clone();

    let model_for_init = model.clone();

    // Clone values needed for the notification closure
    let educlaw_session_id = session_id.clone();
    let loading_flag_clone = loading_flag.clone();
    let model_arc_clone = model_arc.clone();
    let message_buffer_clone = message_buffer.clone();
    let buffer_bytes_clone = buffer_bytes.clone();
    let frame_counter_clone = frame_counter.clone();
    let buffer_last_written_clone = buffer_last_written.clone();
    let buffer_on_disconnect_only_clone = buffer_on_disconnect_only.clone();
    let request_dedupe_clone = request_dedupe.clone();
    let student_id_notif = student_id.clone();
    let backend_notif = backend.clone();

    // Clone values needed inside connect_with
    let backend_init = backend.clone();
    let student_id_init = student_id.clone();
    let recent_thread_id_init = recent_thread_id.clone();

    tokio::spawn(async move {
        let result = Client
            .builder()
            .on_receive_notification(
                {
                    let _backend = backend.clone();
                    let student_id = student_id.clone();
                    let tx = notif_tx;
                    let educlaw_session_id = educlaw_session_id.clone();
                    let loading_flag = loading_flag_clone.clone();
                    let msg_buf = message_buffer_clone.clone();
                    let buf_bytes = buffer_bytes_clone.clone();
                    let frame_counter = frame_counter_clone.clone();
                    let buffer_last_written = buffer_last_written_clone.clone();
                    let buffer_on_disconnect_only = buffer_on_disconnect_only_clone.clone();
                    let request_dedupe_inner = request_dedupe_clone.clone();
                    let student_id_inner = student_id_notif.clone();
                    let backend_inner = backend_notif.clone();
                    async move |notif: SessionNotification, _cx| {
                        let _session_id = notif.session_id.0.to_string(); // ACP session ID (not used for DB)

                        // Convert notification to frames
                        let mut frames = notification_to_frames(&notif);

                        // Attach monotonic frame id to every JSON frame.
                        if let Some(ref mut json_val) = frames.0 {
                            let frame_id = frame_counter.fetch_add(1, Ordering::Relaxed);
                            match json_val {
                                Value::Object(map) => {
                                    map.insert(
                                        "id".to_string(),
                                        Value::Number(serde_json::Number::from(frame_id)),
                                    );
                                }
                                _ => {
                                    *json_val = serde_json::json!({
                                        "id": frame_id,
                                        "type": "unknown",
                                        "payload": json_val,
                                    });
                                }
                            }
                        }

                        // Only buffer when disconnected replay capture is enabled.
                        if let Some(ref json_val) = frames.0 {
                            if buffer_on_disconnect_only.load(Ordering::Relaxed) {
                                if let Ok(text) = serde_json::to_string(json_val) {
                                    if let Ok(mut buf) = msg_buf.try_lock() {
                                        buf_bytes.fetch_add(text.len() as u64, Ordering::Relaxed);
                                        buf.push_back(text);
                                        if let Ok(mut last_written) = buffer_last_written.try_lock() {
                                            *last_written = Instant::now();
                                        }
                                        // Evict oldest when count > 10 000 or size > 5 MB
                                        while buf.len() > 10_000
                                            || buf_bytes.load(Ordering::Relaxed) > 5 * 1024 * 1024
                                        {
                                            if let Some(oldest) = buf.pop_front() {
                                                buf_bytes.fetch_sub(oldest.len() as u64, Ordering::Relaxed);
                                            } else {
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Forward all notifications to the SSE writer (non-blocking — never stall the event loop).
                        if let Ok(sender) = tx.try_lock() {
                            if let Err(_e) = sender.try_send(frames) {
                                tracing::debug!("SSE notification channel full — frame dropped");
                            }
                        }

                        // Transition in_flight → streaming on first Goose notification
                        {
                            let mut dedupe = request_dedupe_inner.lock().await;
                            for (request_id, entry) in dedupe.iter_mut() {
                                if matches!(entry.state, RequestState::InFlight) {
                                    entry.state = RequestState::Streaming;
                                    entry.cancel_token.cancel();
                                    let now = Utc::now().to_rfc3339();
                                    let _ = backend_inner.set_last_request(
                                        &student_id_inner, request_id, "streaming", &now,
                                    ).await;
                                    tracing::info!(
                                        request_id = %request_id,
                                        "✓ [IDEMPOTENCY] Goose started producing — timeout cancelled, state → streaming"
                                    );
                                    break;
                                }
                            }
                        }

                        // Persist statistics to backend based on notification type.
                        match &notif.update {
                            SessionUpdate::UsageUpdate(usage) => {
                                // Skip token accounting if we're loading a session
                                if loading_flag.load(Ordering::Relaxed) {
                                    tracing::debug!(
                                        session_id = %educlaw_session_id,
                                        "💰 [TOKEN] Skipping token accounting during session load"
                                    );
                                } else {
                                    // Get actual model name from model_arc (updated by model_poller)
                                    let model_name = model_arc_clone.lock().await
                                        .clone()
                                        .unwrap_or_else(|| "grok-4-1-fast-reasoning".to_string());

                                    tracing::debug!(
                                        session_id = %educlaw_session_id,
                                        student_id = %student_id,
                                        tokens_used = usage.used,
                                        cost = ?usage.cost,
                                        model = %model_name,
                                        "💰 [TOKEN] Usage update from goose (NOTE: token accounting now handled in PromptResponse)"
                                    );
                                    // Token accounting now triggered from PromptResponse in session.rs
                                }
                            }
                            SessionUpdate::Plan(plan) => {
                                let completed = plan.entries.iter()
                                    .filter(|e| e.status == sacp::schema::PlanEntryStatus::Completed)
                                    .count();
                                let in_progress = plan.entries.iter()
                                    .filter(|e| e.status == sacp::schema::PlanEntryStatus::InProgress)
                                    .count();
                                tracing::debug!(
                                    session_id = %session_id,
                                    student_id = %student_id,
                                    total = plan.entries.len(),
                                    completed,
                                    in_progress,
                                    "📊 [STATS] Plan update received from goose (persistence deferred)"
                                );
                            }
                            SessionUpdate::CurrentModeUpdate(mode) => {
                                tracing::debug!(
                                    session_id = %session_id,
                                    student_id = %student_id,
                                    mode_id = %mode.current_mode_id.0,
                                    "📋 [STATS] Mode change received from goose (persistence deferred)"
                                );
                            }
                            SessionUpdate::SessionInfoUpdate(info) => {
                                let title = match &info.title {
                                    sacp::schema::MaybeUndefined::Value(v) => Some(v.clone()),
                                    _ => None
                                };
                                let updated_at = match &info.updated_at {
                                    sacp::schema::MaybeUndefined::Value(v) => Some(v.clone()),
                                    _ => None
                                };
                                tracing::debug!(
                                    session_id = %session_id,
                                    student_id = %student_id,
                                    title = ?title,
                                    "📋 [STATS] Session info update received from goose (persistence deferred)"
                                );
                            }
                            SessionUpdate::AvailableCommandsUpdate(cmds) => {

                                tracing::debug!(
                                    session_id = %session_id,
                                    student_id = %student_id,
                                    command_count = cmds.available_commands.len(),
                                    "📋 [STATS] Available commands update received from goose (persistence deferred)"
                                );
                            }
                            SessionUpdate::ConfigOptionUpdate(config) => {

                                tracing::debug!(
                                    session_id = %session_id,
                                    student_id = %student_id,
                                    config_count = config.config_options.len(),
                                    "📋 [STATS] Config options update received from goose (persistence deferred)"
                                );
                            }
                            _ => {}
                        }

                        Ok(())
                    }
                },
                sacp::on_receive_notification!(),
            )
            .on_receive_request(
                async move |req: RequestPermissionRequest, responder, _cx| {
                    responder.respond(auto_approve(&req))
                },
                sacp::on_receive_request!(),
            )
            .connect_with(transport, async move |cx: ConnectionTo<SacpAgent>| {
                // Store cx so the outer future can retrieve it after ready.
                *cx_holder_spawn.lock().await = Some(cx.clone());

                // ── ACP Initialize ─────────────────────────────────────
                match cx
                    .send_request(
                        InitializeRequest::new(ProtocolVersion::LATEST)
                            .client_capabilities(ClientCapabilities::new()),
                    )
                    .block_task()
                    .await
                {
                    Ok(init_resp) => {
                        tracing::info!(
                            "✓ [GOOSE-ACP] Initialize response received"
                        );
                        tracing::debug!(
                            "📋 [GOOSE-ACP] Protocol: {:?}, Load session: {}, MCP enabled: {}",
                            init_resp.protocol_version,
                            init_resp.agent_capabilities.load_session,
                            init_resp.agent_capabilities.mcp_capabilities.http
                        );
                    }
                    Err(e) => {
                        tracing::error!(
                            "✗ [GOOSE-ACP] Initialize FAILED: {}",
                            e
                        );
                        if let Some(tx) = ready_tx_spawn.lock().await.take() {
                            let _ = tx.send(Err(AppError::Session(format!(
                                "ACP initialize failed: {e}"
                            ))));
                        }
                        return Err(e);
                    }
                }

                // ── Create or Load ACP session ─────────────────────────
                // If we have a recent_thread_id, try loading the existing thread.
                // This lets Goose resume the last conversation for this student.
                // If loading fails (thread was corrupted/deleted), create a new one.
                let session_id_result: Option<SessionId> = 'session: {
                    if let Some(ref tid) = recent_thread_id_init {
                        let load_req = LoadSessionRequest::new(
                            SessionId::new(tid.clone()),
                            PathBuf::from("/"),
                        );
                        match cx.send_request(load_req).block_task().await {
                            Ok(r) => {
                                tracing::info!(
                                    thread_id = %tid,
                                    "✓ [GOOSE-ACP] Existing thread loaded successfully"
                                );
                                if let Err(e) = backend_init
                                    .set_recent_thread_id(&student_id_init, tid)
                                    .await
                                {
                                    tracing::warn!(
                                        student_id = %student_id_init,
                                        thread_id = %tid,
                                        error = %e,
                                        "⚠ [GOOSE-ACP] Failed to persist recent_thread_id on load"
                                    );
                                }
                                #[cfg(feature = "unstable_session_model")]
                                if let Some(model_state) = r.models {
                                    let model_names: Vec<String> = model_state
                                        .available_models
                                        .iter()
                                        .map(|m| m.name.clone())
                                        .collect();
                                    *models_holder_spawn.lock().await = model_names.clone();
                                }
                                break 'session Some(SessionId::new(tid.clone()));
                            }
                            Err(e) => {
                                tracing::warn!(
                                    thread_id = %tid,
                                    error = %e,
                                    "⚠ [GOOSE-ACP] LoadSession failed — falling back to NewSession"
                                );
                            }
                        }
                    }

                    // No recent_thread_id or load failed — create a new thread
                    let mut nsr = NewSessionRequest::new("/");
                    if let Some(ref provider) = provider {
                        let mut meta = serde_json::Map::new();
                        meta.insert("provider".to_string(), Value::String(provider.clone()));
                        nsr = nsr.meta(meta);
                    }
                    match cx.send_request(nsr).block_task().await {
                        Ok(resp) => {
                            tracing::info!(
                                session_id = %resp.session_id.0,
                                "✓ [GOOSE-ACP] New session created successfully"
                            );
                            let thread_id = resp.session_id.0.clone();
                            if let Err(e) = backend_init
                                .set_recent_thread_id(&student_id_init, &thread_id)
                                .await
                            {
                                tracing::warn!(
                                    student_id = %student_id_init,
                                    thread_id = %thread_id,
                                    error = %e,
                                    "⚠ [GOOSE-ACP] Failed to persist recent_thread_id"
                                );
                            }
                            #[cfg(feature = "unstable_session_model")]
                            if let Some(model_state) = resp.models {
                                let model_names: Vec<String> = model_state
                                    .available_models
                                    .iter()
                                    .map(|m| m.name.clone())
                                    .collect();
                                *models_holder_spawn.lock().await = model_names.clone();
                                tracing::info!(
                                    model_count = model_names.len(),
                                    models = ?model_names,
                                    "✓ [GOOSE-ACP] Captured available models"
                                );
                            }
                            #[cfg(not(feature = "unstable_session_model"))]
                            {
                                let _ = resp.models;
                            }
                            break 'session Some(resp.session_id.clone());
                        }
                        Err(e) => {
                            tracing::error!("✗ [GOOSE-ACP] NewSession FAILED: {e}");
                            if let Some(tx) = ready_tx_spawn.lock().await.take() {
                                let _ = tx.send(Err(AppError::Session(format!(
                                    "ACP new_session failed: {e}"
                                ))));
                            }
                            return Err(e);
                        }
                    }
                };

                let acp_sid = session_id_result
                    .expect("session_id_result must be Some after either Load or New");
                *acp_sid_spawn.lock().await = Some(acp_sid);

                // Note: Can't set initial model yet since we have no active session.
                // Model will be set when the session is created (LoadSession or NewSession).
                if model_for_init.is_some() {
                    tracing::debug!(
                        model = ?model_for_init,
                        "📋 [GOOSE-ACP] Initial model will be set when session is created"
                    );
                }

                // Signal the outer future that the client is ready.
                if let Some(tx) = ready_tx_spawn.lock().await.take() {
                    let _ = tx.send(Ok(()));
                }

                // Keep the connection alive until the child exits.
                std::future::pending::<std::result::Result<(), sacp::Error>>().await
            })
            .await;

        if let Err(e) = result {
            tracing::error!("✗ [GOOSE-ACP] Client terminated with error: {e}");
        }
    });

    // Wait for the client to finish initialization before handing control back.
    match ready_rx.await {
        Ok(Ok(())) => {
            tracing::debug!("📋 [GOOSE-ACP] Initialization complete, proceeding");
        }
        Ok(Err(e)) => {
            tracing::error!("✗ [GOOSE-ACP] Initialization error: {e}");
            return Err(e);
        }
        Err(_) => {
            tracing::error!("✗ [GOOSE-ACP] Client dropped unexpectedly during init");
            return Err(AppError::Session(
                "goose ACP client dropped before ready".into(),
            ))
        }
    }

    let cx = cx_holder
        .lock()
        .await
        .clone()
        .expect("cx set after ready signal");
    let available_models = models_holder
        .lock()
        .await
        .clone();

    tracing::info!(
        model_count = available_models.len(),
        "✓ [GOOSE-ACP] Ready (no session yet - will be created lazily), {} available models",
        available_models.len()
    );

    // Return the Arc holder itself so session.rs can update session_id later
    Ok((cx, acp_sid_holder, available_models))
}
