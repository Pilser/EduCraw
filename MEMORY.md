# Session Expiration Handling Task - Memory

## Current Understanding

### File: chat-page.ts
Location: `EduCraw/lit-ui/src/pages/chat-page.ts`

### What needs to be done:
1. **firstUpdated() method** - Add error handling to detect 401/403 errors and dispatch "session-expired" event
2. **initChat() method** - Wrap API calls with try-catch for 401/403 error detection
3. **loadMostRecentSession() method** - Add error handling for WebSocket close/error events

### Key Requirements:
- Event format: `new CustomEvent("session-expired", { bubbles: true, composed: true })`
- Should log when session expires
- Should detect: 401/403 HTTP responses and "Unauthorized" messages
- Event bubbles up to main.ts where logout is triggered

### Current Code Structure:
- `firstUpdated()`: Initializes chat, handles errors but doesn't check for auth errors specifically
- `initChat()`: Makes API call to `eduApi.getSessionModels()` with minimal error handling
- `loadMostRecentSession()`: Opens WebSocket, has some error handling but doesn't detect auth expiration
- Has a `handleLogout()` method that already dispatches a "logout" event

### Implementation Plan:
1. Create a helper method to detect if an error is auth-related (401/403)
2. Create a helper method to dispatch session-expired event
3. Update firstUpdated() to catch auth errors
4. Update initChat() to wrap in try-catch for auth errors
5. Update loadMostRecentSession() for WebSocket error handling

### Issue Encountered:
File got corrupted during editing. Now rebuilding from scratch using the original content structure that was successfully read earlier.

### COMPLETION DETAILS:
✅ Successfully modified chat-page.ts with session expiration handling:

1. **Added two helper methods:**
   - `isAuthError(err: any): boolean` - Detects 401/403 HTTP errors and "Unauthorized" messages
   - `dispatchSessionExpired()` - Dispatches the session-expired CustomEvent that bubbles to main.ts

2. **Enhanced firstUpdated() method (lines 79-100):**
   - Wraps entire initialization in try-catch
   - Checks if error is auth-related using isAuthError()
   - Dispatches session-expired event if 401/403
   - Prevents error display and returns early

3. **Enhanced initChat() method (lines 125-180):**
   - Wrapped eduApi.getSessionModels() call in try-catch
   - Detects auth errors and re-throws them
   - Detects auth errors in setSessionModel() callback and dispatches session-expired

4. **Enhanced loadMostRecentSession() method (lines 430-480):**
   - Error frame handler (case "error") checks for auth-related error messages
   - Detects "Unauthorized", "401", "403" strings in error messages
   - Dispatches session-expired event when auth error detected
   - Enhanced ws.onclose handler to log WebSocket close codes
   - Enhanced ws.onerror handler with clarifying comments

✅ All changes follow the requirements:
- Events dispatch with: `new CustomEvent("session-expired", { bubbles: true, composed: true })`
- Logs "Session expired - dispatching session-expired event" when fired
- Detects 401/403 responses and "Unauthorized" messages
- No TypeScript errors or warnings
