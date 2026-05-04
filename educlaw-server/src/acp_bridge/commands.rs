// acp_bridge/commands.rs
//
// ACP command handlers for session management.
// These forward ACP requests from the WebSocket to Goose and handle responses.

use sacp::schema::{ForkSessionRequest, ListSessionsRequest, LoadSessionRequest, SessionId};
use sacp::{Agent as SacpAgent, ConnectionTo};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::{AppError, Result};

/// Control message sent from frontend through WebSocket to trigger ACP commands
#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
pub enum ControlMessage {
    #[serde(rename = "list_sessions")]
    ListSessions,
    #[serde(rename = "load_session")]
    LoadSession { thread_id: String },
    #[serde(rename = "fork_session")]
    ForkSession { thread_id: String },
}

/// Response for list_sessions command
#[derive(Debug, Serialize)]
pub struct SessionListItem {
    pub id: String,
    pub title: Option<String>,
    pub updated_at: Option<String>,
    pub cwd: String,
    pub metadata: Option<serde_json::Value>,
}

/// Response for fork_session command
#[derive(Debug, Serialize)]
pub struct ForkSessionResult {
    pub new_session_id: String,
}

/// Handle ListSessionsRequest: fetch available threads from Goose
pub async fn handle_list_sessions(
    cx: &ConnectionTo<SacpAgent>,
) -> Result<Vec<SessionListItem>> {
    let req = ListSessionsRequest::new();
    let resp = cx
        .send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ListSessions ACP error: {e}")))?;

    let items = resp
        .sessions
        .into_iter()
        .map(|info| SessionListItem {
            id: info.session_id.0.to_string(),
            title: info.title,
            updated_at: info.updated_at,
            cwd: info.cwd.display().to_string(),
            metadata: Some(serde_json::to_value(info.meta).unwrap_or_default()),
        })
        .collect();

    Ok(items)
}

/// Handle LoadSessionRequest: load a specific thread and start replay
pub async fn handle_load_session(
    cx: &ConnectionTo<SacpAgent>,
    thread_id: String,
) -> Result<()> {
    tracing::info!("📨 [LOAD-SESSION] Sending LoadSessionRequest for thread: {}", thread_id);
    
    let req = LoadSessionRequest::new(SessionId::new(thread_id.clone()), PathBuf::from("."));

    // block_task is safe here: called from the WebSocket receive loop (a plain
    // tokio task), NOT from inside the SACP dispatch loop.  The dispatch loop
    // stays free to deliver the replay SessionNotification events that Goose
    // sends BEFORE it sends the LoadSessionResponse.
    let result = cx.send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("LoadSession ACP error: {e}")));

    match &result {
        Ok(_) => tracing::info!("✅ [LOAD-SESSION] LoadSessionResponse received for thread: {}", thread_id),
        Err(e) => tracing::error!("❌ [LOAD-SESSION] Failed: {} for thread: {}", e, thread_id),
    }

    result.map(|_| ()) // Discard LoadSessionResponse, return ()
}

/// Handle ForkSessionRequest: copy source thread and create new session with forked history
pub async fn handle_fork_session(
    cx: &ConnectionTo<SacpAgent>,
    source_thread_id: String,
) -> Result<ForkSessionResult> {
    // ForkSession copies all messages + metadata from source thread into a new thread
    // Returns new SessionId which can then be loaded to continue conversation
    let req = ForkSessionRequest::new(
        SessionId::new(source_thread_id),
        PathBuf::from("."),
    );

    let resp = cx
        .send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ForkSession ACP error: {e}")))?;

    Ok(ForkSessionResult {
        new_session_id: resp.session_id.0.to_string(),
    })
}
