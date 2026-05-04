// acp_bridge/messages.rs
//
// JSON-deserializable messages sent from the browser over the WebSocket.

/// A message sent from the browser WebSocket client.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ClientMessage {
    /// User typed input to send as a prompt to goose.
    /// Optional: `image` field contains base64-encoded image data (data-url format or raw base64).
    /// Optional: `mime_type` field (defaults to "image/png" if image present).
    Input {
        data: String,
        #[serde(default)]
        image: Option<String>,
        #[serde(default)]
        mime_type: Option<String>,
    },
    /// Request available models for this session.
    /// Backend returns: {"type":"models","models":[...],"active":"..."}
    GetModels,
    /// Terminal resize event (no-op for ACP — goose runs headless).
    Resize { cols: u16, rows: u16 },
    /// Cancel the current in-flight prompt.
    Cancel,
    /// List available threads/sessions from Goose.
    /// Backend returns: {"type":"sessions_list","sessions":[...]}
    #[serde(rename = "list_sessions")]
    ListSessions,
    /// Load a specific thread and replay its message history.
    /// Backend streams SessionNotifications with message replay.
    #[serde(rename = "load_session")]
    LoadSession { thread_id: String },
    /// Fork an existing session: copy thread + messages into new session.
    /// Backend returns: {"type":"forked_session","new_session_id":"..."}
    #[serde(rename = "fork_session")]
    ForkSession { thread_id: String },
}
