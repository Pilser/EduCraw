# Goose Session Import/Export via ACP - Integration Guide

---

## 1. Overview

Goose fully supports chat session import/export via **custom ACP (Agent Client Protocol) methods** (Goose-specific extensions to standard ACP). These methods are already implemented in Goose and exposed via the standard ACP endpoint, which EduCraw already uses to connect to Goose.

**EduCraw requires no changes to Goose.** All integration work is on the EduCraw server side.

---

## 2. Supported Protocols

| Protocol | Support | Notes |
|----------|---------|-------|
| **ACP** | ✅ Yes | Custom methods `_goose/session/export` and `_goose/session/import` |
| **Goose SDK** | ✅ Yes | `goose-sdk/src/custom_requests.rs` defines typed request/response structs |
| **Other HTTP** | ❌ Not recommended | Legacy REST API exists but ACP is the primary standardized protocol |

---

## 3. ACP Methods for Session Import/Export

Goose implements two custom ACP methods (defined in `goose-workspace/crates/goose-sdk/src/custom_requests.rs:250-279`):

| Method | Description | Request Fields | Response Fields |
|--------|-------------|----------------|-----------------|
| `_goose/session/export` | Export full session (conversation + metadata) as JSON string | `session_id: String` | `data: String` (raw JSON of the session) |
| `_goose/session/import` | Import a session from a previously exported JSON string (creates new session with new ID) | `data: String` (exported JSON) | `session_id: String`, `title: Option<String>`, `updated_at: Option<String>`, `message_count: u64` |

### 3.1 Export Session Details

- **Method**: `_goose/session/export`
- **Request**:
  ```json
  {
    "jsonrpc": "2.0",
    "method": "_goose/session/export",
    "params": { "session_id": "<goose-session-id>" },
    "id": 1
  }
  ```
- **Response**:
  ```json
  {
    "jsonrpc": "2.0",
    "result": { "data": "<full-session-json-string>" },
    "id": 1
  }
  ```

### 3.2 Import Session Details

- **Method**: `_goose/session/import`
- **Request**:
  ```json
  {
    "jsonrpc": "2.0",
    "method": "_goose/session/import",
    "params": { "data": "<full-session-json-string>" },
    "id": 2
  }
  ```
- **Response**:
  ```json
  {
    "jsonrpc": "2.0",
    "result": {
      "session_id": "<new-session-id>",
      "title": "Session Title",
      "updated_at": "2026-05-09T10:00:00Z",
      "message_count": 42
    },
    "id": 2
  }
  ```

---

## 4. Goose-Side Implementation (No Changes Needed)

Goose already handles these methods in:

- **Dispatch**: `goose-workspace/crates/goose/src/acp/server/custom_dispatch.rs:244`
- **Logic**: `goose-workspace/crates/goose/src/acp/server/sessions.rs:56-99`

Key implementation details:

- `on_export_session`: Calls `session_manager.export_session(&internal_id)` which returns the full session JSON.
- `on_import_session`: Calls `session_manager.import_session(&req.data, Some(SessionType::Acp))` and creates a new thread for the imported session.
- Imported sessions are created as `SessionType::Acp` with new unique IDs (no overwrite of existing sessions).

---

## 5. EduCraw Integration Steps

EduCraw uses the `sacp` crate for ACP communication (confirmed in `educlaw-server/src/acp_bridge/client.rs:13-17`). Follow the existing pattern for standard ACP methods (e.g., `list_sessions`, `load_session`).

---

### Step 5.1: Create Custom Request Structs

EduCraw's `acp_bridge/mod.rs` already declares `pub mod custom_requests;` but the file does not exist yet.

**Create**: `educlaw-server/src/acp_bridge/custom_requests.rs`

```rust
// educlaw-server/src/acp_bridge/custom_requests.rs

use serde::{Deserialize, Serialize};
use sacp::{JsonRpcRequest, JsonRpcResponse};
use schemars::JsonSchema;

/// Export a Goose session as a JSON string.
/// ACP method: `_goose/session/export`
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema, JsonRpcRequest)]
#[request(method = "_goose/session/export", response = ExportSessionResponse)]
#[serde(rename_all = "camelCase")]
pub struct ExportSessionRequest {
    pub session_id: String,
}

/// Response for export request: raw JSON string of the full session
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema, JsonRpcResponse)]
pub struct ExportSessionResponse {
    pub data: String,
}

/// Import a Goose session from a JSON string.
/// ACP method: `_goose/session/import`
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema, JsonRpcRequest)]
#[request(method = "_goose/session/import", response = ImportSessionResponse)]
pub struct ImportSessionRequest {
    pub data: String,
}

/// Response for import request: metadata of the newly created session
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema, JsonRpcResponse)]
#[serde(rename_all = "camelCase")]
pub struct ImportSessionResponse {
    pub session_id: String,
    pub title: Option<String>,
    pub updated_at: Option<String>,
    pub message_count: u64,
}
```

---

### Step 5.2: Add Handlers to `commands.rs`

Update `educlaw-server/src/acp_bridge/commands.rs` to add new control message variants and handlers.

#### 5.2.1: Add ControlMessage Variants

