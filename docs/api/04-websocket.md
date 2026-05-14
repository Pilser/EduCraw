# WebSocket API

## Endpoint

```
GET /sessions/:session_id/ws?token=<jwt_token>
```

**Protocol:** WebSocket (ws:// or wss:// depending on HTTP scheme)

The WebSocket handles real-time AI chat streaming, session replay, and auxiliary
notifications that flow through the ACP pipeline. Session management operations
(list, fork, export, import, get models) were moved to REST — see [02-sessions.md](02-sessions.md).

---

## Client Messages (Frontend → Backend)

### Send user input
```json
{ "type": "input", "data": "user message" }
```

### Send input with image
```json
{
  "type": "input",
  "data": "user message",
  "image": "data:image/png;base64,...",
  "mime_type": "image/png"
}
```

### Cancel current operation
```json
{ "type": "cancel" }
```

### Load previous session (replay)
```json
{ "type": "load_session", "thread_id": "session-id" }
```

### Terminal resize (no-op for ACP)
```json
{ "type": "resize", "cols": 80, "rows": 24 }
```

> **Note:** `getmodels`, `list_sessions`, `fork_session`, `export_session`, and
> `import_session` were moved to REST endpoints. See
> [02-sessions.md](02-sessions.md).

---

## Server Messages (Backend → Frontend)

### Streaming & replay (from ACP notifications)

#### Chat start
```json
{ "type": "chat_start" }
```

#### User text (during replay)
```json
{ "type": "user_text", "text": "string" }
```

#### Assistant text (streaming + replay)
```json
{ "type": "assistant_text", "text": "string" }
```

#### Thinking
```json
{ "type": "thinking", "thinking": "string" }
```

#### Tool start
```json
{ "type": "tool_start", "name": "string", "input": "string" }
```

#### Tool end
```json
{
  "type": "tool_end",
  "status": "completed | failed",
  "exit_code": 0,
  "stdout": "string",
  "stderr": "string"
}
```

#### Chat end
```json
{ "type": "chat_end" }
```

#### Chat error
```json
{
  "type": "chat_error",
  "error": "string"
}
```

### Token & session metadata

#### Token usage
```json
{
  "type": "token_usage",
  "used": 1000,
  "size": 200000,
  "cache_read_tokens": 0,
  "cache_write_tokens": 0,
  "cost": { "amount": 0.001, "currency": "USD" }
}
```

#### Token limit reached
```json
{
  "type": "token_limit_reached",
  "banner": "Token limit reached. Please contact your administrator."
}
```

#### Model changed
```json
{ "type": "model_changed", "model": "string" }
```

#### Session created
```json
{ "type": "session_created", "session_id": "string" }
```

#### Session info update
```json
{
  "type": "session_info_update",
  "title": "string | null",
  "updated_at": "string | null"
}
```

#### Load session complete
```json
{
  "type": "load_session_complete",
  "thread_id": "string"
}
```

### Planning & modes

#### Plan update
```json
{
  "type": "plan_update",
  "entries": [
    {
      "content": "string",
      "priority": "string",
      "status": "string"
    }
  ],
  "stats": {
    "total": 3,
    "completed": 1,
    "in_progress": 1,
    "pending": 1,
    "progress_percent": 33
  }
}
```

#### Mode update
```json
{ "type": "mode_update", "current_mode_id": "string" }
```

### Configuration

#### Config update
```json
{
  "type": "config_update",
  "config_options": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "category": "string"
    }
  ]
}
```

#### Available commands
```json
{
  "type": "available_commands",
  "commands": [
    { "name": "string", "description": "string" }
  ],
  "count": 5
}
```

### Error
```json
{
  "type": "error",
  "message": "Error description"
}
```

---

## Frontend Usage

```typescript
// Connect
const ws = new WebSocket(
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/sessions/${sessionId}/ws?token=${encodeURIComponent(token)}`
);

ws.binaryType = 'arraybuffer';

// Handle messages
ws.onmessage = (e) => {
  if (e.data instanceof ArrayBuffer) {
    const raw = new Uint8Array(e.data);
    const text = new TextDecoder().decode(raw);
    // Check for OSC 99 envelope (images)
    const oscMatch = text.match(/\x1b\]99;(.+?)\x07/);
    if (oscMatch) {
      const envelope = JSON.parse(oscMatch[1]);
      if (envelope.type === 'show_image') { /* Handle image */ }
    }
  } else {
    const frame = JSON.parse(e.data);
    switch (frame.type) {
      case 'chat_start':
      case 'assistant_text':
      case 'user_text':
      case 'thinking':
      case 'tool_start':
      case 'tool_end':
      case 'chat_end':
      case 'chat_error':
      case 'token_usage':
      case 'model_changed':
      case 'session_created':
      case 'load_session_complete':
      case 'plan_update':
      case 'mode_update':
      case 'session_info_update':
      case 'config_update':
      case 'available_commands':
      case 'token_limit_reached':
      case 'error':
        // handle frame
        break;
    }
  }
};

// Send messages
ws.send(JSON.stringify({ type: 'input', data: 'Hello' }));
ws.send(JSON.stringify({ type: 'cancel' }));
ws.send(JSON.stringify({ type: 'load_session', thread_id: 'session-id' }));
```

For session management (list, fork, export, import, get models), use the REST
endpoints documented in [02-sessions.md](02-sessions.md).
