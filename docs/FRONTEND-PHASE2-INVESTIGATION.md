# EduCrawl Frontend - Phase 2 Chat Interface Investigation

## Version: 1.0 - Agent Investigation Brief

## Context

A planning document (`FRONTEND-PLAN.md`) was created for building the EduCrawl frontend using pi-web-ui components. That document covers Phase 1 (Login) in detail, but the chat interface (Phase 2) requires deeper investigation.

This document provides an AI agent with the context, references, and specific questions needed to complete the investigation for Phase 2 implementation.

---

## Background

### What We Have

1. **educlaw-server** (Rust/Axum) - Backend with REST API + WebSocket
2. **pi-web-ui** - Lit web component library for AI chat interfaces
3. **pi-ai** - LLM provider abstraction layer
4. **pi-agent** - Agent state machine with tools support

### Current Plan Status

| Phase | Status | Notes |
|--------|--------|-------|
| Phase 1: Login | Planned | Ready to implement after agent investigation |
| Phase 2: Chat | Needs Investigation | Primary focus of this document |
| Phase 3: Files/Admin | Future | Not in scope |

---

## Key References

### 1. pi-web-ui Example Application

**Location**: `/home/pilser/AA-Projects/EduCraw/pi/packages/web-ui/example/`

Critical files to study:
- `src/main.ts` - Full application initialization (421 lines)
- `src/app.css` - Theme import (`@import "../../dist/app.css"`)
- `index.html` - Entry point
- `vite.config.ts` - Build configuration with path aliases
- `package.json` - Dependencies

### 2. pi-web-ui Source Code

**Location**: `/home/pilser/AA-Projects/EduCraw/pi/packages/web-ui/src/`

Key files:
- `ChatPanel.ts` - Main chat container (209 lines)
- `components/AgentInterface.ts` - Chat interface wrapper (403 lines)
- `components/Messages.ts` - Message rendering (383 lines)
- `components/MessageEditor.ts` - Input area
- `components/ThinkingBlock.ts` - Thinking display
- `dialogs/ModelSelector.ts` - Model selection dialog (370 lines)
- `tools/artifacts/` - Artifact rendering (HTML, Markdown, etc.)
- `storage/stores/sessions-store.ts` - Session persistence

### 3. pi-ai Package

**Location**: `/home/pilser/AA-Projects/EduCraw/pi/packages/ai/src/`

Key files:
- `types.ts` - Model, Message, Context types (549 lines)
- `stream.ts` - Stream function for LLM calls
- `models.ts` - Model definitions

### 4. pi-agent Package

**Location**: `/home/pilser/AA-Projects/EduCraw/pi/packages/agent/src/`

Key files:
- `agent.ts` - Agent class (544 lines)
- `types.ts` - AgentState, AgentMessage, AgentEvent (389 lines)
- `proxy.ts` - Stream proxy for server-based LLM calls (367 lines)

### 5. Mini-lit Components

**Location**: `/home/pilser/AA-Projects/EduCraw/pi/node_modules/@mariozechner/mini-lit/dist/`

Components used in pi-web-ui:
- `Button.js`, `Input.js`, `Card.js`, `Dialog.js`, `Alert.js`
- `MarkdownBlock.js`, `CodeBlock.js`
- `ThemeToggle.js`, `ModeToggle.js`
- `Select.js`, `Switch.js`

**Themes**:
- `styles/themes/default.css` - Light theme
- `styles/themes/claude.css` - Dark theme

### 6. EduCrawl Backend API

**Location**: `/home/pilser/AA-Projects/EduCraw/docs/api/` (API documentation files)

Key API endpoints:
- `/auth/login` - Authentication (Phase 1)
- `/sessions` - Session creation
- `/sessions/:id/ws` - WebSocket for real-time chat
- `/sessions/:id/models` - Available models
- `/sessions/:id/model` - Switch active model
- `/sessions/:id/token-usage` - Token tracking

---

## Investigation Tasks

The agent must complete the following investigation tasks:

### Task 1: UI/UX Analysis

**Goal**: Understand exact styling, responsiveness, and interaction patterns from pi-web-ui example.

**Questions to Answer**:
1. How does the example handle responsive breakpoints?
2. What CSS classes/patterns are used for mobile vs desktop?
3. How is the theme (colors, spacing, typography) configured?
4. What animations/transitions are used?

**Files to Study**:
- `pi/packages/web-ui/example/src/main.ts` (lines 250-375 for render logic)
- `pi/packages/web-ui/src/app.css` (line 1 imports dist/app.css)
- `pi/packages/web-ui/src/components/AgentInterface.ts`

**Deliverable**: Document with CSS/styling patterns, responsive breakpoints, theme configuration

---

### Task 2: Model Selection Investigation

**Goal**: Understand how model selection works in the example.

