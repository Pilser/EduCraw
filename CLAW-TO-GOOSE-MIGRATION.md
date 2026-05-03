# Claw → Goose Migration: Feature Mapping

> **Goal**: Replace claw stdio with goose ACP protocol while preserving educational features and namespace isolation.

---

## PART 1: CURRENT CLAW ARCHITECTURE

### Spawn Model (`educlaw-server/src/pty_bridge.rs`)
```rust
unshare --mount --pid --fork \
  claw --dangerously-skip-permissions [--model M]
  
Environment (piped stdin/stdout/stderr):
  CLAW_CONFIG_HOME = /session/config
  EDUCLAW_SESSION_ID = unique-id
  EDUCLAW_WORKSPACE = /overlay/merged
  EDUCLAW_STUDENT_JSON = {...}
  EDUCLAW_SYSTEM_PROMPT = base64(tutor intro)
  XAI_API_KEY, ANTHROPIC_API_KEY, etc.
```

### Communication Flow
```
browser (WebSocket)
  ↓ ServerMessage
educlaw-server (run_pty_session)
  ├─ Write user input → claw stdin
  ├─ Read claw stdout → parse OSC + plain text
  ├─ Route to chat panel + xterm.js
  └─ Monitor state changes
```

---

## PART 2: FEATURES USED FROM CLAW

| Feature | Current (Claw) | Usage | Migration to Goose |
|---------|---|---|---|
| **Stdin Input** | `text\n` | User message injection | ACP: `PromptRequest` with user input |
| **OSC Envelopes** | `ESC]99;{json}BEL` | Tool output, model switch, diagnostics | ACP: `SessionNotification` (structured) |
| **Structured Output** | `EDUCLAW_STRUCTURED_OUTPUT=1` | Every token is OSC JSON | ACP: Streaming via `MessageStart/MessageDelta` |
| **Turn Detection** | "✨ Done" + "> " prompt | End of AI response | ACP: `MessageEnd` notification |
| **Model Switching** | `/model name\n` injected to stdin | Mid-session model change | ACP: `PromptRequest` with model override in meta |
| **Stderr Drain** | Logged at debug level | Diagnostics, errors | ACP: `LogMessage` notifications |
| **Config Home** | `CLAW_CONFIG_HOME` | Credentials, settings | Goose: `GOOSE_PATH_ROOT` environment var |
| **Permissions Skip** | `--dangerously-skip-permissions` | Suppress permission prompts | ACP: `RequestApproval` not needed (server approves) |
| **System Prompt** | `EDUCLAW_SYSTEM_PROMPT` env var | Tutor introduction override | ACP: Meta field in `PromptRequest` |
| **Student Context** | `EDUCLAW_STUDENT_JSON` env var | Instructions.md generation | ACP: Meta field in `PromptRequest` |
| **Session ID** | `EDUCLAW_SESSION_ID` env var | Tracking, logs | ACP: Meta field in all requests |

---

## PART 3: GOOSE ACP EQUIVALENT PROTOCOL

### Spawn Model
```rust
unshare --mount --pid --fork \
  goose acp --with-builtin bash,read_file,write_file
  
Environment (stdin/stdout JSON-RPC):
  GOOSE_PATH_ROOT = /session/overlay/home/student
  XAI_API_KEY, ANTHROPIC_API_KEY, etc.
  (No EDUCLAW_* vars needed - passed via ACP meta)
```

### Communication Flow
```
browser (WebSocket)
  ↓ ServerMessage
educlaw-server (acp_bridge.rs - NEW)
  ├─ Build PromptRequest with meta
  ├─ Send JSON-RPC to goose stdin
  ├─ Read JSON-RPC from goose stdout
  ├─ Parse SessionNotification/MessageStart/MessageDelta/etc
  ├─ Route to chat panel (no OSC parsing needed!)
  └─ Monitor state changes
```

---

## PART 4: MIGRATION CHECKLIST

### Remove from educlaw-server:
- [ ] `pty_bridge.rs` — entire file (OSC parsing, claw spawn, stdin injection)
- [ ] `claw_bin` from AppState
- [ ] CLAW_CONFIG_HOME logic
- [ ] OSC envelope parsing (`OSC_PREFIX`, `split_output_ordered`, etc.)
- [ ] Turn detection logic ("✨ Done" + "> ")
- [ ] Model injection `/model` command
- [ ] Stderr drain task

### Add to educlaw-server:
- [ ] `acp_bridge.rs` — goose ACP client (SACP protocol)
  - Connect to goose via stdio
  - Send `PromptRequest` with user input + meta
  - Receive & parse `MessageStart`, `MessageDelta`, `MessageEnd`
  - Handle `ToolUseStart/End` for tool executions
  - Route streaming tokens to chat panel
  - Handle model switches via meta override
