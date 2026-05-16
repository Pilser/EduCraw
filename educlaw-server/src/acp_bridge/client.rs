// acp_bridge/client.rs
//
// Bootstraps the sacp (SACP) client over a `goose acp` stdio subprocess.
//
// `spawn_sacp_client` takes the child's stdin/stdout, drives the ACP
// initialization + session-creation handshake, and returns the ready
// `(ConnectionTo<SacpAgent>, SessionId)` pair for use by the session loop.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use sacp::schema::{
    ClientCapabilities, InitializeRequest, NewSessionRequest, ProtocolVersion,
    RequestPermissionRequest, SessionId, SessionNotification, SessionUpdate,
};
use sacp::{Agent as SacpAgent, ByteStreams, Client, ConnectionTo};
use serde_json::Value;
use sqlx::SqlitePool;
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{mpsc, Mutex};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::error::{AppError, Result};

use super::notifications::notification_to_frames;
use super::permissions::auto_approve;

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
    pool: SqlitePool,
    student_id: String,
    session_id: String,
    loading_flag: Arc<AtomicBool>,
    model_arc: Arc<tokio::sync::Mutex<Option<String>>>,
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

    tokio::spawn(async move {
        let result = Client
            .builder()
            .on_receive_notification(
                {
                    let pool = pool.clone();
                    let student_id = student_id.clone();
                    let tx = notif_tx;
                    let educlaw_session_id = educlaw_session_id.clone();
                    let loading_flag = loading_flag_clone.clone();
                    async move |notif: SessionNotification, _cx| {
                        let _session_id = notif.session_id.0.to_string(); // ACP session ID (not used for DB)

                        // Forward all notifications to the WS writer.
                        let frames = notification_to_frames(&notif);
                            let sender = tx.lock().await.clone();
                            let _ = sender.send(frames).await;

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
                                    // to ensure we get accurate input/output breakdown.
                                    // spawn_token_accounting(
                                    //     pool.clone(),
                                    //     educlaw_session_id.clone(),
                                    //     student_id.clone(),
                                    //     model_name,
                                    //     usage.used as i64,
                                    // );
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
                                    "� [STATS] Mode change received from goose (persistence deferred)"
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
                                    "� [STATS] Session info update received from goose (persistence deferred)"
                                );
                            }
                            SessionUpdate::AvailableCommandsUpdate(cmds) => {

                                tracing::debug!(
                                    session_id = %session_id,
                                    student_id = %student_id,
                                    command_count = cmds.available_commands.len(),
                                    "� [STATS] Available commands update received from goose (persistence deferred)"
                                );
                            }
                            SessionUpdate::ConfigOptionUpdate(config) => {

                                tracing::debug!(
                                    session_id = %session_id,
                                    student_id = %student_id,
                                    config_count = config.config_options.len(),
                                    "� [STATS] Config options update received from goose (persistence deferred)"
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

                // ── Create ACP session ─────────────────────────────────
                let mut nsr = NewSessionRequest::new(&workspace);
                if let Some(ref provider) = provider {
                    let mut meta = serde_json::Map::new();
                    meta.insert("provider".to_string(), Value::String(provider.clone()));
                    nsr = nsr.meta(meta);
                }
                let sess_resp = match cx
                    .send_request(nsr)
                    .block_task()
                    .await
                {
                    Ok(r) => {
                        tracing::info!(
                            session_id = %r.session_id.0,
                            "✓ [GOOSE-ACP] Session created successfully"
                        );
                        tracing::debug!(
                            "📋 [GOOSE-ACP] Session ID: {}, Workspace: {}",
                            r.session_id.0,
                            workspace.display()
                        );
                        r
                    }
                    Err(e) => {
                        tracing::error!(
                            "✗ [GOOSE-ACP] Session creation FAILED: {}",
                            e
                        );
                        if let Some(tx) = ready_tx_spawn.lock().await.take() {
                            let _ = tx.send(Err(AppError::Session(format!(
                                "ACP new_session failed: {e}"
                            ))));
                        }
                        return Err(e);
                    }
                };
                *acp_sid_spawn.lock().await = Some(sess_resp.session_id.clone());

                // ── Capture available models from SessionModelState ────────────────────────
                if let Some(model_state) = sess_resp.models {
                    let model_names: Vec<String> = model_state
                        .available_models
                        .iter()
                        .map(|m| m.name.clone())
                        .collect();
                    *models_holder_spawn.lock().await = model_names.clone();
                    tracing::info!(
                        model_count = model_names.len(),
                        models = ?model_names,
                        "✓ [GOOSE-ACP] Captured available models from temp session"
                    );
                }

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
