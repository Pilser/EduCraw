# WebSocket API

## Endpoint

```
GET /sessions/:session_id/ws?token=<jwt_token>
```

**Protocol:** WebSocket (ws:// or wss:// depending on HTTP scheme)

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

### Resize terminal
```json
{ "type": "resize", "cols": 80, "rows": 24 }
```

### Cancel current operation
```json
{ "type": "cancel" }
```

### Get available models
```json
{ "type": "getmodels" }
```

### Load previous session
```json
{ "type": "load_session", "thread_id": "session-id" }
```

### Fork current session
```json
{ "type": "fork_session", "thread_id": "session-id" }
```

### List all sessions
```json
{ "type": "list_sessions" }
```

### Export session
```json
{ "type": "export_session", "session_id": "goose-session-id" }
```

### Import session
```json
{ "type": "import_session", "data": "<full-session-json-string>" }
```

---

## Server Messages (Backend → Frontend)

### PTY output (binary)
Raw terminal output - rendered directly to terminal emulator.

### Image display
```json
{
  "type": "show_image",
  "payload": {
    "path": "string",
    "data_url": "data:image/png;base64,..."
  }
}
```

### Chat start
```json
{ "type": "chat_start" }
```

### User text
```json
{ "type": "user_text", "text": "string" }
```

### Tool start
```json
{ "type": "tool_start", "name": "string", "input": "string" }
```

### Tool end
```json
{
  "type": "tool_end",
  "exit_code": 0,
  "stdout": "string",
  "stderr": "string"
}
```

### Assistant text (streaming)
```json
{ "type": "assistant_text", "text": "string" }
```

### Chat end
```json
{ "type": "chat_end" }
```

### Token usage (new format)
```json
{
  "type": "token_usage",
  "used": 1000,
  "size": 200000,
  "cost": { "amount": 0.001, "currency": "USD" }
}
```

### Token usage (old format)
```json
{
  "type": "token_usage",
  "model": "string",
  "input_tokens": 500,
  "output_tokens": 500,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 0
}
```

### Token limit reached
```json
{
  "type": "token_limit_reached",
  "banner": "Token limit reached. Please contact your administrator."
}
```

### Model changed
```json
{ "type": "model_changed", "model": "string" }
```

### Models list
```json
{
  "type": "models",
  "models": ["model1", "model2"],
  "active": "model1"
}
```

### Sessions list
```json
{
  "type": "sessions_list",
  "sessions": [
    { "id": "string", "title": "string", "created_at": "string" }
  ]
}
```

### Forked session
```json
{
  "type": "forked_session",
  "new_session_id": "uuid"
}
```

### Load session complete
```json
{
  "type": "load_session_complete",
  "thread_id": "string"
}
```

### Export session result
```json
{
  "type": "export_session_result",
  "data": "<full-session-json-string>"
}
```

### Import session result
```json
{
  "type": "import_session_result",
  "session_id": "new-session-id",
  "title": "Session Title",
  "updated_at": "2026-05-09T10:00:00Z",
  "message_count": 42
}
```

### Error
```json
{
  "type": "error",
  "message": "Failed to export session: ..."
}
```

---

## Frontend Usage

```typescript
// Connect (from useWebSocket.ts)
const ws = new WebSocket(
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/sessions/${sessionId}/ws?token=${encodeURIComponent(token)}`
);

ws.binaryType = 'arraybuffer';

// Handle messages
ws.onmessage = (e) => {
  if (e.data instanceof ArrayBuffer) {
    // PTY data - decode and render
    const raw = new Uint8Array(e.data);
    const text = new TextDecoder().decode(raw);
    // Check for OSC 99 envelope
    const oscMatch = text.match(/\x1b\]99;(.+?)\x07/);
    if (oscMatch) {
      const envelope = JSON.parse(oscMatch[1]);
      if (envelope.type === 'show_image') {
        // Handle image
      }
    }
  } else {
    const frame = JSON.parse(e.data);
    switch (frame.type) {
      case 'chat_start':
        // ...
      case 'assistant_text':
        // ...
      // etc.
    }
  }
};

// Send messages
ws.send(JSON.stringify({ type: 'input', data: 'Hello' }));
ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));

// Export session - triggers download of JSON file
ws.send(JSON.stringify({ type: 'export_session', session_id: 'goose-session-id' }));

// Import session - uploads JSON file to create new session
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.json';
fileInput.onchange = async (e) => {
  const file = e.target.files[0];
  const text = await file.text();
  ws.send(JSON.stringify({ type: 'import_session', data: text }));
};
fileInput.click();
```