- [ ] `GOOSE_PATH_ROOT` env var setup (replaces `CLAW_CONFIG_HOME`)
- [ ] `PromptRequest` builder (replaces stdin line writing)
- [ ] SACP message routing logic (replaces OSC parsing)
- [ ] Session metadata passed via ACP (student_id, system_prompt, student_json in meta)

### No Changes Needed:
- Namespace isolation (unshare --mount --pid still used)
- OverlayFS merge strategy
- Session lifecycle (create/delete)
- Database (DB retains same schema)
- WebSocket to browser (interface unchanged)
- xterm.js terminal display (receives same binary/ANSI frames)
- Student home directory layout

---

## PART 5: CODE MAPPING

### Old: `run_pty_session()` function signature
```rust
pub async fn run_pty_session(
    ws: WebSocket,
    claw_bin: PathBuf,
    workspace: PathBuf,
    config_home: PathBuf,
    env_vars: Vec<(String, String)>,
    model: Option<String>,
    last_input_at: Arc<AtomicU64>,
    broker_rx: mpsc::Receiver<Vec<u8>>,
    pool: SqlitePool,
    session_id: String,
    student_id: String,
    logs_dir: PathBuf,
) -> Result<()>
```

### New: `run_acp_session()` function signature
```rust
pub async fn run_acp_session(
    ws: WebSocket,
    goose_bin: PathBuf,
    workspace: PathBuf,
    config_home: PathBuf,  // Now contains GOOSE_PATH_ROOT value
    env_vars: Vec<(String, String)>,
    model: Option<String>,
    last_input_at: Arc<AtomicU64>,
    pool: SqlitePool,
    session_id: String,
    student_id: String,
    logs_dir: PathBuf,
    student_json: serde_json::Value,  // For ACP meta
    system_prompt: String,              // For ACP meta
) -> Result<()>
```

### Old: Claw input injection
```rust
// Write to stdin
stdin.write_all(format!("{}\n", user_input).as_bytes()).await?;
```

### New: ACP request
```rust
// Build SACP PromptRequest
let request = PromptRequest {
    messages: vec![Message {
        role: "user",
        content: vec![ContentBlock::Text { text: user_input }],
    }],
    meta: SessionMeta {
        session_id,
        student_id,
        student_json,
        system_prompt,
        model_override: model.clone(),
    },
    ..
};

// Send JSON-RPC
let rpc = json_rpc::Request {
    method: "prompt".to_string(),
    params: serde_json::to_value(&request)?,
    id: request_id,
};
goose_stdin.write_all(serde_json::to_string(&rpc).as_bytes()).await?;
```

### Old: Turn detection
```rust
if accumulated_output.contains("✨ Done") && accumulated_output.ends_with("> ") {
    // Turn complete
}
```

### New: Turn detection
```rust
if let Some(notification) = goose_stdout_notification {
    match notification {
        SessionNotification::MessageEnd { .. } => {
            // Turn complete (goose tells us explicitly)
        }
    }
}
```

### Old: Model switching
```rust
// Inject into stdin
stdin.write_all(format!("/model {}\n", new_model).as_bytes()).await?;
```

### New: Model switching
```rust
// Send new PromptRequest with model_override in meta
let request = PromptRequest {
    meta: SessionMeta {
        model_override: Some(new_model),
        ..
    },
    ..
};
```

### Old: OSC parsing
```rust
// Parse: ESC]99;{json}BEL
let envelope = serde_json::from_slice(body)?;
match envelope["type"].as_str() {
    Some("assistant_text") => { /* handle token */ }
    Some("tool_use") => { /* handle tool */ }
    _ => {}
}
```

### New: SACP parsing (no custom protocol!)
```rust
// Parse standard SACP JSON-RPC
let response: JsonRpcResponse = serde_json::from_slice(chunk)?;
match response.method {
    "sessionNotification" => {
        let notif: SessionNotification = serde_json::from_value(response.params)?;
        match notif {
            SessionNotification::MessageStart { .. } => { /* handle */ }
            SessionNotification::MessageDelta { token, .. } => { /* emit token */ }
            SessionNotification::MessageEnd { .. } => { /* turn complete */ }
            SessionNotification::ToolUseStart { name, input } => { /* tool */ }
            _ => {}
        }
    }
}
```

---

## PART 6: ENVIRONMENT SETUP

### Current (Claw)
```bash
export CLAW_CONFIG_HOME=/session/config
export EDUCLAW_SESSION_ID=<id>
export EDUCLAW_WORKSPACE=/overlay/merged
export EDUCLAW_STUDENT_JSON='{"id":"...","username":"..."}'
export EDUCLAW_SYSTEM_PROMPT=<base64>
export XAI_API_KEY=...
```

### New (Goose)
```bash
export GOOSE_PATH_ROOT=/overlay/home/student
# (passed to goose subprocess)

export XAI_API_KEY=...
export ANTHROPIC_API_KEY=...
# Same API keys, no session/workspace/student vars needed
# All metadata passed via ACP PromptRequest.meta instead
```

---

