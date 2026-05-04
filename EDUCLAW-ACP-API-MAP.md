# Educlaw ACP API Map

Maps ACP APIs to their Goose implementation locations.

## APIs Implemented in Educlaw

## APIs Implemented in Educlaw

### Initialize
- **Educlaw**: [client.rs#L102-L120](educlaw-server/src/acp_bridge/client.rs#L102-L120)
- **Goose Dispatch**: [dispatch.rs#L23-L26](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L23-L26)
- **Goose Handler**: [server.rs#L1716-L1750](goose-workspace/crates/goose/src/acp/server.rs#L1716-L1750) `on_initialize()`

### NewSession
- **Educlaw**: [client.rs#L131-L158](educlaw-server/src/acp_bridge/client.rs#L131-L158)
- **Goose Dispatch**: [dispatch.rs#L35-L45](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L35-L45)
- **Goose Handler**: [server.rs#L1752-L1850](goose-workspace/crates/goose/src/acp/server.rs#L1752-L1850) `on_new_session()`

### SetSessionModel
- **Educlaw**: [client.rs#L182-L201](educlaw-server/src/acp_bridge/client.rs#L182-L201)
- **Goose Dispatch**: [dispatch.rs#L310-L314](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L310-L314)
- **Goose Handler**: [server.rs#L2453-L2488](goose-workspace/crates/goose/src/acp/server.rs#L2453-L2488) `on_set_model()`

### Prompt
- **Educlaw**: [session.rs#L329-L363](educlaw-server/src/acp_bridge/session.rs#L329-L363)
- **Goose Dispatch**: [dispatch.rs#L66-L76](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L66-L76)
- **Goose Handler**: [server.rs#L2286-L2432](goose-workspace/crates/goose/src/acp/server.rs#L2286-L2432) `on_prompt()`

### Cancel
- **Educlaw**: [session.rs#L430-L440](educlaw-server/src/acp_bridge/session.rs#L430-L440)
- **Goose Dispatch**: [dispatch.rs#L84-L86](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L84-L86)
- **Goose Handler**: [server.rs#L2434-L2451](goose-workspace/crates/goose/src/acp/server.rs#L2434-L2451) `on_cancel()`

### RequestPermission (Goose → Educlaw)
- **Educlaw**: [client.rs#L87-L90](educlaw-server/src/acp_bridge/client.rs#L87-L90) (receives & auto-approves)
- **Goose Sender**: [server.rs#L1600-L1648](goose-workspace/crates/goose/src/acp/server.rs#L1600-L1648) `request_permission_from_client()`

### SessionNotification (Goose → Educlaw)
- **Educlaw**: [client.rs#L75-L84](educlaw-server/src/acp_bridge/client.rs#L75-L84) (receives stream)
- **Goose Sender**: [server.rs](goose-workspace/crates/goose/src/acp/server.rs) `cx.send_notification()`
  - AgentMessageChunk: L1348
  - ToolCall: L1427
  - ToolCallUpdate: L1460, L1500, L1511

---

## APIs Not Yet Implemented in Educlaw

### Authenticate
- **Goose Dispatch**: [dispatch.rs#L28-L32](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L28-L32)
- **Goose Handler**: Returns empty `AuthenticateResponse::new()`
- **Purpose**: Authentication flow (currently no-op)

### LoadSession
- **Educlaw**: [commands.rs#L66-L89](educlaw-server/src/acp_bridge/commands.rs#L66-L89)
- **Goose Dispatch**: [dispatch.rs#L46-L61](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L46-L61)
- **Goose Handler**: [server.rs#L2034-L2280](goose-workspace/crates/goose/src/acp/server.rs#L2034-L2280) `on_load_session()`
- **Purpose**: Resume existing session from previous connection
- **Chat Chain**: ✅ YES - Streams full message history via SessionNotification
- **How**: Reads thread_manager.list_messages() and replays all UserMessageChunk/AgentMessageChunk/ToolCall/ToolCallUpdate notifications to rebuild UI
- **Requirements**: 
  - `session_id`: Thread ID to load
  - `cwd`: Working directory (PathBuf)
  - Optional: `mcp_servers` array
- **Note**: Only replays messages where `metadata.user_visible = true`
- **⚠️ Auto-Load Trap**: NewSession creates empty thread with current timestamp → becomes "most recent" → auto-load loads empty session. Filter by `messageCount > 0` in meta!

### SetSessionConfigOption
- **Goose Dispatch**: [dispatch.rs#L91-L276](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L91-L276)
- **Goose Handler**: Inline handler (supports: provider, mode, model)
- **Purpose**: Change session configuration (unified API for provider/mode/model)

### SetSessionMode
- **Goose Dispatch**: [dispatch.rs#L277-L306](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L277-L306)
- **Goose Handler**: [server.rs#L2558](goose-workspace/crates/goose/src/acp/server.rs#L2558) `on_set_mode()`
- **Purpose**: Switch agent mode (e.g., "agentic" vs "chat")

### ListSessions
- **Goose Dispatch**: [dispatch.rs#L329-L340](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L329-L340)
- **Goose Handler**: [server.rs#L2678](goose-workspace/crates/goose/src/acp/server.rs#L2678) `on_list_sessions()`
- **Purpose**: Get list of all active sessions

### CloseSession
- **Goose Dispatch**: [dispatch.rs#L341-L352](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L341-L352)
- **Goose Handler**: [server.rs#L2771](goose-workspace/crates/goose/src/acp/server.rs#L2771) `on_close_session()`
- **Purpose**: Gracefully close a session

### ForkSession
- **Goose Dispatch**: [dispatch.rs#L353-L366](goose-workspace/crates/goose/src/acp/server/dispatch.rs#L353-L366)
- **Goose Handler**: [server.rs#L2703](goose-workspace/crates/goose/src/acp/server.rs#L2703) `on_fork_session()`
- **Purpose**: Create new session from existing conversation history

---

## Custom Goose APIs

Custom `_goose/*` methods handled via `dispatch_custom_request()` in Goose.

**Full List**: [EDUCLAW-CUSTOM-API-MAP.md](EDUCLAW-CUSTOM-API-MAP.md)

### Key Categories
- **Extensions**: Add/remove/list extensions (`_goose/extensions/*`, `_goose/config/extensions/*`)
- **Session**: Rename/archive/export/import sessions (`_goose/session/*`, `session/delete`)
- **Config**: Read/upsert/remove config (`_goose/config/*`)
- **Secrets**: Check/upsert/remove secrets (`_goose/secret/*`)
- **Sources**: Manage skills/recipes/agents (`_goose/sources/*`) - see [EDUCLAW-RECIPE-API-MAP.md](EDUCLAW-RECIPE-API-MAP.md)
- **Dictation**: Transcribe audio, manage models (`_goose/dictation/*`)
- **Providers**: List/refresh provider inventory (`_goose/providers/*`)
- **Tools**: Get available tools (`_goose/tools`)
- **Resources**: Read MCP resources (`_goose/resource/read`)
- **Working Dir**: Update session working directory (`_goose/working_dir/update`)

---

Last Updated: 2026-05-04
