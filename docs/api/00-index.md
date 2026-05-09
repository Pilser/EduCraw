# EduCrawl API Documentation

## Overview

This documentation covers all backend API endpoints exposed by `educlaw-server` and their corresponding frontend client methods in `educlaw-web`.

## Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/login` | POST | Student login with username/password |
| `/auth/token` | POST | Dev/admin bootstrap token |

**File:** [01-authentication.md](01-authentication.md)

---

## Sessions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sessions` | POST | Create and initialize a student session |
| `/sessions/:id` | GET | Get session status |
| `/sessions/:id` | DELETE | Terminate session |
| `/sessions/:id/models` | GET | List allowed models for session |
| `/sessions/:id/model` | PUT | Switch active model |
| `/sessions/:id/token-usage` | GET | Get token usage |
| `/sessions/:id/broadcast` | POST | Push message to PTY |

**File:** [02-sessions.md](02-sessions.md)

---

## Files

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/files/subject/:id/tree` | GET | List subject materials tree |
| `/files/subject/:id/read` | GET | Read subject file |
| `/files/student/:id/tree` | GET | List student workspace tree |
| `/files/student/:id/read` | GET | Read student file |
| `/files/student/:id/write` | PUT | Write student file |
| `/files/student/:id/delete` | DELETE | Delete student file |

**File:** [03-files.md](03-files.md)

---

## WebSocket

| Endpoint | Description |
|----------|-------------|
| `/sessions/:id/ws` | Real-time bidirectional communication |

**File:** [04-websocket.md](04-websocket.md)

---

## Admin - Students

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/students` | GET | List all students |
| `/admin/students` | POST | Create student |
| `/admin/students/:id` | PUT | Update student |
| `/admin/students/:id` | DELETE | Delete student |
| `/admin/students/:id/token-limit` | PUT | Set token limit |
| `/admin/students/:id/token-limit` | DELETE | Clear token block |
| `/admin/students/:id/token-usage` | GET | Get token usage |
| `/admin/students/:id/token-balance` | GET | Get token balance |
| `/admin/students/:id/topup` | POST | Add tokens |
| `/admin/students/:id/deduct` | POST | Remove tokens |
| `/admin/students/:id/token-deductions` | GET | Get deduction history |
| `/admin/students/:id/models` | GET | Get assigned models |
| `/admin/students/:id/models` | PUT | Set assigned models |

**File:** [05-admin-students.md](05-admin-students.md)

---

## Admin - Sessions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/sessions` | GET | List active sessions |
| `/admin/sessions/:id` | DELETE | Force-terminate session |

**File:** [06-admin-sessions.md](06-admin-sessions.md)

---

## Admin - Cohorts

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/cohorts` | GET | List cohorts |
| `/admin/cohorts` | POST | Create cohort |
| `/admin/cohorts/:id` | PUT | Update cohort |
| `/admin/cohorts/:id` | DELETE | Delete cohort |

**File:** [07-admin-cohorts.md](07-admin-cohorts.md)

---

## Admin - Subjects

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/subjects` | GET | List subjects |
| `/admin/subjects` | POST | Create subject |
| `/admin/subjects/:id` | PUT | Update subject |
| `/admin/subjects/:id` | DELETE | Delete subject |

**File:** [08-admin-subjects.md](08-admin-subjects.md)

---

## Admin - Assignments

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/assignments` | GET | List assignments |
| `/admin/assignments` | POST | Create assignment |

**File:** [09-admin-assignments.md](09-admin-assignments.md)

---

## Admin - Models

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/models` | GET | List models |
| `/admin/models` | POST | Create model |
| `/admin/models/:id` | PUT | Enable/disable model |
| `/admin/models/:id/specs` | PUT | Update model specs |
| `/admin/models/:id` | DELETE | Delete model |
| `/admin/models/:name/multiplier` | PUT | Set multiplier |
| `/models` | GET | List enabled models (public) |

**File:** [10-admin-models.md](10-admin-models.md)

---

## Session Import/Export

| Feature | Status | Description |
|---------|--------|-------------|
| Export Session | Done (Backend), Todo (Frontend) | Export goose session as JSON |
| Import Session | Done (Backend), Todo (Frontend) | Import session from JSON |

**File:** [11-session-import-export.md](11-session-import-export.md)

---

## Common Types

### FileNode
```typescript
interface FileNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
  children?: FileNode[];
}
```

### LoginResponse
```typescript
interface LoginResponse {
  token: string;
  student_id: string;
  display_name: string;
  role: string;
  cohort_id: string;
  subject_ids: string[];
}
```

### Session
```typescript
interface Session {
  session_id: string;
  token: string;
}
```

### Model
```typescript
interface Model {
  id: string;
  name: string;
  display_name: string;
  enabled: number;
  multiplier: number;
  provider?: string | null;
  think_mode?: number | null;
  visual_support: number;
  created_at: string;
}
```

---

## Auth Requirements

| Role | Access |
|------|--------|
| `student` | Own session, own files, own token balance |
| `teacher` | All students, all sessions, all read operations |
| `admin` | Full access including create/update/delete |

All authenticated endpoints require `Authorization: Bearer <jwt_token>` header.

---

## JWT Claims

The JWT token contains:
```json
{
  "sub": "student_id",
  "role": "student | teacher | admin",
  "cohort_id": "string",
  "subject_ids": ["string"],
  "session_id": "string (session-scoped tokens only)"
}
```