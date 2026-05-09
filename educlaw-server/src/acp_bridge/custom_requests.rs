// educlaw-server/src/acp_bridge/custom_requests.rs
//
// Custom ACP requests for Goose-specific functionality (session import/export)

use sacp::{JsonRpcRequest, JsonRpcResponse};
use serde::{Deserialize, Serialize};

/// Export a Goose session as a JSON string.
/// ACP method: `_goose/session/export`
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonRpcRequest)]
#[request(method = "_goose/session/export", response = ExportSessionResponse)]
#[serde(rename_all = "camelCase")]
pub struct ExportSessionRequest {
    pub session_id: String,
}

/// Response for export request: raw JSON string of the full session
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonRpcResponse)]
pub struct ExportSessionResponse {
    pub data: String,
}

/// Import a Goose session from a JSON string.
/// ACP method: `_goose/session/import`
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonRpcRequest)]
#[request(method = "_goose/session/import", response = ImportSessionResponse)]
pub struct ImportSessionRequest {
    pub data: String,
}

/// Response for import request: metadata of the newly created session
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonRpcResponse)]
#[serde(rename_all = "camelCase")]
pub struct ImportSessionResponse {
    pub session_id: String,
    pub title: Option<String>,
    pub updated_at: Option<String>,
    pub message_count: u64,
}
