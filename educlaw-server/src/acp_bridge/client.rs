// acp_bridge/client.rs
//
// Bootstraps the sacp (SACP) client over a `goose acp` stdio subprocess.
//
// `spawn_sacp_client` takes the child's stdin/stdout, drives the ACP
// initialization + session-creation handshake, and returns the ready
// `(ConnectionTo<SacpAgent>, SessionId)` pair for use by the session loop.

use std::path::PathBuf;
use std::sync::Arc;

use sacp::schema::{
    ClientCapabilities, InitializeRequest, NewSessionRequest, ProtocolVersion,
    RequestPermissionRequest, SessionId, SessionNotification,
    SetSessionModelRequest,
};
use sacp::{Agent as SacpAgent, ByteStreams, Client, ConnectionTo};
use sqlx::SqlitePool;
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::mpsc;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::error::{AppError, Result};

use super::notifications::{notification_to_frames};
use super::permissions::auto_approve;

/// Spawns the sacp Client task, performs the ACP handshake, and returns the
/// live connection and ACP session id once the client signals it is ready.
///
/// The sacp task runs forever inside its `connect_with` closure
/// (`std::future::pending()`), draining notifications and responding to
/// permission requests until the child process exits.
pub async fn spawn_sacp_client(
    child_stdin: ChildStdin,
    child_stdout: ChildStdout,
    workspace: PathBuf,
    model: Option<String>,
    notif_tx: mpsc::Sender<(Option<serde_json::Value>, Option<Vec<u8>>)>,
    pool: SqlitePool,
    student_id: String,
) -> Result<(ConnectionTo<SacpAgent>, SessionId)> {
    let transport = ByteStreams::new(child_stdin.compat_write(), child_stdout.compat());

    // Shared handles for extracting cx / session_id from inside connect_with.
    let cx_holder: Arc<tokio::sync::Mutex<Option<ConnectionTo<SacpAgent>>>> =
        Arc::new(tokio::sync::Mutex::new(None));
    let cx_holder_spawn = cx_holder.clone();

    let acp_sid_holder: Arc<tokio::sync::Mutex<Option<SessionId>>> =
        Arc::new(tokio::sync::Mutex::new(None));
    let acp_sid_spawn = acp_sid_holder.clone();

    // Oneshot used by the connect_with closure to signal success or failure.
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<Result<()>>();
    let ready_tx = Arc::new(tokio::sync::Mutex::new(Some(ready_tx)));
    let ready_tx_spawn = ready_tx.clone();

    let model_for_init = model.clone();

    tokio::spawn(async move {
        let result = Client
            .builder()
            .on_receive_notification(
                {
                    let pool = pool;
                    let student_id = student_id;
                    let tx = notif_tx;
                    async move |notif: SessionNotification, _cx| {
                        // Token accounting would go here if UsageUpdate events were available.
                        // For now, token tracking happens via the PromptResponse.

                        // Forward all notifications to the WS writer.
                        let frames = notification_to_frames(&notif);
                        let _ = tx.send(frames).await;
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
                if let Err(e) = cx
                    .send_request(
                        InitializeRequest::new(ProtocolVersion::LATEST)
                            .client_capabilities(ClientCapabilities::new()),
                    )
                    .block_task()
                    .await
                {
                    tracing::error!("ACP initialize failed: {e}");
                    if let Some(tx) = ready_tx_spawn.lock().await.take() {
                        let _ = tx.send(Err(AppError::Session(format!(
                            "ACP initialize failed: {e}"
                        ))));
                    }
                    return Err(e);
                }

                // ── Create ACP session ─────────────────────────────────
                let sess_resp = match cx
                    .send_request(NewSessionRequest::new(&workspace))
                    .block_task()
                    .await
                {
                    Ok(r) => r,
                    Err(e) => {
                        tracing::error!("ACP new_session failed: {e}");
                        if let Some(tx) = ready_tx_spawn.lock().await.take() {
                            let _ = tx.send(Err(AppError::Session(format!(
                                "ACP new_session failed: {e}"
                            ))));
                        }
                        return Err(e);
                    }
                };
                *acp_sid_spawn.lock().await = Some(sess_resp.session_id);

                // ── Set initial model if specified ─────────────────────
                if let Some(ref m) = model_for_init {
                    if let Err(e) = cx
                        .send_request(SetSessionModelRequest::new(
                            acp_sid_spawn
                                .lock()
                                .await
                                .clone()
                                .expect("session_id just set"),
                            m.clone(),
                        ))
                        .block_task()
                        .await
                    {
                        tracing::warn!(model = %m, error = %e, "failed to set initial model");
                    }
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
            tracing::error!("sacp client terminated with error: {e}");
        }
    });

    // Wait for the client to finish initialization before handing control back.
    match ready_rx.await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => {
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
    let acp_session_id = acp_sid_holder
        .lock()
        .await
        .clone()
        .expect("acp session_id set after ready signal");

    Ok((cx, acp_session_id))
}
