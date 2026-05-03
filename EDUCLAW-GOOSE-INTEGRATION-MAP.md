# Educlaw ↔ Goose Integration Map

## WHAT IS GOOSE?

**Goose** is a modular Rust framework for building AI agents with:
- **ACP Protocol**: Structured communication between agent and client (JSON-RPC over stdio)
- **Agent Engine**: Multi-turn conversation loop, tool execution, state management
- **Provider Abstraction**: Support for multiple LLM backends (Anthropic, OpenAI, etc)
- **Extension System**: Load external tools and MCP servers
- **Session Management**: Per-user isolated conversation state

**Key Point**: Goose is a **subprocess** that runs independently. It communicates via structured JSON messages on stdin/stdout.

---

## WHAT IS EDUCLAW?

**Educlaw** is a web-based tutoring platform that:
- **Spawns AI agents per student** in isolated namespaces
- **Manages each student's filesystem** with OverlayFS (read-only subjects + read-write home)
- **Communicates with agent** via PTY (currently) or JSON-RPC (proposed)
- **Streams responses** to browser WebSocket
- **Enforces permissions** (which tools students can use)

**Key Point**: Educlaw is a **server** that manages multiple isolated student sessions.

---

## CURRENT ARCHITECTURE (CLAW)

```
Browser WebSocket
    ↓
educlaw-server
    ├─ Session 1: `unshare --mount --pid` → claw binary
    │              (PTY piped stdin/stdout)
    │              env: EDUCLAW_WORKSPACE=/overlay/merged
    │              env: CLAW_CONFIG_HOME=/overlay/home/student1/config
    │
    ├─ Session 2: `unshare --mount --pid` → claw binary
    │              (PTY piped stdin/stdout)
    │              env: EDUCLAW_WORKSPACE=/overlay/merged
    │              env: CLAW_CONFIG_HOME=/overlay/home/student2/config
    │
    └─ Session N: `unshare --mount --pid` → claw binary
```

**Communication**: OSC frames (ANSI escape sequences) → educlaw parses → sends to browser

---

## PROPOSED ARCHITECTURE (GOOSE)

```
Browser WebSocket
    ↓
educlaw-server
    ├─ Session 1: `unshare --mount --pid` → goose acp
    │              (SACP protocol on stdin/stdout)
    │              env: GOOSE_PATH_ROOT=/overlay/home/student1
    │              env: ANTHROPIC_API_KEY=...
    │
    ├─ Session 2: `unshare --mount --pid` → goose acp
    │              (SACP protocol on stdin/stdout)
    │              env: GOOSE_PATH_ROOT=/overlay/home/student2
    │              env: ANTHROPIC_API_KEY=...
    │
    └─ Session N: `unshare --mount --pid` → goose acp
```

**Communication**: JSON-RPC (SACP protocol) → educlaw routes → sends to browser



---

## GOOSE ISOLATION MECHANISM

**Environment Variable**: `GOOSE_PATH_ROOT`

When set, goose uses:
- `$GOOSE_PATH_ROOT/config/` for configuration
- `$GOOSE_PATH_ROOT/data/` for session data
- `$GOOSE_PATH_ROOT/state/` for internal state

**Without** this variable, goose defaults to `~/.local/share/goose/` (user home)

**Educlaw sets this to**:
```
GOOSE_PATH_ROOT=/overlay/home/student/{student_id}/
```

This ensures each student's goose instance reads/writes only to its own directory, even though they share the same binary.

---

## FEATURE NECESSITY FOR EDUCLAW

**See [GOOSE-STRUCTURE-ANALYSIS.md](GOOSE-STRUCTURE-ANALYSIS.md) for complete feature verification matrix**

