// acp_bridge/model_poller.rs
//
// Background task that polls `pending_model.txt` (written by the REST API
// when the teacher changes a session's model) and issues a
// `SetSessionModelConfigRequest` over ACP, then updates the DB and notifies the
// browser via the ctrl channel.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use goose_sdk::custom_requests::SetSessionModelConfigRequest;
use sacp::schema::{
    SessionConfigId, SessionConfigOptionValue, SessionId, SetSessionConfigOptionRequest,
};
use sacp::{Agent as SacpAgent, ConnectionTo};
use tokio::sync::mpsc;

use crate::db::DbBackend;

/// Spawns the model-switch poller as a fire-and-forget tokio task.
///
/// Every 500 ms it checks whether `pending_model_path` exists.  If so:
///   1. Removes the file (consume the signal).
///   2. Sends `SetSessionModelConfigRequest` over ACP (with thinking params).
///   3. Updates the cached `model_arc`.
///   4. Persists the new model name to the DB.
///   5. Pushes a `{"type":"model_changed","model":"..."}` frame to the browser.
pub fn spawn_model_poller(
    pending_model_path: PathBuf,
    cx: ConnectionTo<SacpAgent>,
    acp_session_id_holder: Arc<tokio::sync::Mutex<Option<SessionId>>>,
    session_id: String,
    backend: Arc<dyn DbBackend>,
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
            let allowed_to_switch = match backend.get_session(&session_id).await {
                Ok(Some(sess)) => {
                    match backend.models_for_student(&sess.student_id).await {
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

            // Look up full model from DB (provider + thinking_params)
            let (provider_id, thinking_params) =
                match backend.get_model_by_name(&model_name).await {
                    Ok(Some(model)) => {
                        let mut thinking = model.parsed_thinking_params();

                        // Check for per-session thinking overrides written by
                        // the REST API (PUT /sessions/:id/model with thinking_params).
                        let override_path = pending_model_path
                            .parent()
                            .map(|p| p.join("pending_thinking.json"));
                        if let Some(ref path) = override_path {
                            if let Ok(raw) = tokio::fs::read_to_string(path).await {
                                if let Ok(overrides) =
                                    serde_json::from_str::<HashMap<String, serde_json::Value>>(&raw)
                                {
                                    if !overrides.is_empty() {
                                        thinking.get_or_insert_with(HashMap::new).extend(overrides);
                                        let _ = tokio::fs::remove_file(path).await;
                                        tracing::info!(
                                            model = %model_name,
                                            "applied per-session thinking overrides"
                                        );
                                    }
                                }
                            }
                        }

                        (model.provider, thinking)
                    }
                    Ok(None) => {
                        tracing::warn!(
                            model = %model_name,
                            "[MODEL-POLLER] Model not found in database - cannot determine provider"
                        );
                        (None, None)
                    }
                    Err(e) => {
                        tracing::error!(
                            model = %model_name,
                            error = %e,
                            "[MODEL-POLLER] Failed to look up model in database"
                        );
                        (None, None)
                    }
                };

            // If we have a provider, switch to it first
            if let Some(provider) = &provider_id {
                tracing::info!(
                    provider = %provider,
                    model = %model_name,
                    "[MODEL-POLLER] Switching provider before model"
                );

                match cx
                    .send_request(SetSessionConfigOptionRequest::new(
                        acp_session_id.clone(),
                        SessionConfigId::new("provider"),
                        SessionConfigOptionValue::value_id(provider.clone()),
                    ))
                    .block_task()
                    .await
                {
                    Ok(_) => {
                        tracing::info!(
                            provider = %provider,
                            session_id = %session_id,
                            "[MODEL-POLLER] Provider switched successfully"
                        );
                    }
                    Err(e) => {
                        tracing::warn!(
                            provider = %provider,
                            error = %e,
                            "[MODEL-POLLER] Provider switch failed - continuing with model switch anyway"
                        );
                    }
                }
            } else {
                tracing::debug!(
                    model = %model_name,
                    "[MODEL-POLLER] No provider configured for model - using current provider"
                );
            }

            // Now switch the model using the custom ACP method that supports
            // request_params (thinking_type, budget_tokens, effort, etc.).
            // thinking_params comes from the models.thinking_params JSON column.
            match cx
                .send_request(SetSessionModelConfigRequest {
                    session_id: acp_session_id.to_string(),
                    model_id: model_name.clone(),
                    request_params: thinking_params,
                })
                .block_task()
                .await
            {
                Ok(_) => {
                    *model_arc.lock().await = Some(model_name.clone());

                    if let Err(e) =
                        backend.set_session_model(&session_id, &model_name).await
                    {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %e,
                            "failed to update session model in DB"
                        );
                    }

                    // Save to student record for persistence across logins
                    if let Ok(Some(sess)) = backend.get_session(&session_id).await {
                        if let Err(e) =
                            backend.set_last_model(&sess.student_id, &model_name).await
                        {
                            tracing::warn!(
                                student_id = %sess.student_id,
                                error = %e,
                                "failed to update student last_model"
                            );
                        }
                    }

                    let frame = serde_json::json!({"type": "model_changed", "model": model_name})
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
