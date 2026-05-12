# EduCrawl Frontend Project Plan

## Version: 1.0
## Status: Planning Complete - Ready for Implementation

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Technology Stack](#technology-stack)
4. [Phase 1: Login Page (Current Focus)](#phase-1-login-page-current-focus)
5. [Phase 2: Chat Interface (Future)](#phase-2-chat-interface-future)
6. [Phase 3: Additional Features (Future)](#phase-3-additional-features-future)
7. [Project Structure](#project-structure)
8. [API Integration Details](#api-integration-details)
9. [Security Considerations](#security-considerations)
10. [Implementation Roadmap](#implementation-roadmap)

---

## 1. Executive Summary

This document outlines a comprehensive plan for building a new frontend application for EduCrawl using pi-web-ui components. The frontend will integrate with the existing `educlaw-server` Rust backend.

**Current Scope (Phase 1):**
- Login page with username/password authentication
- Integration with `/auth/login` endpoint
- Proper token storage and session management
- Use pi-web-ui/mini-lit components for UI

**Future Scope (Phases 2+):**
- Chat interface with WebSocket integration
- File management
- Admin panel
- Additional features as needed

---

## 2. Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     educlaw-frontend (NEW)                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │   Login    │  │   Session    │  │   Future: Chat     │   │
│  │   Page     │  │   Manager    │  │   File Manager     │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘   │
│         │               │                      │               │
│         └───────────────┼──────────────────────┘               │
│                         ▼                                       │
│              ┌────────────────────┐                            │
│              │   API Client       │                            │
│              │   (fetch/axios)    │                            │
│              └─────────┬──────────┘                            │
└─────────────────────────┼──────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     educlaw-server (EXISTING)                   │
│  ┌──────────┐  ┌─────────────┐  ┌──────────────┐              │
│  │  Auth    │  │  Sessions   │  │   WebSocket  │              │
│  │  /auth/* │  │ /sessions/* │  │  /sessions/* │              │
│  └──────────┘  └─────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Framework-Agnostic UI**: Using Lit web components from pi-web-ui
2. **Vite + Bun**: Modern build tooling with hot reload
3. **Modular Architecture**: Clear separation between UI, API, and state management
4. **TypeScript**: Full type safety throughout the application

---

## 3. Technology Stack

### Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `lit` | ^3.3.1 | Web Components framework |
| `@earendil-works/pi-web-ui` | ^0.74.0 | UI components (ChatPanel, AgentInterface, etc.) |
| `@earendil-works/pi-agent-core` | ^0.74.0 | Agent state management |
| `@earendil-works/pi-ai` | ^0.74.0 | LLM API abstraction |
| `@mariozechner/mini-lit` | ^0.2.0 | Base components + theming |
| `lucide` | ^0.544.0 | Icons |

### Build Tools

| Tool | Purpose |
|------|---------|
| `vite` | Build tool and dev server |
| `typescript` | Type safety |
| `tailwindcss` | Utility CSS (via Vite plugin) |

### Backend (Existing)

- **educlaw-server**: Rust/Axum HTTP server
- **Port**: Configurable (default 8080)
- **Protocol**: REST API + WebSocket

---

## 4. Phase 1: Login Page (Current Focus)

### 4.1 Login Flow

```
User Action                    Backend Call                   Response
────────────────────────────────────────────────────────────────────────
1. User enters credentials  →  POST /auth/login           →  JWT Token
2. Validate credentials      ←  { token, student_id,      ←  { role, cohort_id, ... }
                                 display_name, role, ... }
3. Store token              →  localStorage              →  Success
4. Redirect to dashboard    →  (client-side routing)    →  Chat/Session page
```

### 4.2 API Integration

**Endpoint**: `POST /auth/login`

```typescript
interface LoginRequest {
  username: string;
  password: string;
}

interface LoginResponse {
  token: string;        // JWT token (8 hour expiry)
  student_id: string;
  display_name: string;
  role: "student" | "teacher" | "admin";
  cohort_id: string;
  subject_ids: string[];
}
```

### 4.3 Token Management

- **Storage**: localStorage (or sessionStorage for enhanced security)
- **Token Key**: `educlaw_token`
- **User Info Key**: `educlaw_user`
- **Token Validation**: Check JWT expiry on app initialization
- **Token Refresh**: Not implemented in current phase (re-login required)

### 4.4 UI Components to Use

| Component | Source | Purpose |
|-----------|--------|---------|
| `Input` | mini-lit | Username/password fields |
| `Button` | mini-lit | Submit button |
| `Card` | mini-lit | Container styling |
| `Alert` | mini-lit | Error messages |
| `Switch` | mini-lit | Remember me (optional) |
| `Dialog` | mini-lit | Loading states |

### 4.5 Login Page Layout

```
┌────────────────────────────────────────┐
│           EduCrawl Login              │
├────────────────────────────────────────┤
│  ┌──────────────────────────────────┐  │
│  │  Username                        │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │  Password                        │  │
│  └──────────────────────────────────┘  │
│                                        │
│  [  Sign In  ]                        │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │  Error message (if any)          │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

---

## 5. Phase 2: Chat Interface (Future)

### 5.1 Session Creation Flow

```
1. Create Session  →  POST /sessions         →  { session_id, ws_url, token }
2. Connect WS      →  WS /sessions/:id/ws    →  Bidirectional communication
3. Send Message   →  WS: { type: "input", data: "..." }
4. Receive Response ←  WS: { type: "assistant_text", ... }
```

### 5.2 API Endpoints (Future)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sessions` | POST | Create new session |
| `/sessions/:id` | GET | Get session status |
| `/sessions/:id` | DELETE | Terminate session |
| `/sessions/:id/ws` | WebSocket | Real-time chat |
| `/sessions/:id/models` | GET | Get available models |
| `/sessions/:id/token-usage` | GET | Track token usage |

### 5.3 WebSocket Protocol

**Client → Server Messages:**
```typescript
{ type: "input", data: string }
{ type: "input", data: string, image: string, mime_type: string }
{ type: "resize", cols: number, rows: number }
{ type: "cancel" }
{ type: "getmodels" }
```

**Server → Client Messages:**
```typescript
{ type: "chat_start" }
{ type: "user_text", text: string }
{ type: "tool_start", name: string, input: string }
{ type: "tool_end", exit_code: number, stdout: string, stderr: string }
{ type: "assistant_text", text: string }
{ type: "chat_end" }
{ type: "token_usage", used: number, cost: {...} }
{ type: "model_changed", model: string }
{ type: "models", models: string[], active: string }
```

### 5.4 Pi-Web-UI Integration (Future)

The ChatPanel component from pi-web-ui provides:
- Full chat interface with message list
- Streaming message display
- Model selector
- Thinking mode selector
- Attachments support
- Artifacts panel

**Challenge**: ChatPanel expects an Agent object with `streamFn`, but EduCrawl uses WebSocket. Will need custom integration layer.

---

## 6. Phase 3: Additional Features (Future)

### 6.1 File Management

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/files/subject/:id/tree` | GET | List subject materials |
| `/files/subject/:id/read` | GET | Read subject file |
| `/files/student/:id/tree` | GET | List student workspace |
| `/files/student/:id/read` | GET | Read student file |
| `/files/student/:id/write` | PUT | Write student file |
| `/files/student/:id/delete` | DELETE | Delete student file |

### 6.2 Admin Panel

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/admin/students` | GET/POST | List/create students |
| `/admin/students/:id` | PUT/DELETE | Update/delete student |
| `/admin/sessions` | GET | List active sessions |
| `/admin/cohorts` | GET/POST | Manage cohorts |
| `/admin/subjects` | GET/POST | Manage subjects |
| `/admin/models` | GET/POST | Manage LLM models |

### 6.3 Token Management

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/admin/students/:id/token-limit` | PUT/DELETE | Set/clear token limits |
| `/admin/students/:id/topup` | POST | Add tokens |
| `/admin/students/:id/deduct` | POST | Remove tokens |
| `/admin/students/:id/token-balance` | GET | Get current balance |

---

## 7. Project Structure

```
educlaw-frontend/
├── src/
│   ├── index.html              # Entry point
│   ├── main.ts                # App initialization
│   ├── styles/
│   │   └── main.css           # Global styles + Tailwind
│   │
│   ├── core/
│   │   ├── api/
│   │   │   ├── client.ts      # API client (fetch wrapper)
│   │   │   ├── types.ts      # API response types
│   │   │   └── endpoints.ts  # Endpoint definitions
│   │   │
│   │   ├── auth/
│   │   │   ├── token.ts      # Token management
│   │   │   └── session.ts    # Session state
│   │   │
│   │   └── storage/
│   │       └── local.ts       # localStorage wrapper
│   │
│   ├── components/
│   │   ├── login/
│   │   │   ├── login-page.ts  # Main login component
│   │   │   └── login-form.ts  # Form component
│   │   │
│   │   └── common/
│   │       ├── page-container.ts
│   │       └── loading-spinner.ts
│   │
│   ├── pages/
│   │   ├── login.ts          # Login page route
│   │   └── dashboard.ts      # (Future) Dashboard
│   │
│   └── utils/
│       ├── validation.ts     # Form validation
│       └── format.ts         # Formatting utilities
│
├── public/
│   └── favicon.svg
│
├── package.json
├── tsconfig.json
├── vite.config.ts
└── SPEC.md                    # Feature specifications
```

---

## 8. API Integration Details

### 8.1 API Client Structure

```typescript
// src/core/api/client.ts

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('educlaw_token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('educlaw_token');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Auth endpoints
  async login(username: string, password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }
}

export const api = new ApiClient();
```

### 8.2 TypeScript Types

```typescript
// src/core/api/types.ts

export interface LoginResponse {
  token: string;
  student_id: string;
  display_name: string;
  role: 'student' | 'teacher' | 'admin';
  cohort_id: string;
  subject_ids: string[];
}

export interface Session {
  session_id: string;
  ws_url: string;
  token: string;
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: string;
  cohort_id: string;
}
```

---

## 9. Security Considerations

### 9.1 Token Security

- **Storage**: Use localStorage for simplicity; consider httpOnly cookies for enhanced security in production
- **Token Expiry**: JWT tokens expire after 8 hours; implement token refresh or re-authentication
- **Token Validation**: Check token validity on app initialization

### 9.2 Input Validation

- Sanitize user inputs before sending to backend
- Implement proper error handling for network failures
- Handle rate limiting gracefully

### 9.3 HTTPS

- In production, ensure all API calls use HTTPS
- Configure proper CORS settings on backend

---

## 10. Implementation Roadmap

### Phase 1: Login Page (Week 1-2)

| Day | Task |
|-----|------|
| 1-2 | Project setup: Initialize Vite + TypeScript + dependencies |
| 3-4 | Create API client and types |
| 5-6 | Build login UI with mini-lit components |
| 7-8 | Integrate `/auth/login` endpoint |
| 9-10 | Add error handling, loading states, token storage |
| 11-12 | Testing and polish |

### Phase 2: Session Management (Future)

- Create session via `/sessions` endpoint
- Implement WebSocket connection
- Build chat interface

### Phase 3: File Management (Future)

- File tree display
- File read/write operations
- Subject materials access

### Phase 4: Admin Panel (Future)

- Student management
- Cohort management
- Model configuration

---

## Appendix A: Mini-Lit Components Reference

### Available Components

| Component | File | Purpose |
|-----------|------|---------|
| Button | `dist/Button.js` | Action buttons |
| Input | `dist/Input.js` | Text input fields |
| Card | `dist/Card.js` | Container component |
| Dialog | `dist/Dialog.js` | Modal dialogs |
| Alert | `dist/Alert.js` | Notifications/errors |
| Badge | `dist/Badge.js` | Labels/tags |
| Select | `dist/Select.js` | Dropdown selection |
| Switch | `dist/Switch.js` | Toggle switches |
| Checkbox | `dist/Checkbox.js` | Checkbox inputs |
| Label | `dist/Label.js` | Form labels |
| Textarea | `dist/Textarea.js` | Multi-line text |
| Progress | `dist/Progress.js` | Progress indicator |
| Separator | `dist/Separator.js` | Visual divider |
| Sidebar | `dist/Sidebar.js` | Navigation sidebar |
| SplitPanel | `dist/SplitPanel.js` | Resizable panels |
| MarkdownBlock | `dist/MarkdownBlock.js` | Markdown rendering |
| ThemeToggle | `dist/ThemeToggle.js` | Light/dark mode |
| ModeToggle | `dist/ModeToggle.js` | Theme switching |
| CodeBlock | `dist/CodeBlock.js` | Code display |
| CopyButton | `dist/CopyButton.js` | Copy to clipboard |
| DownloadButton | `dist/DownloadButton.js` | File download |
| FileButton | `dist/FileButton.js` | File upload |
| PromptDialog | `dist/PromptDialog.js` | Prompt input dialog |
| Diff | `dist/Diff.js` | Diff display |

### Theming

| Theme | File | Description |
|-------|------|-------------|
| Default | `styles/themes/default.css` | Light theme (Claude-inspired) |
| Claude | `styles/themes/claude.css` | Dark theme |

CSS Variables (from `styles/themes/default.css`):
- `--color-background`
- `--color-foreground`
- `--color-primary`
- `--color-primary-foreground`
- `--color-secondary`
- `--color-muted`
- `--color-border`
- `--color-accent`
- `--color-destructive`
- etc.

---

## Appendix B: EduCrawl Server API Reference

### Authentication

| Endpoint | Method | Request | Response |
|----------|--------|---------|-----------|
| `/auth/login` | POST | `{ username, password }` | `{ token, student_id, display_name, role, cohort_id, subject_ids }` |
| `/auth/token` | POST | `{ secret }` | `{ token }` |

### Sessions

| Endpoint | Method | Request | Response |
|----------|--------|---------|-----------|
| `/sessions` | POST | `{ student_id, model? }` | `{ session_id, ws_url, token }` |
| `/sessions/:id` | GET | - | Session object |
| `/sessions/:id` | DELETE | - | - |
| `/sessions/:id/ws` | WebSocket | query: `token` | Bidirectional |

### Files

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/files/subject/:id/tree` | GET | Subject materials tree |
| `/files/subject/:id/read` | GET | Read subject file |
| `/files/student/:id/tree` | GET | Student workspace tree |
| `/files/student/:id/read` | GET | Read student file |
| `/files/student/:id/write` | PUT | Write student file |
| `/files/student/:id/delete` | DELETE | Delete student file |

### Admin

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/admin/students` | GET/POST | Student CRUD |
| `/admin/sessions` | GET | Active sessions |
| `/admin/cohorts` | GET/POST | Cohort management |
| `/admin/subjects` | GET/POST | Subject management |
| `/admin/models` | GET/POST | Model management |

---

## Document Version History

| Version | Date | Author | Changes |
|---------|------|---------|----------|
| 1.0 | 2026-05-10 | EduCrawl Team | Initial planning document |

---

*This document will be updated as implementation progresses.*