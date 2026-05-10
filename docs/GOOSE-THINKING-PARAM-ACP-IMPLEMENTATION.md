# Goose Thinking Parameters via ACP - Implementation Guide

## Overview

This document details how thinking/reasoning parameters can be exposed via the ACP (Agent Client Protocol) to allow dynamic configuration of model thinking levels for providers that support it (Anthropic, Google Gemini, OpenAI reasoning models, DeepSeek R1, xAI Grok, etc.).

**Design Decision: Option A — Flat `HashMap<String, Value>` + Discovery Endpoint**

After investigating how every provider in Goose handles thinking configuration, we concluded that a flat `HashMap<String, Value>` in `requestParams` (mirroring Goose's internal `ModelConfig.request_params`) is the right approach:

- Maximum flexibility — each provider reads only the keys it cares about
- Zero maintenance — new providers don't need schema changes
- Proven — Goose already uses this pattern internally via `get_config_param()`
- Complemented by a model-config-schema discovery endpoint so clients know what keys are valid

---

## Current State Analysis

### What's Already Implemented ✅

| Component | Status | Location |
|-----------|--------|----------|
| **ModelConfig with request_params** | ✅ Implemented | `goose-workspace/crates/goose/src/model.rs:47-62` |
| **get_config_param() lookup** | ✅ Implemented | `goose-workspace/crates/goose/src/model.rs:330-344` |
| **Database persistence** | ✅ Implemented | `goose-workspace/crates/goose/src/session/session_manager.rs:782-816` |
| **Anthropic thinking config** | ✅ Reads from request_params | `formats/anthropic.rs:47-82`, `:474-482`, `:484-506` |
| **Google Gemini thinking config** | ✅ Reads from request_params | `formats/google.rs:536-590` |
| **Databricks thinking config** | ✅ Reads from request_params | `formats/databricks.rs:233-249` (reuses Anthropic functions) |
| **OpenAI reasoning effort** | ⚠️ Model name suffix only | `providers/utils.rs:221-238` |
| **ACP SetSessionModel API** | ⚠️ Partial | Standard `session/set_model` only accepts `model_id`, no request_params |
| **Custom set_model_config API** | ⏳ To implement | New `_goose/session/set_model_config` with `request_params` |
| **Model discovery endpoint** | ❌ Not implemented | Would tell clients what keys a model supports |

### Provider Thinking Parameter Matrix (Complete)

This table covers ALL providers in Goose that handle thinking/reasoning, including how they read params and what keys they use.

| Provider | Key(s) in `requestParams` | Values | How It's Read | Model-Name-Based? |
|----------|---------------------------|--------|---------------|-------------------|
| **Anthropic (Claude)** | `thinking_type` | `disabled`, `enabled`, `adaptive` | `get_config_param("thinking_type", "CLAUDE_THINKING_TYPE")` | No |
| | `budget_tokens` | Integer (e.g., 16000, min 1024) | `get_config_param("budget_tokens", "CLAUDE_THINKING_BUDGET")` | No |
| | `effort` | `low`, `medium`, `high`, `max` | `get_config_param("effort", "CLAUDE_THINKING_EFFORT")` | No (only with adaptive) |
| **Google Gemini 3** | `thinking_level` | `low`, `high` | `get_config_param("thinking_level", "GEMINI3_THINKING_LEVEL")` | Yes (model name triggers) |
| **Google Gemini 2.5** | `thinking_budget` | Integer (e.g., 8192) | `get_config_param("thinking_budget", "GEMINI25_THINKING_BUDGET")` | Yes (model name triggers) |
| **OpenAI (o1/o3/gpt-5)** | *(none — uses model name suffix)* | `-none`, `-low`, `-medium`, `-high`, `-xhigh` | `extract_reasoning_effort()` in `providers/utils.rs:221` | **Yes** |
| **OpenAI (ChatGPT Codex)** | *(none — uses env var)* | `low`, `medium`, `high` | `CHATGPT_CODEX_REASONING_EFFORT` env var | No |
| **Databricks** | `thinking_type`, `effort`, `budget_tokens` | Same as Anthropic | Reuses Anthropic's `thinking_type()` + `apply_thinking_config()` | No |
| **OpenRouter** | *(none)* | — | Passes through `reasoning_details` in response metadata; delegates to underlying provider format | No |
| **xAI (Grok)** | *(none currently)* | — | No thinking config exposed yet; provider metadata says "reasoning capabilities" | No |
| **DeepSeek** | *(none currently)* | — | Uses `reasoning_content` in responses (read only, not configurable); no request-param-based thinking config | No |
| **Venice** | *(none currently)* | — | Has `supportsReasoning` capability flag, no request-param config | No |
| **Ollama** | *(none currently)* | — | Handles `max_completion_tokens` for reasoning models; no request-param config | No |

### Key Insight: Two Families of Thinking Configuration

1. **Request-param-based** (Anthropic, Google, Databricks): Thinking is configured by keys in `request_params`. These providers **already work** with the `HashMap<String, Value>` approach. Adding `requestParams` to ACP instantly enables them.

2. **Model-name-based** (OpenAI): Reasoning effort is embedded in the model name (e.g., `gpt-5.4-high`). This is a different paradigm — the "thinking level" is part of the model identifier itself. OpenRouter and others that front OpenAI models may inherit this pattern.

3. **Response-only** (DeepSeek, OpenRouter): These providers return `reasoning_content` in their responses but don't have a client-configurable thinking toggle. They either always think or decide server-side.

**Implication:** The flat `HashMap` approach works perfectly for family 1. For family 2 (OpenAI), the EduCraw layer can still use `requestParams` if Goose is enhanced to also check `request_params` for reasoning effort before falling back to model name parsing. For family 3, no client-side config is needed.

---

## The `get_config_param` Mechanism (Heart of the Flexibility)

This single function in `model.rs:330-344` is why the flat HashMap works:

```rust
pub fn get_config_param<T: for<'de> serde::Deserialize<'de>>(
    &self,
    request_key: &str,   // e.g., "thinking_type"
    config_key: &str,    // e.g., "CLAUDE_THINKING_TYPE" 
) -> Option<T> {
    self.request_params                      // 1. Check request_params first
        .as_ref()
        .and_then(|params| params.get(request_key))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .or_else(|| {                          // 2. Fall back to env var
            crate::config::Config::global()
                .get_param::<T>(config_key)
                .ok()
        })
}
```

**Priority order:**
1. `request_params` from ACP request (dynamic, per-session)
2. Environment variable (static, global default)
3. Provider-specific default (hardcoded)

This means setting `requestParams` via ACP **overrides** any env var defaults.

---

## Flow Diagram: Custom ACP Method → Persistence → LLM Client

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. ACP REQUEST (from EduCraw) — Custom Goose Method                          │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ SetSessionModelConfigRequest {          ← CUSTOM TYPE (goose-sdk)        │ │
│ │   session_id: "thread-123",                                              │ │
│ │   model_id: "claude-sonnet-4-20250514",                                 │ │
│ │   request_params: {                                                      │ │
│ │     "thinking_type": "enabled",                                         │ │
│ │     "budget_tokens": 16000                                              │ │
│ │   }                                                                      │ │
│ │ }                                                                        │ │
│ │ Method: "_goose/session/set_model_config"                               │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. CUSTOM DISPATCH (acp/server/custom_dispatch.rs)                          │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ #[custom_method(SetSessionModelConfigRequest)]                          │ │
│ │ → on_set_model_config(req)                                              │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. HANDLER (acp/server.rs)                                                   │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ let model_config = ModelConfig::new(&req.model_id)                      │ │
│ │     .with_canonical_limits(&provider_name)                              │ │
│ │     .with_request_params(req.request_params);  ← THE KEY LINE          │ │
│ │                                                                          │ │
│ │ // ModelConfig now holds:                                               │ │
│ │ //   model_name: "claude-sonnet-4-20250514"                            │ │
│ │ //   request_params: Some({"thinking_type": "enabled", ...})           │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. SESSION PERSISTENCE (session_manager.rs)                                 │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ // ModelConfig serialized to JSON (including request_params)            │ │
│ │ let model_config_json = serde_json::to_string(&model_config)?;          │ │
│ │                                                                          │ │
│ │ // SQL: UPDATE sessions SET model_config_json = ? WHERE id = ?         │ │
│ │ // Stored as: {"model_name":"claude-sonnet-4-20250514",                 │ │
│ │ //             "request_params":{"thinking_type":"enabled",...}}        │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. LLM CLIENT (Provider Format) — at inference time                         │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ // formats/anthropic.rs:47-82                                           │ │
│ │ pub fn thinking_type(model_config: &ModelConfig) -> ThinkingType {     │ │
│ │     model_config.get_config_param(                                      │ │
│ │         "thinking_type",        // ← reads from request_params          │ │
│ │         "CLAUDE_THINKING_TYPE"  // ← falls back to env var              │ │
│ │     )                                                                    │ │
│ │ }                                                                        │ │
│ │                                                                          │ │
│ │ // Creates API payload:                                                  │ │
│ │ { "thinking": { "type": "enabled", "budget_tokens": 16000 } }         │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

> **Note:** The standard `session/set_model` method (in `dispatch.rs`) continues to work unchanged for basic model switching. The custom `_goose/session/set_model_config` method is a Goose extension that adds `request_params` support. Both coexist.

---

## Implementation Strategy: Path A — Custom ACP Method

**Key decision:** Instead of modifying the external `sacp` crate (which defines `SetSessionModelRequest`), we use Goose's existing **custom method dispatch** system. This is the same pattern used by 40+ Goose-specific ACP methods already in production (`AddExtensionRequest`, `ProviderConfigSaveRequest`, `CreateSourceRequest`, etc.).

### Two Methods Coexist

| Method | Has `requestParams`? | Used by |
|--------|---------------------|---------|
| `session/set_model` | ❌ No | Standard Goose clients, basic model switching |
| `_goose/session/set_model_config` | ✅ Yes | **EduCraw exclusively** — replaces `SetSessionModelRequest` |

> **Note:** Provider switching is SEPARATE and handled by `session/set_config_option` with `SessionConfigId::new("provider")`. Neither method touches provider — they only set the model within the current provider.

EduCraw's model_poller does two sequential ACP calls: (1) switch provider via `set_config_option`, (2) switch model via `set_model_config`. Step 1 is unchanged; the custom method only replaces step 2.

---

## Files to Modify

### 1. Define Custom Request Type in goose-sdk

**File:** `goose-workspace/crates/goose-sdk/src/custom_requests.rs` (append)

```rust
/// Set a session's model WITH optional provider-specific parameters.
/// This extends the standard `session/set_model` with `request_params`
/// for configuring thinking levels, effort, budget, etc.
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema, JsonRpcRequest)]
#[request(method = "_goose/session/set_model_config", response = SetSessionModelConfigResponse)]
#[serde(rename_all = "camelCase")]
pub struct SetSessionModelConfigRequest {
    pub session_id: String,
    pub model_id: String,
    /// Optional provider-specific parameters (e.g., thinking_type, thinking_budget, effort).
    /// Keys are provider-defined; unrecognized keys are silently ignored by providers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_params: Option<std::collections::HashMap<String, serde_json::Value>>,
}

/// Response to `_goose/session/set_model_config`.
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema, JsonRpcResponse)]
#[serde(rename_all = "camelCase")]
pub struct SetSessionModelConfigResponse {
    // Empty success response (same pattern as SetSessionModelResponse)
}
```

**Why:** This uses Goose's proven custom method pattern. The `#[request(method = "...")]` attribute sets the ACP method name. The `JsonRpcRequest` derive generates the method-matching logic.

---

### 2. Add Dispatch in custom_dispatch.rs

**File:** `goose-workspace/crates/goose/src/acp/server/custom_dispatch.rs` (append)

```rust
#[custom_method(SetSessionModelConfigRequest)]
async fn dispatch_set_session_model_config(
    &self,
    req: SetSessionModelConfigRequest,
) -> Result<SetSessionModelConfigResponse, sacp::Error> {
    self.on_set_model_config(req).await
}
```

**Why:** The `#[custom_method]` macro auto-generates the method-name matching and JSON deserialization. This is the same pattern used by all 40+ existing custom methods.

---

### 3. Add Handler in server.rs

**File:** `goose-workspace/crates/goose/src/acp/server.rs` (append near `on_set_model`)

```rust
/// Handles `_goose/session/set_model_config` — extended model switch with provider params.
/// This is the same logic as `on_set_model` but accepts `request_params` for thinking config.
async fn on_set_model_config(
    &self,
    req: SetSessionModelConfigRequest,
) -> Result<SetSessionModelConfigResponse, sacp::Error> {
    let internal_id = self.internal_session_id(&req.session_id).await?;
    let config = self.config()?;
    let agent = self.get_session_agent_provider_ready(&req.session_id).await?;
    let current_provider = agent
        .provider()
        .await
        .internal_err_ctx("Failed to get provider")?;
    let provider_name = current_provider.get_name().to_string();
    let extensions =
        EnabledExtensionsState::for_session(&self.session_manager, &internal_id, &config).await;

    // Creates ModelConfig WITH request_params
    let model_config = crate::model::ModelConfig::new(&req.model_id)
        .invalid_params_err_ctx("Invalid model config")?
        .with_canonical_limits(&provider_name)
        .with_request_params(req.request_params);  // ← THE KEY LINE

    let provider = self
        .create_provider(&provider_name, model_config, extensions)
        .await
        .internal_err_ctx("Failed to create provider")?;
    agent
        .update_provider(provider, &internal_id)
        .await
        .internal_err_ctx("Failed to update provider")?;

    let mode = agent.goose_mode().await;
    agent
        .update_goose_mode(mode, &internal_id)
        .await
        .internal_err_ctx("Failed to propagate mode")?;

    self.update_thread_metadata(&req.session_id, move |meta| {
        meta.model_id = Some(req.model_id);
    })
    .await?;

    Ok(SetSessionModelConfigResponse::default())
}
```

**Why:** The handler mirrors `on_set_model` exactly, but with the critical addition of `.with_request_params(req.request_params)`. The params are persisted when the session is saved (ModelConfig serialized to `model_config_json`) and used at inference time by each provider's `get_config_param()` calls.

**Note:** The standard `session/set_model` dispatch in `dispatch.rs` REMAINS UNCHANGED. It continues to work without `request_params`. The two methods coexist — standard clients use `session/set_model`, EduCraw uses `_goose/session/set_model_config`.

> ⚠️ **Important — Overwrite Risk:** Both methods persist the ENTIRE `ModelConfig` to the DB (via `update_provider()` → `SessionUpdateBuilder.model_config()`). If `session/set_model` is called AFTER `_goose/session/set_model_config` on the same session, the `request_params` will be overwritten with `None` because the standard method creates a fresh `ModelConfig` that only picks up `request_params` from `GOOSE_PREDEFINED_MODELS` env var (not from the session's existing config).
>
> **Mitigation:** EduCraw's model_poller MUST always use `_goose/session/set_model_config` for sessions that ever need thinking config. Even when switching to a non-thinking model, use the custom method with `request_params: null` to explicitly clear them. This avoids the standard method ever touching those sessions.

---

### 4. (NEW) Model Config Discovery Endpoint

**File:** New — `goose-workspace/crates/goose/src/acp/server/resources.rs` or new file

To make the flat HashMap approach discoverable, we add a new ACP method or config endpoint that tells clients what keys a given model supports.

**Proposed ACP method:** `session/get_model_config_schema`

```json
// Request
{
  "jsonrpc": "2.0",
  "id": "req-200",
  "method": "session/get_model_config_schema",
  "params": {
    "sessionId": "thread-456",
    "modelId": "claude-sonnet-4-20250514"
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": "req-200",
  "result": {
    "modelId": "claude-sonnet-4-20250514",
    "provider": "anthropic",
    "configurableParams": {
      "thinking_type": {
        "type": "string",
        "values": ["disabled", "enabled", "adaptive"],
        "default": "adaptive",
        "description": "Controls Claude's extended thinking mode. 'adaptive' is only supported on Claude 4.6+ models."
      },
      "budget_tokens": {
        "type": "integer",
        "min": 1024,
        "max": 64000,
        "default": 16000,
        "description": "Token budget for thinking. Only used when thinking_type='enabled'."
      },
      "effort": {
        "type": "string",
        "values": ["low", "medium", "high", "max"],
        "default": "high",
        "description": "Thinking effort level. Only used when thinking_type='adaptive'."
      }
    }
  }
}
```

**Implementation approach:** Each provider already knows what keys it reads. The discovery endpoint can be provider-driven — each `ProviderDef` exposes a `get_config_schema(model_name) -> ConfigSchema` method that returns the supported keys and their constraints.

For providers that don't support any config params, this returns an empty schema:
```json
{
  "modelId": "gpt-4o",
  "provider": "openai",
  "configurableParams": {}
}
```

---

## How Persistence Works

### Database Schema

**Table:** `sessions`

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    -- ... other fields ...
    model_config_json TEXT,  -- ← Stores full ModelConfig including request_params
    -- ... other fields ...
);
```

### Saving ModelConfig (Already Works ✅)

**File:** `goose-workspace/crates/goose/src/session/session_manager.rs:782-816`

```rust
let model_config_json = match &session.model_config {
    Some(model_config) => Some(serde_json::to_string(model_config)?),
    None => None,
};

// INSERT INTO sessions (..., model_config_json, ...)
.bind(model_config_json)
```

The `ModelConfig` struct (including `request_params`) is serialized to JSON via `serde_json::to_string`. Example stored JSON:

```json
{
  "model_name": "claude-sonnet-4-20250514",
  "context_limit": 200000,
  "temperature": null,
  "max_tokens": null,
  "toolshim": false,
  "toolshim_model": null,
  "request_params": {
    "thinking_type": "enabled",
    "budget_tokens": 16000
  },
  "reasoning": null
}
```

### Loading ModelConfig (Already Works ✅)

When a session is loaded, `model_config_json` is deserialized back into `ModelConfig`:

```rust
model_config: row.try_get("model_config_json")?
    .map(|json: String| serde_json::from_str(&json))
    .transpose()?
```

**Key point:** Persistence already handles `request_params` correctly. No database migration needed. The only change is making `request_params` flow through the ACP layer.

---

## Do LLM Clients Accept Empty/Null Parameters for Non-Thinking Models?

### Short Answer: YES ✅

All provider implementations handle null/empty parameters gracefully. This is critical for the flat HashMap approach — a client can send `requestParams` for any model, and non-thinking providers simply ignore irrelevant keys.

### 1. Anthropic (`formats/anthropic.rs:47-82`)

```rust
pub fn thinking_type(model_config: &ModelConfig) -> ThinkingType {
    let model_lower = model_config.model_name.to_lowercase();
    if !model_lower.contains("claude") {
        return ThinkingType::Disabled;  // Non-Claude models → disabled
    }

    let is_adaptive_model = supports_adaptive_thinking(&model_config.model_name);
    
    if let Some(s) = model_config.get_config_param::<String>("thinking_type", "CLAUDE_THINKING_TYPE") {
        let tt = s.parse::<ThinkingType>().unwrap_or_else(|e| {
            tracing::warn!("{e}");
            ThinkingType::Disabled  // Invalid value → disabled with warning
        });
        if tt == ThinkingType::Adaptive && !is_adaptive_model {
            return ThinkingType::Disabled;  // Gracefully falls back for non-adaptive models
        }
        return tt;
    }
    
    // No param set → defaults
    if is_adaptive_model {
        ThinkingType::Adaptive  // Claude 4.6+ defaults to adaptive
    } else {
        ThinkingType::Disabled // Other Claude models default to disabled
    }
}
```

### 2. Google Gemini (`formats/google.rs:536-590`)

```rust
fn get_thinking_config(model_config: &ModelConfig) -> Option<ThinkingConfig> {
    let model_name = model_config.model_name.to_lowercase();
    let is_gemini_3 = model_name.starts_with("gemini-3");
    let is_gemini_25 = model_name.starts_with("gemini-2.5");
    
    if !is_gemini_3 && !is_gemini_25 {
        return None;  // Non-thinking models → no config at all
    }
    // ...
}
```

### 3. OpenAI (`providers/utils.rs:221-238`)

```rust
pub fn extract_reasoning_effort(model_name: &str) -> (String, Option<String>) {
    if !is_openai_responses_model(model_name) {
        return (model_name.to_string(), None);  // Non-reasoning model → no effort
    }
    // Only extracts effort suffix if present in model name
}
```

### 4. Databricks (reuses Anthropic functions)

Same behavior as Anthropic — `thinking_type()` returns `Disabled` if the model doesn't contain "claude".

---

## Null/Empty request_params Behavior Matrix

| Scenario | `requestParams` Value | Result |
|----------|----------------------|--------|
| **Omitted entirely** | (not sent) | Uses env var defaults or provider defaults |
| **Null** | `null` | Same as omitted — env var or provider defaults |
| **Empty map** | `{}` | Provider sees empty map — same as no params |
| **Unknown key** | `{"temperature": 0.5}` | Ignored — thinking not affected (but could set temp if provider reads it!) |
| **Wrong value type** | `{"thinking_type": 42}` | Parsing fails → falls back to default with warning |
| **Valid key, valid value** | `{"thinking_type": "enabled"}` | Thinking enabled ✅ |
| **Non-thinking model** | `{"thinking_type": "enabled"}` | Gracefully ignored by provider (e.g., Anthropic returns Disabled for non-Claude, Google returns None for non-Gemini) |
| **Cross-provider keys** | `{"thinking_type": "enabled"}` on Gemini | Gemini's `get_thinking_config` never calls `get_config_param("thinking_type", ...)` — silently ignored |

---

## Usage Examples

### Example 1: Enable Thinking for Claude Sonnet 4 (Custom Method)

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "method": "_goose/session/set_model_config",
  "params": {
    "sessionId": "thread-456",
    "modelId": "claude-sonnet-4-20250514",
    "requestParams": {
      "thinking_type": "enabled",
      "budget_tokens": 16000
    }
  }
}
```

**Result:** Claude Sonnet 4 uses extended thinking with 16K token budget. At inference time, Goose sends:
```json
{ "thinking": { "type": "enabled", "budget_tokens": 16000 } }
```

### Example 2: Adaptive Thinking for Claude Opus 4.6 (Custom Method)

```json
{
  "jsonrpc": "2.0",
  "id": "req-124",
  "method": "_goose/session/set_model_config",
  "params": {
    "sessionId": "thread-456",
    "modelId": "claude-opus-4-6-20250514",
    "requestParams": {
      "thinking_type": "adaptive",
      "effort": "max"
    }
  }
}
```

**Result:** Claude Opus 4.6 uses adaptive thinking at max effort. Goose sends:
```json
{ "thinking": { "type": "adaptive" }, "output_config": { "effort": "max" } }
```

### Example 3: Thinking Level for Gemini 3 (Custom Method)

```json
{
  "jsonrpc": "2.0",
  "id": "req-125",
  "method": "_goose/session/set_model_config",
  "params": {
    "sessionId": "thread-456",
    "modelId": "gemini-3-flash",
    "requestParams": {
      "thinking_level": "high"
    }
  }
}
```

**Result:** Gemini 3 Flash uses high thinking level.

### Example 4: Thinking Budget for Gemini 2.5 (Custom Method)

```json
{
  "jsonrpc": "2.0",
  "id": "req-126",
  "method": "_goose/session/set_model_config",
  "params": {
    "sessionId": "thread-456",
    "modelId": "gemini-2.5-flash",
    "requestParams": {
      "thinking_budget": 8192
    }
  }
}
```

**Result:** Gemini 2.5 Flash uses 8192 thinking budget.

### Example 5: Standard Method (non-thinking model) — Uses standard ACP

```json
{
  "jsonrpc": "2.0",
  "id": "req-127",
  "method": "session/set_model",
  "params": {
    "sessionId": "thread-456",
    "modelId": "gpt-4o"
  }
}
```

**Result:** GPT-4o doesn't support thinking. The standard `session/set_model` works perfectly — no `requestParams` needed.

### Example 6: OpenAI Reasoning Model — uses model name suffix, either method works

```json
{
  "jsonrpc": "2.0",
  "id": "req-128",
  "method": "_goose/session/set_model_config",
  "params": {
    "sessionId": "thread-456",
    "modelId": "gpt-5.4-high"
  }
}
```

**Result:** GPT-5.4 with high reasoning effort. Note: OpenAI uses **model name suffix**, not `requestParams`. The `-high` suffix is parsed by `extract_reasoning_effort()`. You can still use the custom method — `requestParams` is simply omitted.

---

## EduCraw Integration

### Model Poller Update

The EduCraw model poller (`educlaw-server/src/acp_bridge/model_poller.rs`) does TWO things:

1. **Provider switch** — via `SetSessionConfigOptionRequest` with `SessionConfigId::new("provider")`
2. **Model switch** — via `SetSessionModelRequest::new(session_id, model_name)`

The custom method ONLY replaces step 2. Provider switching (step 1) is a separate ACP method and stays unchanged:

```rust
use goose_sdk::custom_requests::SetSessionModelConfigRequest;

// Step 1: Switch provider (UNCHANGED — uses standard ACP config option)
cx.send_request(SetSessionConfigOptionRequest::new(
    acp_session_id.clone(),
    SessionConfigId::new("provider"),
    SessionConfigOptionValue::value_id(provider.clone()),
)).block_task().await?;

// Step 2: Switch model WITH request_params (REPLACES SetSessionModelRequest)
cx.send_request(SetSessionModelConfigRequest {
    session_id: acp_session_id.to_string(),
    model_id: model_name.clone(),
    request_params: model.thinking_params,  // Some({...}) or None from DB
}).block_task().await?;
```

> ⚠️ **EduCraw must NEVER use the standard `SetSessionModelRequest`.** It would create a fresh `ModelConfig` with `request_params: None` and overwrite any thinking config in the DB. Even for non-thinking models, use the custom method with `request_params: None`. The standard method is only for non-EduCraw Goose clients that don't need thinking config.

### Admin Panel: Thinking Controls per Model

EduCraw's admin panel should show the right controls based on the model's provider. Using the discovery endpoint:

```python
# 1. Get config schema for a model
schema = await acp.send_request({
    "method": "session/get_model_config_schema",
    "params": {"modelId": "claude-sonnet-4-20250514"}
})

# 2. Render UI controls dynamically
for param_name, param_schema in schema["configurableParams"].items():
    if param_schema["type"] == "string" and "values" in param_schema:
        render_dropdown(param_name, param_schema["values"], param_schema["default"])
    elif param_schema["type"] == "integer":
        render_slider(param_name, param_schema["min"], param_schema["max"], param_schema["default"])

# 3. When teacher sets thinking, send via custom Goose ACP method
await acp.send_request({
    "method": "_goose/session/set_model_config",
    "params": {
        "sessionId": thread_id,
        "modelId": "claude-sonnet-4-20250514",
        "requestParams": {
            "thinking_type": "enabled",
            "budget_tokens": 16000
        }
    }
})
```

### Persistence Strategy in EduCraw

EduCraw already has a `think_mode` field on the `models` table. The flow:

1. **Admin sets thinking config per model** → stored in DB as JSON (`thinking_params` column or embedded in model metadata)
2. **Teacher assigns model to session** → EduCraw reads thinking params from DB
3. **Model poller sends ACP request** → includes `requestParams` from DB
4. **Goose persists** → `ModelConfig` (with `request_params`) saved to `sessions.model_config_json`
5. **Session resumes** → Thinking params restored from DB

---

## Summary: Changes Required

| # | File | Change Type | Description |
|---|------|-------------|-------------|
| 1 | `goose-sdk/src/custom_requests.rs` | Add types | Define `SetSessionModelConfigRequest` + `SetSessionModelConfigResponse` |
| 2 | `goose/.../acp/server/custom_dispatch.rs` | Add dispatch | `#[custom_method(SetSessionModelConfigRequest)]` → `on_set_model_config()` |
| 3 | `goose/.../acp/server.rs` | Add handler | `on_set_model_config()` — like `on_set_model` but with `.with_request_params()` |
| 4 | `goose/.../acp/server/` (new) | New endpoint | Add `session/get_model_config_schema` discovery endpoint |
| 5 | `educlaw-server/.../model_poller.rs` | Modify | Use `SetSessionModelConfigRequest` when model has thinking params |
| 6 | `educlaw-web/.../AdminPage.tsx` | Modify UI | Dynamic thinking controls based on discovery schema |

**What's already working (no changes needed):**
- ✅ `ModelConfig.request_params` field and `with_request_params()` method
- ✅ `get_config_param()` unified lookup (request_params → env var → default)
- ✅ Database persistence (ModelConfig serialized to JSON with request_params)
- ✅ All providers handle null/empty params gracefully
- ✅ Non-thinking models silently ignore irrelevant params
- ✅ Standard `session/set_model` works unchanged — both methods coexist
- ✅ No sacp crate modification needed — custom method bypasses external dependency

**Critical constraint:**
- ⚠️ EduCraw MUST always use `_goose/session/set_model_config` (never `session/set_model`) because the standard method creates a fresh `ModelConfig` without `request_params`, overwriting any thinking config previously persisted. Even for non-thinking models, use the custom method with `request_params: null`.

---

## Future: Extending OpenAI to Use request_params

Currently OpenAI reads reasoning effort from model name suffix. A future enhancement would allow `request_params` to override this:

```rust
// Hypothetical future enhancement in formats/openai.rs or formats/openai_responses.rs
let (model_name, reasoning_effort) = extract_reasoning_effort(&model_config.model_name);

// Allow request_params to override the suffix-based effort
let reasoning_effort = model_config
    .get_config_param::<String>("reasoning_effort", "OPENAI_REASONING_EFFORT")
    .or(reasoning_effort);
```

This would let EduCraw set reasoning effort dynamically without changing model name — making the OpenAI experience consistent with Anthropic/Google.
