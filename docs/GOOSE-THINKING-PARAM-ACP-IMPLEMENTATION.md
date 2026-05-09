# Goose Thinking Parameters via ACP - Implementation Guide

## Overview

This document details how thinking/thinking_strength parameters can be exposed via the ACP (Agent Client Protocol) to allow dynamic configuration of model thinking levels for providers that support it (Anthropic, Google Gemini, OpenAI reasoning models, DeepSeek R1, etc.).

---

## Current State Analysis

### What's Already Implemented ✅

| Component | Status | Location |
|-----------|--------|----------|
| **ModelConfig with request_params** | ✅ Implemented | `goose-workspace/crates/goose/src/model.rs:47-62` |
| **Database persistence** | ✅ Implemented | `goose-workspace/crates/goose/src/session/session_manager.rs:782-816` |
| **Provider reading params** | ✅ Implemented | `formats/anthropic.rs:56`, `formats/google.rs:545-570` |
| **ACP SetSessionModel API** | ⚠️ Partial | Only accepts `model_id`, no request_params |

### Providers Supporting Thinking Config

| Provider | Parameter | Values | Location |
|----------|-----------|--------|----------|
| **Anthropic (Claude)** | `thinking_type` | `disabled`, `enabled`, `adaptive` | `formats/anthropic.rs:47-82` |
| | `thinking_budget` | Token count (e.g., 16000) | `formats/anthropic.rs:491-506` |
| | `thinking_effort` | `low`, `medium`, `high`, `max` | `formats/anthropic.rs:471-479` |
| **Google Gemini 3** | `thinking_level` | `low`, `high` | `formats/google.rs:545-564` |
| **Google Gemini 2.5** | `thinking_budget` | Token count | `formats/google.rs:569-590` |
| **OpenAI (o1/o3/gpt-5)** | Model name suffix | `-none`, `-low`, `-medium`, `-high`, `-xhigh` | `providers/utils.rs:221-238` |
| **Databricks** | `thinking_type`, `effort` | Via Anthropic format | `formats/databricks.rs:235-249` |

---

## Flow Diagram: SetSessionModel API → Persistence → LLM Client

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. ACP REQUEST                                                               │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ SetSessionModelRequest {                                                  │ │
│ │   session_id: "thread-123",                                              │ │
│ │   model_id: "claude-sonnet-4",                                          │ │
│ │   request_params: {  ← NEEDS TO BE ADDED                                │ │
│ │     "thinking_type": "enabled",                                         │ │
│ │     "thinking_budget": 16000                                             │ │
│ │   }                                                                      │ │
│ │ }                                                                        │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. on_set_model HANDLER (acp/server.rs:2452-2489)                          │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ let model_config = ModelConfig::new(model_id)                           │ │
│ │     .with_canonical_limits(&provider_name);                             │ │
│ │     .with_request_params(request_params);  ← NEEDS TO BE ADDED         │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. SESSION STORAGE (Persistence Layer)                                      │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Session {                                                               │ │
│ │   model_config: Some(ModelConfig {                                     │ │
│ │     model_name: "claude-sonnet-4",                                      │ │
│ │     request_params: Some({                                              │ │
│ │       "thinking_type": "enabled"                                        │ │
│ │     })                                                                  │ │
│ │   })                                                                    │ │
│ │ }                                                                       │ │
│ │                                                                          │ │
│ │ Database: sessions.model_config_json (TEXT)                             │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. LLM CLIENT (Provider Format)                                              │
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

---

## Files to Modify

### 1. ACP Schema - Add request_params to SetSessionModelRequest

**File:** `sacp-source/acp-schema-source/src/agent.rs:3309-3344`

**Current code:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct SetSessionModelRequest {
    /// The ID of the session to set the model for.
    pub session_id: SessionId,
    /// The ID of the model to set.
    pub model_id: ModelId,
    #[serde(skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Meta>,
}
```

**Modified code:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct SetSessionModelRequest {
    /// The ID of the session to set the model for.
    pub session_id: SessionId,
    /// The ID of the model to set.
    pub model_id: ModelId,
    /// Optional provider-specific parameters (e.g., thinking_type, thinking_budget)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_params: Option<std::collections::HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Meta>,
}
```

**Why:** The ACP protocol currently doesn't allow passing arbitrary parameters along with the model ID. Adding `request_params` enables clients (like EduCraw) to specify thinking configuration dynamically.