Add the following variants to the `ControlMessage` enum (after existing variants around line 22):

```rust
#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
pub enum ControlMessage {
    #[serde(rename = "list_sessions")]
    ListSessions,
    #[serde(rename = "load_session")]
    LoadSession { thread_id: String },
    #[serde(rename = "fork_session")]
    ForkSession { thread_id: String },
    // ── NEW ───────────────────────────────────────────────────────────
    #[serde(rename = "export_session")]
    ExportSession { session_id: String },
    #[serde(rename = "import_session")]
    ImportSession { data: String },
}
```

#### 5.2.2: Add Handler Functions

Add the following handler functions (after existing handlers, around line 105):

```rust
use super::custom_requests::{ExportSessionRequest, ImportSessionRequest, ImportSessionResponse};

/// Handle _goose/session/export: export a session as JSON string
pub async fn handle_export_session(
    cx: &ConnectionTo<SacpAgent>,
    session_id: String,
) -> Result<String> {
    let req = ExportSessionRequest { session_id };
    let resp = cx
        .send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ExportSession ACP error: {e}")))?;
    Ok(resp.data)
}

/// Handle _goose/session/import: import a session from JSON string
pub async fn handle_import_session(
    cx: &ConnectionTo<SacpAgent>,
    data: String,
) -> Result<ImportSessionResponse> {
    let req = ImportSessionRequest { data };
    let resp = cx
        .send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ImportSession ACP error: {e}")))?;
    Ok(resp)
}
```

---

### Step 5.3: Expose New Handlers in `mod.rs`

Update `educlaw-server/src/acp_bridge/mod.rs` to publicly export the new handlers:

```rust
pub use commands::{
    handle_export_session, handle_import_session, handle_fork_session, handle_list_sessions,
    handle_load_session, ControlMessage, ForkSessionResult, SessionListItem,
};
```

---

## 6. Frontend Integration

The frontend sends WebSocket messages with the following shapes to trigger export/import via the ACP bridge:

### 6.1 Export Session

```json
{
  "kind": "export_session",
  "session_id": "goose-session-id-here"
}
```

**Response** (sent back to frontend):
```json
{
  "kind": "export_session_result",
  "data": "<full-session-json-string>"
}
```

### 6.2 Import Session

```json
{
  "kind": "import_session",
  "data": "{\"id\":\"...\", \"name\":\"...\", \"conversation\": {...}, ...}"
}
```

**Response** (sent back to frontend):
```json
{
  "kind": "import_session_result",
  "session_id": "new-goose-session-id",
  "title": "Session Title",
  "updated_at": "2026-05-09T10:00:00Z",
  "message_count": 42
}
```

---

## 7. Key Notes

| Note | Details |
|------|---------|
| **No Goose changes required** | All methods are already implemented and available via ACP. |
| **Session type** | Imported sessions are created as `SessionType::Acp` in Goose. |
| **New session IDs** | Import creates a new session with a new ID — no risk of overwriting existing sessions. |
| **Format** | ACP export only supports JSON format. Gooses CLI supports additional formats (Markdown, YAML) but these are not exposed via ACP. |
| **EduCraw protocol** | Since EduCraw already uses ACP, no new protocol needs to be added. Use the existing ACP connection. |
| **Pattern follow** | Follow the existing pattern in `commands.rs` for `handle_list_sessions`, `handle_load_session`, etc. |

---

## 8. Related ACP Methods

Goose also supports additional session management via standard ACP methods:

| Method | Description | EduCraw Handler |
|--------|-------------|-----------------|
| `session/list` | List all available sessions | `handle_list_sessions` (existing) |
| `session/load` | Load/resume an existing session by ID | `handle_load_session` (existing) |
| `_goose/session/export` | Export session as JSON | `handle_export_session` (new) |
| `_goose/session/import` | Import session from JSON | `handle_import_session` (new) |

---

## 9. References

- **Goose SDK Custom Requests**: `goose-workspace/crates/goose-sdk/src/custom_requests.rs:250-279`
- **Goose ACP Dispatch**: `goose-workspace/crates/goose/src/acp/server/custom_dispatch.rs:244`
- **Goose ACP Session Logic**: `goose-workspace/crates/goose/src/acp/server/sessions.rs:56-99`
- **EduCraw ACP Client**: `educlaw-server/src/acp_bridge/client.rs`
- **EduCraw Image Handling**: `educlaw-server/src/acp_bridge/images.rs`
- **EduCraw Commands**: `educlaw-server/src/acp_bridge/commands.rs`
- **ACP Protocol Spec**: https://agentclientprotocol.com
- **Goose ACP Content Processing**: `goose-workspace/crates/goose/src/acp/server.rs:1315-1332`
- **EduCraw ACP Client**: `educlaw-server/src/acp_bridge/client.rs`
- **EduCraw Image Handling**: `educlaw-server/src/acp_bridge/images.rs`
- **EduCraw Commands**: `educlaw-server/src/acp_bridge/commands.rs`
- **ACP ContentBlock spec**: `agent-client-protocol-schema-0.11.3/src/content.rs` (ContentBlock enum at line 35)
- **ACP Protocol Spec**: https://agentclientprotocol.com
