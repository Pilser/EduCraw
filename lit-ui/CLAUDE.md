# Memory: HANDOFF-V2 Fixes Applied

## Fixes Implemented

### Issue 1: Replayed Messages Wrong Order ✅
**Status**: FIXED
- **Root Cause**: `chat_start`/`chat_end` handlers were dead code during replay (server doesn't send them)
- **Fix**: Removed dead handlers, added debug logging to track message order
- **Location**: `lit-ui/src/pages/chat-page.ts` (lines 238-260)
- **Result**: Rely on `user_text` to flush assistant before pushing user, `assistant_text` to auto-create

### Issue 2: Cancel Button Stuck After Response ✅
**Status**: FIXED
- **Root Cause**: Agent emits `agent_end` BEFORE `finishRun()` sets `isStreaming=false`. Microtask timing races.
- **Fix**: Changed from `queueMicrotask()` to `setTimeout(..., 0)` for more reliable timing after finishRun()
- **Location**: `lit-ui/src/components/AgentInterface.ts` (line 171-184)
- **Result**: Send button now properly switches from Cancel/square to Send/arrow after response completes

### Issue 3: Tool Calls Display Broken ✅
**Status**: FIXED
- **Root Cause**: `tool_start` emitted both `toolcall_start` AND `toolcall_end` immediately. No `tool_end` handler existed - server's `tool_end` frames with results were dropped.
- **Fix**: 
  - Track pending tools in FIFO queue
  - `tool_start`: emit only `toolcall_start`, push to pendingTools
  - NEW `tool_end` handler: match by FIFO order, emit `toolcall_end` with results, store on ToolCall object
- **Location**: `lit-ui/src/core/ws-stream-fn.ts` (lines 91, 234-290)
- **Result**: Tool results now display during streaming with exit codes and stdout/stderr

### Issue 4: Thinking Blocks Show as Plain Text ✅
**Status**: FIXED
- **Root Cause**: Server discarded thinking content (sent empty `{"type":"thinking"}`). Client created many separate thinking blocks instead of accumulating.
- **Fixes Applied**:
  1. **Server-side** (`educlaw-server/src/acp_bridge/notifications.rs`): Extract thinking text from `AgentThoughtChunk` and send in frame
  2. **Client streaming** (`lit-ui/src/core/ws-stream-fn.ts`): Accumulate thinking chunks into single block with `thinking_start` → `thinking_delta`... → `thinking_end`
  3. **Client replay** (`lit-ui/src/pages/chat-page.ts`): Same accumulation logic for loaded sessions
- **Result**: Single collapsible thinking block containing full accumulated thinking text

## Files Modified

- `lit-ui/src/core/ws-stream-fn.ts` - Tool FIFO tracking, tool_end handler, thinking accumulation
- `lit-ui/src/pages/chat-page.ts` - Remove dead chat_start/chat_end, thinking accumulation
- `lit-ui/src/components/AgentInterface.ts` - setTimeout instead of queueMicrotask
- `educlaw-server/src/acp_bridge/notifications.rs` - Extract thinking text from chunks

## Verification Steps

1. ✅ TypeScript: `bunx tsc --noEmit` (0 errors)
2. Login works
3. Load previous session → messages render in correct interleaved order with accumulated thinking
4. Send message → response streams with single thinking block showing full content
5. After response: Send button reappears
6. Tool calls show with results if server uses tools

## Debug Console Logs Added

- `[ws-stream] tool_end: {name} status={status} exit={exitCode}` - Tool result tracking
- `[ws-stream] thinking_start/thinking_delta` - Thinking accumulation
- `[replay] message order: [role, role, ...]` - Verify interleaved order
- `[agent-event] agent_end post-render — isStreaming: {value}` - Cancel button timing
