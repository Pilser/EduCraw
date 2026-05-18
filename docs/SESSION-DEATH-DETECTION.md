# Session Death Detection & Recovery

## Problem

When the watchdog terminates a session (state="ended"), ANY API call returns `400` with:

```json
{"error":"session {id} is not active (state: ended)"}
```

This error can arrive from **any** endpoint at **any** time — not just at startup:

| Trigger | Endpoint | Caller |
|---------|----------|--------|
| User clicks "Continue Recent" | `GET /sessions/:id/threads` | `loadMostRecentSession()` in chat-page |
| User opens Sessions tab | `GET /sessions/:id/threads` | `loadSessionList()` in SessionsTab |
| User sends a message | `POST /sessions/:id/input` | `handleSend()` in chat-page |
| User forks a thread | `POST /sessions/:id/threads/:tid/fork` | SessionsTab |
| User creates new thread | `POST /sessions/:id/threads/new` | `newSession()` in chat-page |
| User reads files | `GET /files/student/:id/...` | FileDrawer |

Scattering `isSessionDead()` checks in every caller is fragile and unmaintainable.

## Solution: Centralized `SessionDeathWatcher`

A single watcher in `edu-api.ts` intercepts ALL API errors, detects session-death patterns, and fires a `session-dead` DOM event. The chat-page listens once and triggers recovery.

### Architecture

```
Any API call (listThreads, sendInput, getModels, readFile, ...)
  ↓
edu-api.ts request() / sseStream()
  ↓
Detects session-death pattern in error response
  ↓
window.dispatchEvent(new CustomEvent("session-dead", { detail: { error } }))
  ↓
chat-page.ts @session-dead listener
  ↓
handleSessionRefresh() → new session → update in-place
```

### Pattern to detect

All these mean the session is dead:
```
404 + "not found"
400 + "not active (state: ended)"
400 + "not active (state: terminated)"
```

### Files

| File | Role |
|------|------|
| `lit-ui/src/core/edu-api.ts` | `request()` and `sseStream()` detect session-death and dispatch `session-dead` event |
| `lit-ui/src/pages/chat-page.ts` | Listens for `session-dead`, calls `handleSessionRefresh()`, guards against double-refresh |
| `lit-ui/src/components/SessionsTab.ts` | Catches errors from `listThreads()` — handled by global event (no local check needed) |
| `educlaw-server/src/api/sessions.rs` | `get_session_models` returns 400 for non-active sessions |

### Guard against double-refresh

When a session is dead, MULTIPLE API calls may fail simultaneously (e.g., listThreads + getModels both return 400 in the same render cycle). The watcher must:

1. Fire the DOM event on the FIRST death detection
2. Ignore subsequent deaths for the same session
3. Reset the guard after recovery succeeds

Implementation: a `_isRefreshing` boolean in chat-page that's set to `true` before recovery and cleared after.

## Gotchas & browser resilience

### Window vs element event target
The `session-dead` event is dispatched on `window.dispatchEvent()`. The listener MUST be on `window`, not on the Lit element (`this`). CustomEvents on `window` do not bubble into the DOM tree. The handler is registered in `firstUpdated()` and cleaned up in `disconnectedCallback()`.

### handleSend() retry with dead session
When a session is dead, `POST /sessions/:id/input` returns `400` BEFORE the SSE stream starts. No `session_terminated` SSE event is emitted. The retry trigger:
- After the SSE loop: if `receivedAnyFrame === false` → session is dead → `needsRetry = true`
- In the catch block: if no frame received and error matches `isSessionDead()` → same retry
- Then the existing `needsRetry` code path at the end of `handleSend()` calls `handleSessionRefresh()` + retries the send

### Browser background tab suspension
When a tab is backgrounded for long periods, browsers may throttle timers but do NOT disable event listeners or `fetch`. When the user returns:
- The `fetch` call fails with 400 synchronously
- `request()`/`sseStream()` synchronously calls `dispatchSessionDead()`
- `window.session-dead` fires and `onSessionDead()` runs immediately
- Session is refreshed before the user sees any error UI
