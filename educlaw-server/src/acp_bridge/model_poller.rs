// acp_bridge/model_poller.rs
//
// Background task that polls `pending_model.txt` (written by the REST API
// when the teacher changes a session's model) and issues a
// `SetSessionModelRequest` over ACP, then updates the DB and notifies the
// browser via the ctrl channel.

use std::path::PathBuf;
use std::sync::Arc;

use sacp::schema::{SessionId, SetSessionModelRequest};
use sacp::{Agent as SacpAgent, ConnectionTo};
use sqlx::SqlitePool;
use tokio::sync::mpsc;

use crate::db::sessions as db_sess;

/// Spawns the model-switch poller as a fire-and-forget tokio task.
///
/// Every 500 ms it checks whether `pending_model_path` exists.  If so:
///   1. Removes the file (consume the signal).
///   2. Sends `SetSessionModelRequest` over ACP.
///   3. Updates the cached `model_arc`.
///   4. Persists the new model name to the DB.
///   5. Pushes a `{"type":"model_changed","model":"..."}` frame to the browser.
pub fn spawn_model_poller(
    pending_model_path: PathBuf,
    cx: ConnectionTo<SacpAgent>,
    acp_session_id_holder: Arc<tokio::sync::Mutex<Option<SessionId>>>,
    session_id: String,
    pool: SqlitePool,
    model_arc: Arc<tokio::sync::Mutex<Option<String>>>,
    ctrl_tx: mpsc::Sender<String>,
) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

            let Ok(raw) = tokio::fs::read_to_string(&pending_model_path).await else {
                continue;
            };

            let model_name = raw.trim().to_string();
            if model_name.is_empty() {
                continue;
            }

            // Consume the signal file before issuing the request to avoid
            // repeated attempts if the request fails.
            let _ = tokio::fs::remove_file(&pending_model_path).await;

            // Check if we have an active session - if not, skip model switch
            let Some(acp_session_id) = acp_session_id_holder.lock().await.clone() else {
                tracing::warn!(
                    model = %model_name,
                    "⚠️ [MODEL-POLLER] No active ACP session yet - skipping model switch"
                );
                continue;
            };

            // Validate student is allowed to use this model (permission enforcement)
            let allowed_to_switch = match db_sess::get_session(&pool, &session_id).await {
                Ok(Some(sess)) => {
                    match crate::db::models::models_for_student(&pool, &sess.student_id).await {
                        Ok(allowed_models) => {
                            if allowed_models.contains(&model_name) {
                                tracing::info!(
                                    model = %model_name,
                                    student_id = %sess.student_id,
                                    "✓ [MODEL-POLLER] Student permitted to use model"
                                );
                                true
                            } else {
                                tracing::warn!(
                                    model = %model_name,
                                    student_id = %sess.student_id,
                                    "✗ [MODEL-POLLER] Model not in student's allowed list (ACCESS DENIED)"
                                );
                                false
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                model = %model_name,
                                error = %e,
                                "✗ [MODEL-POLLER] Failed to check student permissions"
                            );
                            false
                        }
                    }
                }
                _ => {
                    tracing::warn!(
                        model = %model_name,
                        session_id = %session_id,
                        "✗ [MODEL-POLLER] Session not found (cannot verify permissions)"
                    );
                    false
                }
            };

            if !allowed_to_switch {
                tracing::warn!(
                    model = %model_name,
                    session_id = %session_id,
                    "[MODEL-POLLER] Rejecting unauthorized model switch attempt"
                );
                continue;
            }

            match cx
                .send_request(SetSessionModelRequest::new(
                    acp_session_id.clone(),
                    model_name.clone(),
                ))
                .block_task()
                .await
            {
                Ok(_) => {
                    *model_arc.lock().await = Some(model_name.clone());

                    if let Err(e) =
                        db_sess::set_session_model(&pool, &session_id, &model_name).await
                    {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %e,
                            "failed to update session model in DB"
                        );
                    }

                    let frame =
                        serde_json::json!({"type": "model_changed", "model": model_name})
                            .to_string();
                    let _ = ctrl_tx.send(frame).await;

                    tracing::info!(
                        model = %model_name,
                        session_id = %session_id,
                        "model switched via ACP"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        model = %model_name,
                        error = %e,
                        "SetSessionModelRequest failed"
                    );
                }
            }
        }
    });
}