This document provides:
- Feature necessity analysis (needs vs doesn't need)
- Binary size impact
- Feature gate combinations
- Module dependency verification
- Provider availability

Do NOT assume features are unnecessary - verify in the analysis document.

---

## GOOSE + EDUCLAW INTERACTION FLOW

```
1. Student connects to browser
   ↓
2. educlaw-server receives WebSocket connection
   ↓
3. educlaw-server spawns: unshare --mount --pid goose acp
   ├─ Sets GOOSE_PATH_ROOT=/overlay/home/student/{id}
   └─ Pipes stdin/stdout
   ↓
4. educlaw-server sends: NewSessionRequest (JSON-RPC)
   ├─ Includes system prompt via meta field
   ├─ Includes student context
   └─ Includes MCP servers to load
   ↓
5. goose responds: NewSessionResponse
   ├─ Session ID
   └─ Capabilities
   ↓
6. Student types message → educlaw-server sends PromptRequest
   ↓
7. goose streams: SessionNotification (per token/chunk)
   ├─ AgentMessageChunk(text)
   ├─ ToolCall(tool_info)
   ├─ ToolCallUpdate(result)
   └─ UsageUpdate(tokens)
   ↓
8. educlaw-server receives notifications → routes to WebSocket
   ↓
9. Browser receives updates → displays to student
```

---

## BUILD CONFIGURATION FOR EDUCLAW

**Final build configuration will be determined after feature verification**

Current draft template:
```toml
[dependencies]
goose = { 
    version = "0.X",
    default-features = false,
    features = ["rustls-tls", /* additional features TBD */]
}
```


## CODE CHANGES FOR EDUCLAW

**New files**:
- `educlaw-server/src/acp_bridge.rs` - Spawn and manage goose acp subprocess

**Modified files**:
- `educlaw-server/src/api/ws.rs` - Replace PTY communication with SACP
- `educlaw-server/src/session/namespace.rs` - Spawn goose instead of claw
- `educlaw-server/src/session/broker.rs` - Remove PTY-specific code

**Deleted files**:
- `educlaw-server/src/pty_bridge.rs` - No longer needed

**Expected changes**: ~500-700 lines of new code

---

## SUMMARY TABLE

| Aspect | Current (Claw) | Proposed (Goose) |
|--------|---|---|
| **Subprocess binary** | claw | goose acp |
| **Communication** | PTY + OSC frames (ANSI) | SACP protocol (JSON-RPC) |
| **Isolation** | `unshare --mount --pid` | `unshare --mount --pid` |
| **Config directory** | CLAW_CONFIG_HOME env var | GOOSE_PATH_ROOT env var |
| **Message parsing** | OSC frame extraction + ANSI stripping | Direct JSON deserialization |
| **Session state** | File-based (instructions.md, student.json) | ACP meta fields |
| **Tool permissions** | settings.json deny list | Permission manager in goose |
| **Binary size** | ~30MB | TBD (feature-dependent) |
| **Maintenance** | Educlaw-specific | Standard goose framework |

---

## KEY DIFFERENCES FOR OTHER AGENTS

**Understanding Goose**:
- Goose is modular and feature-gated (many features can be disabled/enabled)
- Goose is not a binary you modify - it's a crate you depend on
- `goose acp` is the command educlaw uses (not `goose serve` or `goose session`)
- Goose respects `GOOSE_PATH_ROOT` for multi-tenant isolation

**Understanding Educlaw Integration**:
- Educlaw is not embedding goose - it's spawning it as subprocess
- Each student gets separate goose process in isolated namespace
- Educlaw acts as ACP "client" (sends requests, receives notifications)
- Goose acts as ACP "server" (processes requests, sends notifications)
- Communication is pure JSON-RPC, no binary parsing needed

**Feature Analysis**:
- Feature necessity MUST be verified before deciding to disable/enable
- Examples: telemetry might track token usage, otel might provide observability for debugging
- See [GOOSE-STRUCTURE-ANALYSIS.md](GOOSE-STRUCTURE-ANALYSIS.md) for detailed feature verification
- All core LLM providers are included in base goose
- Feature flags are binary size + compile time optimization, not capability requirements
