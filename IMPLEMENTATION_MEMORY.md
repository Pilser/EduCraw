# Implementation Memory — Thinking Parameters via Custom ACP Method

## Date: 2025-07-11
## Status: COMPLETE — All changes implemented, all diagnostics clean

### Changes Made

#### Goose Side (Steps 1-3)
- [x] `goose-sdk/src/custom_requests.rs` — Added `SetSessionModelConfigRequest` + `SetSessionModelConfigResponse`
- [x] `goose/src/acp/server/custom_dispatch.rs` — Added `dispatch_set_session_model_config`
- [x] `goose/src/acp/server.rs` — Added `on_set_model_config` handler (mirrors `on_set_model` but with `.with_request_params()`)

#### EduCraw Side (Step 4 + Fixes)
- [x] `educlaw-server/Cargo.toml` — Added `goose-sdk` as path dependency
- [x] `educlaw-server/src/db/schema.rs` — Added `ALTER TABLE models ADD COLUMN thinking_params TEXT` migration
- [x] `educlaw-server/src/db/models.rs` — Added `thinking_params: Option<String>` field + `parsed_thinking_params()` helper
- [x] `educlaw-server/src/acp_bridge/model_poller.rs` — Now uses `SetSessionModelConfigRequest` with `thinking_params` from DB
- [x] `educlaw-server/src/acp_bridge/custom_requests.rs` — Replaced local Export/Import type duplicates with re-exports from `goose_sdk`

### Side Fix: Import/Export Session

Previously EduCraw defined its OWN `ExportSessionRequest`, `ImportSessionRequest`, etc. using `sacp::JsonRpcRequest` directly — duplicating goose-sdk types. These could drift out of sync. Now `acp_bridge/custom_requests.rs` re-exports from `goose_sdk::custom_requests`, so:
- Import/export session uses the canonical types
- No risk of type mismatch between EduCraw and Goose
- `acp_bridge/mod.rs` and `commands.rs` continue to work unchanged (they import via `super::custom_requests`)

### How thinking_params flows

1. Admin stores JSON in `models.thinking_params` column (e.g. `{"thinking_type":"enabled","budget_tokens":16000}`)
2. `model_poller` reads model → calls `parsed_thinking_params()` → gets `Option<HashMap<String, Value>>`
3. Sends `_goose/session/set_model_config` ACP method with `requestParams`
4. Goose handler calls `.with_request_params(req.request_params)` on `ModelConfig`
5. Providers read via `get_config_param()` at inference time
6. Persisted to DB via `update_provider()` → `model_config_json` column

### Critical Constraint
EduCraw MUST always use `_goose/session/set_model_config` — never `session/set_model`. The standard method creates a fresh `ModelConfig` with `request_params: None`, which would overwrite thinking config.

---

## Date: 2025-07-11 — Frontend Wiring Plan (PENDING APPROVAL)

### Discovery: Current State

**Backend (already done):**
- `models.thinking_params` column exists (JSON TEXT in SQLite)
- `Model.parsed_thinking_params()` helper returns `Option<HashMap<String, Value>>`
- `model_poller.rs` reads thinking_params from DB and sends via `SetSessionModelConfigRequest`
- `adminUpdateModelSpecs` only updates `provider`, `think_mode`, `visual_support` — NOT thinking_params

**Frontend (not yet wired):**
- `Model` TypeScript interface has `think_mode` but NO `thinking_params`
- Admin ModelsTab has controls for provider, think_mode, visual_support but NO thinking config
- Student ChatPanel has model dropdown with think_mode/visual icons but NO thinking controls
- `setSessionModel()` only sends model name — no thinking_params

---

## Date: 2025-07-11 — Frontend Wiring IMPLEMENTED

### Changes Made

#### Backend (Rust)

1. **`educlaw-server/src/db/models.rs`** — Added `update_thinking_params()` function
2. **`educlaw-server/src/api/admin.rs`** — Added:
   - `PUT /admin/models/:id/thinking` — accepts `{"thinking_params": {...}}` JSON, validates it's an object, stores as TEXT
   - `GET /admin/provider-schema/:provider` — returns ConfigParamDef[] for supported providers (anthropic, databricks, google, openai). **No frontend hard-coding — the schema lives on the server.**