## PART 7: SESSION METADATA PASSING

### Current: Environment Variables
```
EDUCLAW_SESSION_ID → Used by claw for logging
EDUCLAW_STUDENT_JSON → Used by init.sh to generate instructions.md
EDUCLAW_SYSTEM_PROMPT → Used by init.sh to override system prompt
```

### New: ACP Request Meta
```rust
pub struct SessionMeta {
    pub session_id: String,              // Logged by goose
    pub student_id: String,              // Logged by goose
    pub student_json: serde_json::Value, // For tool context (no file writing)
    pub system_prompt: String,           // Goose applies directly
    pub model_override: Option<String>,  // For model switching
}
```

**Key Difference**: 
- No files written (`instructions.md`) — goose reads all context from ACP request meta
- No init.sh script needed — goose initializes from ACP message
- Simpler, more direct

---

## PART 8: NAMESPACE ISOLATION (UNCHANGED)

Both spawn models use identical namespace isolation:

```bash
# Current (Claw)
unshare --mount --pid --fork claw ...
  env: CLAW_CONFIG_HOME=/overlay/home/student

# New (Goose)
unshare --mount --pid --fork goose acp
  env: GOOSE_PATH_ROOT=/overlay/home/student

# Result: IDENTICAL
✓ Mount namespace (OverlayFS per student)
✓ PID namespace (subprocess isolation)
✓ Network isolation via namespace
✓ Data isolation via env var
```

---

## PART 9: ERROR HANDLING

| Scenario | Claw | Goose |
|---|---|---|
| Spawn fails | Read error message from stderr | Read error from `JsonRpcError` |
| Subprocess crashes | Detect EOF on stdout | Detect `ConnectionError` or EOF |
| Permission denied | Suppressed via flag | Not applicable (server decides) |
| Invalid model | Claw logs error | Goose returns error in response |
| Tool fails | OSC envelope with error | `ToolUseEnd` with error in meta |

---

## PART 10: TESTING STRATEGY

### Old (OSC parsing test)
```rust
#[test]
fn test_osc_envelope_parsing() {
    let input = b"data\x1b]99;{\"type\":\"assistant_text\",\"text\":\"hi\"}\x07more";
    let chunks = split_output_ordered(input, &mut buf);
    assert_eq!(chunks[0], OutputChunk::Clean(b"data"));
    assert_eq!(chunks[1], OutputChunk::Envelope(...));
}
```

### New (SACP message parsing test)
```rust
#[test]
fn test_sacp_message_parsing() {
    let input = r#"{"jsonrpc":"2.0","method":"sessionNotification","params":{"type":"messageDelta","token":"hi"}}"#;
    let msg: JsonRpcResponse = serde_json::from_str(input)?;
    let notif: SessionNotification = serde_json::from_value(msg.params)?;
    assert!(matches!(notif, SessionNotification::MessageDelta { .. }));
}
```

---

## PART 11: FILES TO CHANGE

### Delete
```
educlaw-server/src/pty_bridge.rs  (entire — replace with acp_bridge.rs)
```

### Modify
```
educlaw-server/src/api/ws.rs       (replace run_pty_session call)
educlaw-server/src/api/mod.rs       (replace claw_bin with goose_bin)
educlaw-server/src/main.rs          (replace CLAW_BIN env var)
educlaw-server/src/session/namespace.rs  (remove claw spawn logic)
```

### Create
```
educlaw-server/src/acp_bridge.rs    (new ACP client implementation)
educlaw-server/src/sacp/mod.rs      (SACP message types)
educlaw-server/src/sacp/messages.rs (PromptRequest, SessionNotification, etc.)
```

---

## PART 12: DEPENDENCIES TO ADD

```toml
[dependencies]
sacp = { git = "https://github.com/pinecone-io/goose.git", package = "sacp" }
# or from crates.io if available
tokio = { version = "1", features = ["full"] }
serde_json = "1"
```

---

## PART 13: QUICK REFERENCE: CLAW COMMANDS → GOOSE ACP

| Operation | Claw | Goose ACP |
|---|---|---|
| **Spawn** | `claw --dangerously-skip-permissions` | `goose acp` |
| **Send message** | Write `text\n` to stdin | Send `PromptRequest` JSON-RPC |
| **Get response** | Read from stdout (OSC frames) | Read `SessionNotification` JSON-RPC |
| **Switch model** | Inject `/model name\n` | Send `PromptRequest` with meta.model_override |
| **Configure** | `CLAW_CONFIG_HOME` env var | `GOOSE_PATH_ROOT` env var |
| **Suppress perms** | `--dangerously-skip-permissions` flag | N/A (server-decided) |
| **System prompt** | `EDUCLAW_SYSTEM_PROMPT` env var | `PromptRequest.meta.system_prompt` field |

---

**Status**: Ready for implementation  
**Namespace Isolation**: Preserved ✅  
**Breaking Changes**: WebSocket API to browser remains unchanged ✅
