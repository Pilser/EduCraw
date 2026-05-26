// educlaw-server/src/acp_bridge/custom_requests.rs
//
// Re-exports of goose-sdk custom ACP request/response types.
// Previously these were duplicated locally; now they come from the canonical
// source so import/export session stays in sync with Goose.

pub use goose_sdk::custom_requests::{
    DeleteSessionRequest, ExportSessionRequest, ExportSessionResponse, ImportSessionRequest,
    ImportSessionResponse, SetSessionModelConfigRequest, SetSessionModelConfigResponse,
};