3. **`educlaw-server/src/api/sessions.rs`** — Extended `SetModelBody` with optional `thinking_params: Option<HashMap<String, Value>>`. Writes `pending_thinking.json` side-channel file for model_poller to merge as per-session overrides.
4. **`educlaw-server/src/acp_bridge/model_poller.rs`** — Now checks for `pending_thinking.json` after reading model from DB, merges overrides into thinking_params before sending ACP request.

#### Frontend (TypeScript/React)

5. **`educlaw-web/src/api/types.ts`** — Added `thinking_params` to `Model`, added `ConfigParamDef` and `ProviderSchema` types
6. **`educlaw-web/src/api/client.ts`** — Added:
   - `adminUpdateModelThinking(token, id, params)` — calls PUT /admin/models/:id/thinking
   - `adminGetProviderSchema(provider)` — calls GET /admin/provider-schema/:provider
   - `normalizeThinkingParams(raw)` — normalizes JSON string from backend to object
   - Extended `setSessionModel()` with optional `thinkingParams` parameter
7. **`educlaw-web/src/components/ThinkingConfigEditor.tsx`** — NEW component:
   - Fetches provider schema from backend on mount/provider change
   - Renders dynamic select/number controls based on schema
   - Raw JSON mode for arbitrary key-value pairs
   - Supports providers with empty schemas (shows raw JSON option)
   - Follows warm parchment styling
8. **`educlaw-web/src/pages/AdminPage.tsx`** — ModelsTab changes:
   - Added `editingThinking` state
   - Specs editor now includes `ThinkingConfigEditor` when provider is set
   - Save/Cancel properly handles thinking params
   - Uses `normalizeThinkingParams()` for the JSON string from DB
9. **`educlaw-web/src/components/ChatPanel.tsx`** — Added:
   - `thinkingParams`, `onThinkingChange` props
   - "Think" toggle button next to model selector (appears when active model has thinking_params)
   - Expandable compact thinking config panel with inline key-value editing
   - Reset button to clear overrides
10. **`educlaw-web/src/pages/SessionPage.tsx`** — Wired thinking flow:
    - `thinkingParams` state initialized from active model's defaults on mount
    - `handleThinkingChange()` sends model + thinking override to API
    - `handleModelChange()` resets thinking params when switching models
    - `handleModelChanged()` (WebSocket) loads thinking params from new model
    - Uses `normalizeThinkingParams()` everywhere

### How It All Flows

**Admin path:**
1. Admin opens Models tab → clicks "Specs" on a model
2. Sets provider → ThinkingConfigEditor fetches `GET /admin/provider-schema/:provider`
3. Dynamic form renders (selects, number inputs) or raw JSON mode
4. Saves → `PUT /admin/models/:id/specs` + `PUT /admin/models/:id/thinking`
5. Stored in `models.thinking_params` as JSON TEXT

**Student path:**
1. Session loads → `GET /sessions/:id/models` returns models with `thinking_params`
2. Active model with thinking → "Think" button appears next to model dropdown
3. Student clicks "Think" → compact inline panel shows current params
4. Adjusts params → `PUT /sessions/:id/model` with `thinking_params` override
5. Backend writes `pending_model.txt` + `pending_thinking.json`
6. model_poller picks up both → sends `_goose/session/set_model_config` with merged params

### Key Design Decisions
- **Schema on server, not frontend** — `GET /admin/provider-schema/:provider` is the single source of truth
- **Universal JSON storage** — `models.thinking_params` accepts any JSON object, not constrained to schema
- **Raw JSON fallback** — ThinkingConfigEditor always has a "Raw JSON" mode for unknown params
- **Per-session overrides** — Students can temporarily adjust thinking level without changing admin defaults
- **No hard-coding** — New providers/params added by updating the Rust match statement in `provider_schema_handler`