---

### 2. Goose on_set_model Handler - Accept and pass request_params

**File:** `goose-workspace/crates/goose/src/acp/server.rs:2452-2489`

**Current code:**
```rust
async fn on_set_model(
    &self,
    thread_id: &str,
    model_id: &str,
) -> Result<SetSessionModelResponse, sacp::Error> {
    // ... get current provider ...
    let provider_name = current_provider.get_name().to_string();
    let extensions = EnabledExtensionsState::for_session(&self.session_manager, &internal_id, &config).await;
    
    // Line 2467-2469: Only creates ModelConfig from model_id
    let model_config = crate::model::ModelConfig::new(model_id)
        .invalid_params_err_ctx("Invalid model config")?
        .with_canonical_limits(&provider_name);
    
    // ... create and update provider ...
}
```

**Modified code:**
```rust
async fn on_set_model(
    &self,
    thread_id: &str,
    model_id: &str,
    request_params: Option<std::collections::HashMap<String, serde_json::Value>>,  // ← ADD PARAMETER
) -> Result<SetSessionModelResponse, sacp::Error> {
    let internal_id = self.internal_session_id(thread_id).await?;
    let config = self.config()?;
    let agent = self.get_session_agent_provider_ready(thread_id).await?;
    let current_provider = agent.provider().await.internal_err_ctx("Failed to get provider")?;
    let provider_name = current_provider.get_name().to_string();
    let extensions = EnabledExtensionsState::for_session(&self.session_manager, &internal_id, &config).await;
    
    // Line 2467-2471: Creates ModelConfig WITH request_params
    let mut model_config = crate::model::ModelConfig::new(model_id)
        .invalid_params_err_ctx("Invalid model config")?
        .with_canonical_limits(&provider_name);
    
    // If request_params provided, add them to ModelConfig
    if let Some(params) = request_params {
        model_config = model_config.with_request_params(Some(params));
    }
    
    let provider = self.create_provider(&provider_name, model_config, extensions)
        .await.internal_err_ctx("Failed to create provider")?;
    agent.update_provider(provider, &internal_id)
        .await.internal_err_ctx("Failed to update provider")?;
    
    // ... rest unchanged ...
}
```

**Why:** The handler needs to accept the request_params and pass them to ModelConfig, which already has `with_request_params()` method available.

---

### 3. Dispatch - Pass request_params to on_set_model

**File:** `goose-workspace/crates/goose/src/acp/server/dispatch.rs:310-315`

**Current code:**
```rust
|req: SetSessionModelRequest, responder: Responder<SetSessionModelResponse>| async move {
    let session_id = req.session_id.clone();
    match agent.on_set_model(&session_id.0, &req.model_id.0).await {
        // ...
    }
}
```

**Modified code:**
```rust
|req: SetSessionModelRequest, responder: Responder<SetSessionModelResponse>| async move {
    let session_id = req.session_id.clone();
    match agent.on_set_model(
        &session_id.0,
        &req.model_id.0,
        req.request_params  // ← Pass request_params from ACP request
    ).await {
        // ...
    }
}
```

**Why:** The dispatch layer receives the ACP request and needs to forward the request_params to the handler.

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

### Saving ModelConfig

**File:** `goose-workspace/crates/goose/src/session/session_manager.rs:782-816`

```rust
let model_config_json = match &session.model_config {
    Some(model_config) => Some(serde_json::to_string(model_config)?),
    None => None,
};

// INSERT INTO sessions (..., model_config_json, ...)
.bind(model_config_json)
```

The `ModelConfig` is serialized to JSON (including `request_params`) and stored in the database.

### Loading ModelConfig

When a session is loaded, the `model_config_json` is deserialized back into `ModelConfig`:

```rust
model_config: row.try_get("model_config_json")?
    .map(|json| serde_json::from_str(&json))
    .transpose()?
```

---

## Do LLM Clients Accept Empty/Null Parameters for Non-Thinking Models?

### Short Answer: YES ✅

All provider implementations handle null/empty parameters gracefully:

### 1. Anthropic (`formats/anthropic.rs:47-82`)

