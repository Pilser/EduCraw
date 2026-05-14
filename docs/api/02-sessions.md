# Sessions API

## Endpoints

### POST /sessions
Create and initialize a student session.

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "student_id": "uuid",
  "model": "string (optional)"
}
```

**Response (201):**
```json
{
  "session_id": "uuid",
  "ws_url": "/sessions/{session_id}/ws",
  "token": "session_jwt_token"
}
```

---

### GET /sessions/:id
Get session status and details.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "id": "uuid",
  "student_id": "uuid",
  "state": "active | ended",
  "namespace_pid": "number | null",
  "overlay_mount": "string",
  "model": "string | null",
  "last_input_at": "number | null",
  "last_token_checkpoint": "number",
  "started_at": "timestamp",
  "ended_at": "string | null"
}
```

---

### DELETE /sessions/:id
Terminate session (sends SIGTERM + unmounts OverlayFS).

**Headers:** `Authorization: Bearer <token>`

**Response:** 204 No Content

---

### GET /sessions/:id/models
List models allowed for this session's student.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "models": [
    {
      "id": "uuid",
      "name": "string",
      "display_name": "string",
      "enabled": 1,
      "multiplier": 1.0,
      "provider": "string | null",
      "think_mode": "number | null",
      "visual_support": 1,
      "created_at": "timestamp"
    }
  ],
  "active": "string"
}
```

---

### PUT /sessions/:id/model
Switch active model mid-session.

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "model": "string",
  "thinking_params": {
    "thinking_type": "enabled",
    "budget_tokens": 8000
  }
}
```

`thinking_params` is optional. When provided, it overrides the model's default
thinking configuration for this session only.

**Response:** 204 No Content

---

### GET /sessions/:id/token-usage
Get cumulative token usage for the session.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "total_tokens_used": 1000,
  "total_input_tokens": 500,
  "total_output_tokens": 500,
  "total_cache_creation_tokens": 0,
  "total_cache_read_tokens": 0,
  "turn_count": 5
}
```

---

### POST /sessions/:id/broadcast
Push a message to a session's PTY (teacher/admin only).

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "message": "string",
  "all": false
}
```

**Response:** 204 No Content

---

## Thread Endpoints

Thread operations moved from WebSocket to REST. These replace `list_sessions`, `fork_session`, `export_session`, and `import_session` WS messages.

### GET /sessions/:id/threads
List all threads (conversations) for this session.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
[
  {
    "id": "string",
    "title": "string | null",
    "updated_at": "string | null",
    "cwd": "string",
    "metadata": {
      "messageCount": 42
    }
  }
]
```

---

### POST /sessions/:id/threads/new
Create a new empty thread for this session (no history).

**Headers:** `Authorization: Bearer <token>`

**Response (201):**
```json
{
  "thread_id": "string"
}
```

---

### POST /sessions/:id/threads/:thread_id/fork
Fork an existing thread into a new session with copied message history.

**Headers:** `Authorization: Bearer <token>`

**Response (201):**
```json
{
  "new_session_id": "string"
}
```

---

### GET /sessions/:id/threads/:thread_id/export
Export a thread as a JSON string.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "data": "<full-session-json-string>"
}
```

---

### POST /sessions/:id/threads/import
Import a thread from a JSON string.

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "data": "<full-session-json-string>"
}
```

**Response (201):**
```json
{
  "session_id": "string",
  "title": "string | null",
  "message_count": 42
}
```

---

## Frontend Usage

```typescript
// Create session
const session = await api.createSession(studentId, token);
// session: { session_id, ws_url, token }

// End session
await api.endSession(sessionId, token);

// Get session models
const models = await api.getSessionModels(sessionId, token);
// models: { models: [...], active: "string" }

// Set active model
await api.setSessionModel(sessionId, token, "model-name");

// Set active model with thinking overrides
await api.setSessionModel(sessionId, token, "model-name", {
  thinking_type: "enabled",
  budget_tokens: 8000,
});

// Get token usage
const usage = await api.getSessionTokenUsage(sessionId, token);
// usage: { total_tokens_used, total_input_tokens, ... }

// List threads
const threads = await api.listThreads(sessionId, token);
// threads: { id, title, updated_at, cwd, metadata }[]

// Fork thread
const { new_session_id } = await api.forkThread(sessionId, threadId, token);

// Export thread (downloads JSON file)
const { data } = await api.exportThread(sessionId, threadId, token);

// Import thread
const result = await api.importThread(sessionId, jsonData, token);
// result: { session_id, title, message_count }

// Create new empty thread
const { thread_id } = await api.createThread(sessionId, token);
```