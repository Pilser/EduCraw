# Goose ACP Reference for EduClaw

## SACP Protocol (Automatic - No Coding Required)

When we send `PromptRequest`, goose responds with `SessionNotification` variants:
- `MessageStart` — turn begins (received first)
- `MessageDelta` — token streaming (repeat many times)
- `MessageEnd` — turn ends (turn completion)
- `ToolUseStart`, `ToolUseEnd` — tool execution
- `Error` — errors

## System Prompt Strategy: Goose Has Two-Tier System (Like Claw)

**Default**: System prompt **compiled into binary** → embedded in `/usr/lib/goose/Goose`

**Override**: Write to disk at `$GOOSE_PATH_ROOT/config/prompts/system.md` (takes precedence)

For EduClaw:
1. Write tutor-specific system prompt to `$GOOSE_PATH_ROOT/config/prompts/system.md` before spawning
2. Write student context to `$GOOSE_PATH_ROOT/.claw/instructions.md` (same as claw)
3. Goose loads system.md from disk (override) or binary (fallback)

```rust
// Pseudo-code
pub async fn spawn_goose_session(student_id: &str, system_prompt: &str, student_json: &str) {
    // 1. Create session dirs (OverlayFS merge)
    let dirs = SessionDirs::new(...);  // upper, lower, merged
    
    // 2. Write system prompt to disk (overrides binary version)
    fs::create_dir_all(dirs.upper.join("config/prompts"))?;
    fs::write(dirs.upper.join("config/prompts/system.md"), system_prompt)?;
    
    // 3. Write student context (optional, for session context)
    fs::write(dirs.upper.join(".claw/instructions.md"), student_json)?;
    
    // 4. Set env var pointing to this session's config
    env::set_var("GOOSE_PATH_ROOT", dirs.upper);
    
    // 5. Spawn goose
    let child = spawn_subprocess([
        "unshare", "--mount", "--pid", "--fork",
        "goose", "acp"
    ])?;
    
    // 6. Send NewSessionRequest
    // 7. Send first PromptRequest
}
```

## Essential SACP Calls

| Call | When | What to send |
|---|---|---|
| `NewSessionRequest` | Once at start | `{ id, name?, config? }` |
| `PromptRequest` | Per user message | `{ user_message, model?, ...}` |
| `DeleteSessionRequest` | At end | `{ id }` |

*Skip* `UpdateWorkingDirRequest` and `_goose/tools` unless needed.

## Environment Variables

```bash
GOOSE_PATH_ROOT=/overlay/home/student/{id}
# Goose will auto-read from:
#   - $GOOSE_PATH_ROOT/config/  (settings)
#   - $GOOSE_PATH_ROOT/data/    (history)
#   - $GOOSE_PATH_ROOT/.claw/instructions.md  (our instructions file)
```