**Questions to Answer**:
1. What is `ModelSelector` and how does it work?
2. How does the agent get/set the active model?
3. What is the relationship between `getModel()` from pi-ai and the UI selector?
4. How does the example display model information in messages?

**Files to Study**:
- `pi/packages/web-ui/src/dialogs/ModelSelector.ts` (370 lines)
- `pi/packages/ai/src/models.ts` - Model definitions
- `pi/packages/ai/src/types.ts` - Model interface

**Deliverable**: Document model selection flow, data structures, and integration points

---

### Task 3: Thinking Display Investigation

**Goal**: Understand thinking/reasoning display.

**Questions to Answer**:
1. What is `ThinkingBlock` component and how does it work?
2. How is thinking content extracted from LLM responses?
3. What is `ThinkingLevel` type in pi-ai vs pi-agent?
4. How does the UI show thinking vs final answer?
5. What icon indicates thinking capability?

**Files to Study**:
- `pi/packages/web-ui/src/components/ThinkingBlock.ts`
- `pi/packages/ai/src/types.ts` (look for ThinkingLevel, ThinkingContent)
- `pi/packages/agent/src/types.ts` (line 255: ThinkingLevel type)

**Deliverable**: Document thinking display mechanism, types, and UI patterns

---

### Task 4: Thinking Level Selection Investigation

**Goal**: Understand how users control thinking level.

**Questions to Answer**:
1. How does the example provide thinking level selection (off, minimal, low, medium, high, xhigh)?
2. Where is the thinking level selector in the UI?
3. How is thinking level stored in agent state?
4. How is thinking level passed to LLM calls?

**Files to Study**:
- `pi/packages/web-ui/src/components/MessageEditor.ts` (thinking selector)
- `pi/packages/agent/src/types.ts` (line 255: ThinkingLevel)
- `pi/packages/ai/src/types.ts` (line 62-64: ThinkingLevel types)

**Deliverable**: Document thinking level selection UI and data flow

---

### Task 5: File Attachment Investigation

**Goal**: Understand attachment handling in pi-web-ui.

**Questions to Answer**:
1. What is `AttachmentTile` component?
2. How are files selected and processed?
3. What file types are supported (images, documents)?
4. How are attachments passed to the agent?
5. What is `UserMessageWithAttachments` type?

**Files to Study**:
- `pi/packages/web-ui/src/components/AttachmentTile.ts`
- `pi/packages/web-ui/src/components/MessageEditor.ts`
- `pi/packages/web-ui/src/components/Messages.ts` (lines 18-23: UserMessageWithAttachments)
- `pi/packages/web-ui/src/utils/attachment-utils.ts`

**Deliverable**: Document attachment types, handling, and integration

---

### Task 6: WebSocket Integration Investigation (Critical)

**Goal**: Understand how to connect pi-web-ui to EduCrawl's WebSocket backend.

**Challenge**: pi-web-ui expects an Agent with `streamFn` for LLM calls. EduCrawl uses WebSocket (`/sessions/:id/ws`) for communication.

**Questions to Answer**:
1. How does the example use the Agent class?
2. What is the relationship between streamFn and WebSocket?
3. Is there a way to use WebSocket instead of streamFn?
4. What messages need to be sent/received?
5. How is token usage tracked?

**Files to Study**:
- `pi/packages/agent/src/agent.ts` (line 98: streamFn option, line 194: default streamFn)
- `pi/packages/agent/src/proxy.ts` (lines 116-233: streamProxy function)
- `educlaw-web/src/hooks/useWebSocket.ts` (existing WebSocket hook - reference!)
- `pi/packages/web-ui/src/components/AgentInterface.ts` (lines 137-151: streamFn setup)

**Critical Analysis Needed**:
Compare the two approaches:
1. **Agent → streamFn → LLM**: Agent calls streamFn for each LLM request
2. **WebSocket**: Agent sends/receives messages via WebSocket

Can we create a custom streamFn that uses WebSocket? Or should we bypass the Agent class entirely?

**Deliverable**: Document recommended WebSocket integration strategy

---

### Task 7: Tool Call Display Investigation

**Goal**: Understand how tool execution is displayed.

**Questions to Answer**:
1. What is `ToolMessage` component?
2. How are tool calls rendered in the chat?
3. What is the difference between `tool_start`, `tool_end`, `tool_result` messages?
4. How are tool errors displayed?
5. What tools does the example support?

**Files to Study**:
- `pi/packages/web-ui/src/components/Messages.ts` (lines 226-277: ToolMessage)
- `pi/packages/web-ui/src/tools/renderer-registry.ts`
- `pi/packages/web-ui/src/tools/renderers/`

**Deliverable**: Document tool display mechanism and message types

---

### Task 8: Markdown Rendering Investigation

**Goal**: Understand full markdown support.

**Questions to Answer**:
1. What is `MarkdownBlock` component?
2. Does it support GFM (GitHub Flavored Markdown)?
3. How are code blocks rendered?
4. Are tables, task lists, and other GFM features supported?
5. How is code syntax highlighting done?

