# Session Import/Export API

## Status: IMPLEMENTED IN BACKEND, MISSING IN FRONTEND

The backend already has full support for session import/export via WebSocket. The frontend needs to be wired to use these features.

---

## Backend Implementation (DONE)

### WebSocket Messages

**Frontend → Backend:**

```typescript
// Export session
{ "type": "export_session", "session_id": "<goose-session-id>" }

// Import session  
{ "type": "import_session", "data": "<full-session-json-string>" }
```

**Backend → Frontend:**

```typescript
// Export result
{
  "type": "export_session_result",
  "data": "<full-session-json-string>"
}

// Import result
{
  "type": "import_session_result",
  "session_id": "<new-session-id>",
  "title": "Session Title",
  "updated_at": "2026-05-09T10:00:00Z",
  "message_count": 42
}

// Error
{
  "type": "error",
  "message": "Failed to export session: ..."
}
```

### Backend Files
- `educlaw-server/src/acp_bridge/custom_requests.rs` - ACP request/response types
- `educlaw-server/src/acp_bridge/commands.rs` - `handle_export_session()`, `handle_import_session()`
- `educlaw-server/src/acp_bridge/messages.rs` - ClientMessage enum with ExportSession/ImportSession
- `educlaw-server/src/acp_bridge/session.rs` - Message handlers (lines 737-797)

---

## Frontend Implementation (TODO)

### 1. Add send methods to useWebSocket.ts

In `/home/pilser/AA-Projects/EduCraw/educlaw-web/src/hooks/useWebSocket.ts`:

Add these callbacks to the Options interface:
```typescript
onExportSessionResult?: (data: string) => void
onImportSessionResult?: (result: { session_id: string; title?: string; updated_at?: string; message_count: number }) => void
```

Add these send functions:
```typescript
const sendExportSession = useCallback((sessionId: string) => {
  send({ type: 'export_session', session_id: sessionId })
}, [send])

const sendImportSession = useCallback((data: string) => {
  send({ type: 'import_session', data })
}, [send])
```

Add case handlers in the message parser (around line 200):
```typescript
case 'export_session_result':
  callbacksRef.onExportSessionResult?.((frame as any).data)
  break
case 'import_session_result':
  callbacksRef.onImportSessionResult?.({
    session_id: (frame as any).session_id,
    title: (frame as any).title,
    updated_at: (frame as any).updated_at,
    message_count: (frame as any).message_count,
  })
  break
```

Return the new functions from the hook.

---

### 2. Add UI components

Create UI for:
- **Export button**: Trigger export, download JSON file
- **Import button**: File picker, read JSON, trigger import

Example UI flow:
1. User clicks "Export Session" → sends `export_session` message
2. Backend returns `export_session_result` with JSON data
3. Frontend triggers browser file download with the JSON
4. User clicks "Import Session" → file picker opens
5. User selects JSON file → reads content → sends `import_session` message
6. Backend returns `import_session_result` - session is now active

---

### 3. Add to API client (optional - if using REST)

In `/home/pilser/AA-Projects/EduCraw/educlaw-web/src/api/client.ts`:

```typescript
// If you want REST endpoints instead of WebSocket:
async exportSession(sessionId: string, token: string): Promise<{ data: string }> {
  // Could add HTTP endpoint if WebSocket isn't preferred
}
```

---

## Usage Example

```typescript
const {
  status,
  sendInput,
  sendExportSession,
  sendImportSession,
  onExportSessionResult,
  onImportSessionResult
} = useWebSocket({
  sessionId,
  token,
  onPtyData,
  onExportSessionResult: (data) => {
    // Download the exported JSON
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  onImportSessionResult: (result) => {
    console.log('Imported session:', result.session_id);
    // Optionally reload or switch to imported session
  },
});

// Export
sendExportSession('goose-thread-id');

// Import
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.json';
fileInput.onchange = async (e) => {
  const file = e.target.files[0];
  const text = await file.text();
  sendImportSession(text);
};
fileInput.click();
```

---

## Docs to Update

Once implemented, add to `04-websocket.md`:
- `export_session` / `export_session_result`
- `import_session` / `import_session_result`