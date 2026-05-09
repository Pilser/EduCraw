# Goose Model & Provider Setting - Investigation Findings

## Overview

This document explains how Goose handles model/provider selection via ACP (Agent Client Protocol), and how EduCraw should implement provider+model switching.

---

## Key Finding: Model Name Does NOT Include Provider

**When you send a model name to Goose via ACP, you do NOT need to specify the company/provider separately.**

- The **provider is determined by the session's current provider setting**, not by parsing the model name
- Model names like `"deepseek-v4"` or `"gpt-4o"` are passed to `ModelConfig::new(model_id)` 
- Goose then calls `.with_canonical_limits(&provider_name)` using the **already-set provider name**

---

## How Goose Resolves Provider + Model

### 1. Provider Resolution (in `update_provider`)

**File:** `goose-workspace/crates/goose/src/acp/server.rs:2583-2676`

```rust
async fn update_provider(
    &self,
    thread_id: &str,
    provider_name: &str,        // ← Provider ID like "xai", "deepseek", "openai"
    model_name: Option<&str>,    // ← Just the model name, NO provider prefix needed
    context_limit: Option<usize>,
    request_params: Option<...>,
) -> Result<(), sacp::Error> {
    // Resolves provider from provider_name argument
    // If provider_name is "goose" (DEFAULT_PROVIDER_ID), reads from global config
    ...
    let model_config = crate::model::ModelConfig::new(model)
        .with_canonical_limits(&resolved_provider_name);  // ← Uses provider name here
    ...
}
```

### 2. Model Setting (in `on_set_model`)

**File:** `goose-workspace/crates/goose/src/acp/server.rs:2452-2489`

```rust
async fn on_set_model(
    &self,
    thread_id: &str,
    model_id: &str,           // ← Just "deepseek-v4", NOT "deepseek/deepseek-v4"
) -> Result<SetSessionModelResponse, sacp::Error> {
    let current_provider = agent.provider().await?;
    let provider_name = current_provider.get_name().to_string();  // ← Gets CURRENT provider
    
    let model_config = crate::model::ModelConfig::new(model_id)
        .with_canonical_limits(&provider_name);  // ← Uses existing provider
    ...
}
```

### 3. Session Stores Provider + Model Separately

**File:** `goose-workspace/crates/goose/src/session/session_manager.rs:56-86`

```rust
pub struct Session {
    pub provider_name: Option<String>,   // ← "xai", "deepseek", etc.
    pub model_config: Option<ModelConfig>, // ← Contains just model_name
    ...
}

pub struct ModelConfig {
    pub model_name: String,  // ← Just "deepseek-v4", no provider prefix
    pub context_limit: Option<usize>,
    ...
}
```

---

## ACP Protocol Methods for Setting Provider/Model

### Method 1: `SetSessionConfigOptionRequest` (General Purpose)

**Used for:** Setting provider, model, or mode

**File:** `goose-workspace/crates/goose/src/acp/server/dispatch.rs:91-131`

```rust
match config_id.as_ref() {
    "provider" => {
        // value_id.0 = provider ID like "xai", "deepseek", "openai"
        agent.update_provider(&session_id.0, &value_id.0, None, None, None).await
    }
    "model" => {
        // value_id.0 = model name like "deepseek-v4", "grok-3"
        agent.on_set_model(&session_id.0, &value_id.0).await
    }
    "mode" => {
        agent.on_set_mode(&session_id.0, &value_id.0).await
    }
    ...
}
```

**ACP Request Format:**
```json
{
  "sessionId": "thread_123",
  "configId": "provider",      // or "model"
  "value": "deepseek"          // provider ID or model name
}
```

### Method 2: `SetSessionModelRequest` (Model-Only, Simpler)

**File:** `goose-workspace/crates/goose/src/acp/server/dispatch.rs:307-327`

**ACP Request Format:**
```json
{
  "sessionId": "thread_123",
  "modelId": "deepseek-v4"     // Just the model name
}
```