**Files to Study**:
- `pi/node_modules/@mariozechner/mini-lit/dist/MarkdownBlock.js`
- `pi/packages/web-ui/src/components/Messages.ts` (uses markdown-block)

**Deliverable**: Document markdown rendering capabilities

---

### Task 9: Session Persistence Investigation

**Goal**: Understand how sessions are saved/restored.

**Questions to Answer**:
1. How does the example save session state?
2. What is `SessionsStore` and `IndexedDBStorageBackend`?
3. How are messages persisted between page reloads?
4. Is session data stored locally or on server?

**Files to Study**:
- `pi/packages/web-ui/src/storage/stores/sessions-store.ts`
- `pi/packages/web-ui/src/storage/backends/indexeddb-storage-backend.ts`
- `pi/packages/web-ui/src/storage/app-storage.ts`
- `pi/packages/web-ui/example/src/main.ts` (lines 102-150: saveSession)

**Decision**: For EduCrawl, should we use local persistence or server-based sessions?

**Deliverable**: Document session persistence strategy recommendation

---

### Task 10: Project Structure Planning

**Goal**: Design modular project structure for Phase 2.

**Recommendations Based on Plan**:
```
educlaw-frontend/src/
├── core/
│   ├── api/
│   │   ├── client.ts           # REST API client
│   │   ├── types.ts           # API types
│   │   └── websocket.ts       # WebSocket client (NEW)
│   │
│   ├── auth/
│   │   ├── token.ts           # JWT management
│   │   └── session.ts          # Session state
│   │
│   └── storage/
│       └── local.ts           # localStorage wrapper
│
├── components/
│   ├── chat/                  # (NEW)
│   │   ├── chat-panel.ts      # Wrapper around pi-web-ui ChatPanel
│   │   ├── message-list.ts    # Custom message rendering
│   │   ├── message-editor.ts # Custom input handling
│   │   ├── model-selector.ts  # Model selection integration
│   │   ├── thinking-display.ts # Thinking block customization
│   │   └── tool-display.ts    # Tool call display
│   │
│   ├── session/               # (NEW)
│   │   ├── session-manager.ts # Session lifecycle
│   │   └── session-storage.ts # Session persistence
│   │
│   └── login/                # From Phase 1
│
├── pages/
│   ├── login.ts
│   └── chat.ts               # (NEW)
│
├── services/                 # (NEW)
│   ├── websocket-bridge.ts    # WebSocket to Agent bridge
│   └── model-provider.ts      # Model selection service
│
└── utils/
    ├── markdown.ts           # Markdown utilities
    └── format.ts              # Formatting utilities
```

**Deliverable**: Finalized project structure document

---

## API Documentation Reference

The agent must reference these API docs:

### Authentication (from `/docs/01-authentication.md`)
- `POST /auth/login` - Student login
- `POST /auth/token` - Admin bootstrap

### Sessions (from `/docs/02-sessions.md`)
- `POST /sessions` - Create session
- `GET /sessions/:id` - Get session status
- `DELETE /sessions/:id` - Terminate session
- `GET /sessions/:id/models` - List models
- `PUT /sessions/:id/model` - Switch model
- `GET /sessions/:id/token-usage` - Token usage
- `GET /sessions/:id/ws` - WebSocket endpoint

### WebSocket Protocol (from `/docs/04-websocket.md`)
Message types to understand:
- Client → Server: `input`, `resize`, `cancel`, `getmodels`
- Server → Client: `chat_start`, `user_text`, `tool_start`, `tool_end`, `assistant_text`, `chat_end`, `token_usage`, `model_changed`, `models`

---

## Investigation Output Format

For each task, produce:

1. **Summary**: 2-3 sentence overview
2. **Key Files**: List of files that were studied
3. **Findings**: Detailed technical findings
4. **Code Examples**: Relevant code snippets
5. **Recommendations**: Specific recommendations for EduCrawl implementation
6. **Open Questions**: Any unresolved questions

---

## Important Notes

1. **pi-web-ui uses Lit Web Components** - No React/Vue dependency
2. **Example uses IndexedDB for session storage** - Consider if this is needed for EduCrawl
3. **WebSocket vs streamFn** - This is the key architectural decision for Phase 2
4. **Theme integration** - Use pi-web-ui's built-in theming (app.css), customize via CSS variables
5. **TypeScript required** - All code should be TypeScript

---

## Success Criteria

The investigation is complete when:

1. All 10 investigation tasks have detailed findings
2. A clear architectural recommendation for WebSocket integration exists
3. Project structure for Phase 2 is finalized
4. A new/improved planning document is created combining all findings
5. Code examples for key integrations are provided

---

*This document is for AI agent use. For human review, see FRONTEND-PLAN.md for the overview.*
