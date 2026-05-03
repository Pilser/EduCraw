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
}