```rust
pub fn thinking_type(model_config: &ModelConfig) -> ThinkingType {
    // get_config_param returns None if not set
    let tt = model_config
        .get_config_param::<String>("thinking_type", "CLAUDE_THINKING_TYPE")
        .unwrap_or(ThinkingType::Disabled);
    
    if tt == ThinkingType::Adaptive && !is_adaptive_model {
        return ThinkingType::Disabled;  // Gracefully falls back
    }
    tt
}
```

If `thinking_type` is not in `request_params`, it falls back to env var `CLAUDE_THINKING_TYPE`, and if that's also not set, defaults to `Disabled`.

### 2. Google Gemini (`formats/google.rs:536-590`)

```rust
fn get_thinking_config(model_config: &ModelConfig) -> Option<ThinkingConfig> {
    let model_name = model_config.model_name.to_lowercase();
    let is_gemini_3 = model_name.starts_with("gemini-3");
    let is_gemini_25 = model_name.starts_with("gemini-2.5");
    
    if !is_gemini_3 && !is_gemini_25 {
        return None;  // Gracefully returns None for non-thinking models
    }
    
    // Only applies thinking config for supported models
    // ...
}
```

If the model is not a thinking model (doesn't start with `gemini-3` or `gemini-2.5`), it gracefully returns `None`.

### 3. OpenAI (`providers/utils.rs:221-238`)

```rust
pub fn extract_reasoning_effort(model_name: &str) -> (String, Option<String>) {
    if !is_openai_responses_model(model_name) {
        return (model_name.to_string(), None);  // Not a reasoning model
    }
    
    // Only extracts effort suffix if present
    // Otherwise returns None
}
```

If model is not a reasoning model or has no effort suffix, returns `None`.

---

## Test: Null/Empty request_params Behavior

Here's how the system handles various scenarios:

| Scenario | request_params | Result |
|----------|-----------------|--------|
| **Empty map** | `{}` | Provider sees empty - no thinking config used |
| **Null** | `null` | Uses env var defaults or model defaults |
| **Wrong key** | `{"temperature": 0.5}` | Ignored - thinking not affected |
| **Valid key** | `{"thinking_type": "enabled"}` | Thinking enabled |
| **Non-thinking model** | `{"thinking_type": "enabled"}` | Gracefully ignored by provider |

---

## Usage Examples

### Example 1: Enable Thinking for Claude Sonnet 4

**ACP Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "method": "session/set_model",
  "params": {
    "sessionId": "thread-456",
    "modelId": "claude-sonnet-4-20250514",
    "requestParams": {
      "thinking_type": "enabled",
      "thinking_budget": 16000
    }
  }
}
```

**Result:** Claude will use thinking with 16000 token budget.

---

### Example 2: Set Thinking Level for Gemini 2.5

**ACP Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "req-124",
  "method": "session/set_model",
  "params": {
    "sessionId": "thread-456",
    "modelId": "gemini-2.5-flash",
    "requestParams": {
      "thinking_budget": 8192
    }
  }
}
```

**Result:** Gemini 2.5 will use 8192 thinking budget.

---

### Example 3: Change to Non-Thinking Model (No params)

**ACP Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "req-125",
  "method": "session/set_model",
  "params": {
    "sessionId": "thread-456",
    "modelId": "gpt-4o"
  }
}
```

**Result:** Thinking params ignored - GPT-4o doesn't support thinking.

---

## EduCraw Integration

Once implemented, EduCraw can call:

```python
# Example: Enable thinking via ACP
acp_request = {
    "method": "session/set_model",
    "params": {
        "sessionId": thread_id,
        "modelId": "claude-sonnet-4-20250514",
        "requestParams": {
            "thinking_type": "enabled",
            "thinking_budget": 16000
        }
    }
}
```

---

## Summary: Changes Required

| File | Change Type | Lines |
|------|-------------|-------|
| `sacp-source/acp-schema-source/src/agent.rs` | Add `request_params` field to `SetSessionModelRequest` | 3309-3344 |
| `goose-workspace/crates/goose/src/acp/server.rs` | Accept and pass `request_params` to `ModelConfig` | 2452-2489 |
| `goose-workspace/crates/goose/src/acp/server/dispatch.rs` | Forward `request_params` to handler | 310-315 |

**What's already working:**
- ✅ Database persistence (ModelConfig already includes request_params)
- ✅ Provider reading (get_config_param works with null/empty)
- ✅ Null safety (non-thinking models gracefully ignore params)