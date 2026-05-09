# Admin API - Sessions

## Endpoints

### GET /admin/sessions
List live sessions with idle time.

**Headers:** `Authorization: Bearer <token>` (teacher/admin only)

**Response (200):**
```json
[
  {
    "id": "uuid",
    "student_id": "uuid",
    "state": "active",
    "namespace_pid": 12345,
    "idle_secs": 120,
    "started_at": "timestamp"
  }
]
```

---

### DELETE /admin/sessions/:id
Force-terminate a session.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Response:** 204 No Content

---

## Frontend Usage

```typescript
// List active sessions
const sessions = await api.adminListSessions(token);

// Terminate session
await api.adminTerminateSession(token, sessionId);
```