**Note:** This uses the **current provider** from the session. It cannot switch providers.

---

## Switching from xAI to DeepSeek: Required Steps

### Step 1: Switch Provider (Required First)

```rust
// Send SetSessionConfigOptionRequest
SetSessionConfigOptionRequest {
    session_id: SessionId::new("thread_123"),
    config_id: ConfigId::new("provider"),
    value: ValueId::new("deepseek"),  // ← Provider ID
}
```

### Step 2: Switch Model (Now that provider is deepseek)

```rust
// Option A: SetSessionModelRequest (simpler)
SetSessionModelRequest {
    session_id: SessionId::new("thread_123"),
    model_id: ModelId::new("deepseek-v4"),
}

// Option B: SetSessionConfigOptionRequest (also works)
SetSessionConfigOptionRequest {
    session_id: SessionId::new("thread_123"),
    config_id: ConfigId::new("model"),
    value: ValueId::new("deepseek-v4"),
}
```

---

## Current EduCraw Implementation

### What EduCraw Currently Does:

**File:** `educlaw-server/src/acp_bridge/model_poller.rs:111-116`

```rust
// Only switches MODEL, assumes provider is already set
cx.send_request(SetSessionModelRequest::new(
    acp_session_id.clone(),
    model_name.clone(),  // e.g., "deepseek-v4"
))
```

**Limitation:** This only works if the provider is already set to the correct one. If switching from xAI to DeepSeek, this will fail because:
1. Current provider is still "xai"
2. `on_set_model` will try to create a DeepSeek model with xAI provider
3. This will likely fail or use wrong API endpoint

### What EduCraw Needs to Add:

**To properly support cross-provider model switching:**

```rust
// 1. First switch provider
cx.send_request(SetSessionConfigOptionRequest {
    session_id: acp_session_id.clone(),
    config_id: ConfigId::new("provider"),
    value: ValueId::new(provider_id),  // e.g., "deepseek"
}).block_task().await?;

// 2. Then switch model
cx.send_request(SetSessionModelRequest::new(
    acp_session_id.clone(),
    model_name.clone(),  // e.g., "deepseek-v4"
)).block_task().await?;
```

---

## Provider IDs in Goose

**File:** `goose-workspace/crates/goose/src/providers/mod.rs`

Common provider IDs (from registry):
- `"xai"` - xAI (Grok)
- `"openai"` - OpenAI
- `"anthropic"` - Anthropic (Claude)
- `"deepseek"` - DeepSeek
- `"google"` - Google (Gemini)
- `"ollama"` - Ollama (local)
- `"azure"` - Azure OpenAI
- And many more...

**To get the full list dynamically:**
```rust
// Send ListProvidersRequest
// Response contains ProviderInventoryEntryDto with providerId field
```

---

## Recommended Protocol for EduCraw

### For Model Switching (Same Provider):

**Use:** `SetSessionModelRequest`
- Simpler, single request
- Works when provider is already correct

### For Provider + Model Switching:

**Use:** `SetSessionConfigOptionRequest` (twice)
1. First set `config_id="provider"` with the new provider ID
2. Then set `config_id="model"` with the new model name

**OR** use `update_provider` directly (if you have access to the internal API):

```rust
// This single call can switch both provider and model at once:
update_provider(
    thread_id,
    "deepseek",           // provider_name
    Some("deepseek-v4"),  // model_name
    None,                 // context_limit (optional)
    None,                 // request_params (optional)
)
```

---

## Summary Table

| Scenario | Protocol Method | Provider Field | Model Field |
|----------|----------------|----------------|------------|
| Switch model (same provider) | `SetSessionModelRequest` | Implicit (current) | `modelId` |
| Switch model (same provider) | `SetSessionConfigOption` | - | `value` (configId="model") |
| Switch provider only | `SetSessionConfigOption` | `value` (configId="provider") | - |
| Switch provider + model | `SetSessionConfigOption` (x2) | `value` (configId="provider") | `value` (configId="model") |
| Switch provider + model (atomic) | Internal `update_provider()` | `provider_name` | `model_name` |

