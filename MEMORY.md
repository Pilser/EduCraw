# Session Import/Export Task

## Goal
Wire backend session import/export to frontend via WebSocket

## Backend Status: DONE
- Message types: `export_session`, `import_session`, `export_session_result`, `import_session_result`
- Handler functions: `handle_export_session()`, `handle_import_session()`
- Location: `educlaw-server/src/acp_bridge/`

## Frontend Status: DONE

### useWebSocket.ts changes:
- Added `onExportSessionResult?: (data: string) => void` to Options
- Added `onImportSessionResult?: (result: {...}) => void` to Options
- Added `sendExportSession` function
- Added `sendImportSession` function
- Added case handlers for `export_session_result` and `import_session_result`
- Added return values for new functions

### SessionPage.tsx changes:
- Added `handleExportSessionResult` - downloads JSON file on export
- Added `handleImportSessionResult` - logs import result
- Added `sendExportSession` and `sendImportSession` from useWebSocket hook
- Added Download button (icon) in header - triggers export
- Added Upload button (icon) in header - file picker for import
- Imported `Download` and `Upload` icons from lucide-react

## Verification
- TypeScript compiles without errors ✓