---

## Model Listing: The Missing Provider Info

### How EduCraw Currently Gets Models

**File:** `educlaw-server/src/acp_bridge/client.rs:268-281`

```rust
// Models come from NewSessionResponse.models (SessionModelState)
if let Some(model_state) = sess_resp.models {
    let model_names: Vec<String> = model_state
        .available_models
        .iter()
        .map(|m| m.name.clone())    // ← ONLY model name, NO provider info!
        .collect();
    *models_holder_spawn.lock().await = model_names.clone();
}
```

**Problem:** `SessionModelState` does NOT include provider info for each model!

### SessionModelState vs ListProvidersResponse

| Source | Has Provider Info? | Format |
|--------|-------------------|--------|
| `NewSessionResponse.models` (SessionModelState) | ❌ NO | `Vec<ModelInfo>` with just `model_id` and `name` |
| `ListProvidersResponse` (ListProviders) | ✅ YES | `Vec<ProviderInventoryEntryDto>` with `provider_id` + `models` array |

### What ListProviders Returns

**File:** `goose-workspace/crates/goose/src/acp/server/providers.rs:336-348`

```rust
// ListProvidersResponse contains:
ProviderInventoryEntryDto {
    provider_id: "deepseek",       // ← Provider ID
    provider_name: "DeepSeek",
    models: [
        ProviderInventoryModelDto {
            id: "deepseek-v4",     // ← Model ID
            name: "DeepSeek V4",    // ← Display name
            context_limit: 128000,
            ...
        },
        ...
    ],
    ...
}
```

### The Bug in EduCraw

1. EduCraw stores `available_models` as `Arc<Mutex<Vec<String>>>` (just model names)
2. When user selects "deepseek-v4" from the UI, EduCraw doesn't know it belongs to provider "deepseek"
3. `model_poller.rs` sends `SetSessionModelRequest` WITHOUT switching provider first
4. This fails because the current provider is still "xai"

---

## How to Fix EduCraw

### Option A: Use ListProviders (Recommended)

```rust
// 1. Call ListProviders to get provider+model mapping
let providers_resp = cx.send_request(ListProvidersRequest::new()).block_task().await?;

// 2. Store as (provider_id, model_name) tuples
let mut model_provider_map: Vec<(String, String)> = Vec::new();
for entry in providers_resp.entries {
    for model in entry.models {
        model_provider_map.push((entry.provider_id.clone(), model.id.clone()));
    }
}

// 3. When switching models, check if provider needs to change
let (provider_id, model_name) = find_model(&model_provider_map, &selected_model);
if current_provider != provider_id {
    // Switch provider first
    cx.send_request(SetSessionConfigOptionRequest {
        session_id: session_id.clone(),
        config_id: ConfigId::new("provider"),
        value: ValueId::new(&provider_id),
    }).block_task().await?;
}

// Then switch model
cx.send_request(SetSessionModelRequest::new(session_id, model_name)).block_task().await?;
```

### Option B: Infer Provider from Model Name

**Not recommended** - unreliable and error-prone.

### Option C: Let Goose Handle It

Modify `update_provider` to accept a model name and auto-detect the provider.

---

## Key Takeaways

1. **Model names do NOT include provider prefix** - Just use `"deepseek-v4"`, not `"deepseek/deepseek-v4"`
2. **Provider must be set BEFORE switching to that provider's models**
3. **Use `SetSessionConfigOptionRequest` with `configId="provider"` to switch providers**
4. **EduCraw needs to add provider switching logic** before model switching in `model_poller.rs`
5. **EduCraw's current model list is INCOMPLETE** - it doesn't store which provider each model belongs to
6. **Use `ListProviders` to get the full provider+model mapping** with provider IDs
7. The ACP protocol expects provider ID (like `"deepseek"`), NOT company name (like `"DeepSeek"`)
