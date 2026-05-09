# Goose ACP Token Usage - Complete Truth

## Overview

This document maps exactly how token usage (input, output, cache) flows from each LLM provider → Goose provider layer → Session storage → ACP protocol → EduCraw.

---

## Provider-Level Token Handling

### 1. Anthropic Provider

**File:** `goose-workspace/crates/goose/src/providers/formats/anthropic.rs`

**API returns:**
```json
{
  "usage": {
    "input_tokens": 150,
    "cache_creation_input_tokens": 50,
    "cache_read_input_tokens": 30,
    "output_tokens": 100
  }
}
```

**Current implementation (lines 374-468):**
```rust
// Lines 379-397: Reads all fields correctly
let input_tokens = usage.get("input_tokens")...        // 150
let cache_creation_tokens = usage.get("cache_creation_input_tokens")...  // 50
let cache_read_tokens = usage.get("cache_read_input_tokens")...       // 30
let output_tokens = usage.get("output_tokens")...         // 100

// Line 401: COMBINES cache into input_tokens
let total_input_tokens = input_tokens + cache_creation_tokens + cache_read_tokens; // 230

// Lines 409-413: Creates Usage WITHOUT cache tokens
Ok(Usage::new(
    Some(total_input_i32),   // 230 (includes cache!)
    Some(output_tokens_i32), // 100
    Some(total_tokens_i32), // 330
))
// ❌ with_cache_tokens() is NOT called
```

**Result:** Cache tokens are **LOST** - hidden inside `input_tokens` with no way to distinguish them.

---

### 2. OpenAI Provider

**File:** `goose-workspace/crates/goose/src/providers/formats/openai.rs`

**API returns:**
```json
{
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 100,
    "total_tokens": 250,
    "cache_read_input_tokens": 30,
    "cache_creation_input_tokens": 50
  }
}
```

**Current implementation (lines 613-657):**
```rust
// Lines 624-644: Reads all fields correctly
let input_tokens = usage.get("prompt_tokens")...;              // 150
let output_tokens = usage.get("completion_tokens")...;           // 100
let cache_read_input_tokens = usage.get("cache_read_input_tokens")...;    // 30 ✅
let cache_write_input_tokens = usage.get("cache_creation_input_tokens")...; // 50 ✅

// Lines 655-656: DOES call with_cache_tokens!
Usage::new(input_tokens, output_tokens, total_tokens)
    .with_cache_tokens(cache_read_input_tokens, cache_write_input_tokens)  // ✅
```

**Result:** Cache tokens are **PRESERVED** in the `Usage` struct. ✅

---

### 3. Google/Gemini Provider

**File:** `goose-workspace/crates/goose/src/providers/formats/google.rs`

**API returns:**
```json
{
  "usageMetadata": {
    "promptTokenCount": 150,
    "candidatesTokenCount": 100,
    "totalTokenCount": 250,
    "cachedContentTokenCount": 40    // ← Google's cache field
  }
}
```

**Current implementation (lines 334-358):**
```rust
// Lines 337-348: Only reads 3 fields, IGNORES cachedContentTokenCount
let input_tokens = usage_meta_data.get("promptTokenCount")...;      // 150
let output_tokens = usage_meta_data.get("candidatesTokenCount")...;  // 100
let total_tokens = usage_meta_data.get("totalTokenCount")...;        // 250
// ❌ cachedContentTokenCount is NEVER read!

// Line 349: Creates Usage WITHOUT cache tokens
Ok(Usage::new(input_tokens, output_tokens, total_tokens))
// ❌ with_cache_tokens() is NOT called
```

**Result:** Google's `cachedContentTokenCount` is **NEVER READ** - cache tokens are completely lost. ❌

---

### 4. DeepSeek Provider (via custom_deepseek → OpenAI-compatible path)

**File:** `goose-workspace/crates/goose/src/providers/formats/openai.rs` (same as OpenAI)

**API returns (DeepSeek format):**
```json
{
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 100,
    "total_tokens": 250,
    "prompt_cache_hit_tokens": 30,    // ← DeepSeek's cache field
    "prompt_cache_miss_tokens": 50    // ← DeepSeek's cache field
  }
}
```

**Current implementation (lines 636-656):**
```rust
// Lines 636-644: Reads WRONG field names for DeepSeek!
let cache_read_input_tokens = usage.get("cache_read_input_tokens")...;       // null (DeepSeek doesn't send this!)
let cache_write_input_tokens = usage.get("cache_creation_input_tokens")...; // null (DeepSeek doesn't send this!)
// ❌ DeepSeek sends "prompt_cache_hit_tokens" and "prompt_cache_miss_tokens"
//    but the code reads "cache_read_input_tokens" and "cache_creation_input_tokens"

// Lines 655-656:
Usage::new(input_tokens, output_tokens, total_tokens)
    .with_cache_tokens(cache_read_input_tokens, cache_write_input_tokens)
    // Both are None because field names don't match!
```

**Result:** DeepSeek's cache tokens are **NEVER CAPTURED** because the field names don't match. ❌

---

### 5. xAI/Grok Provider (via OpenAiCompatibleProvider → OpenAI path)

**File:** `goose-workspace/crates/goose/src/providers/xai.rs` (uses `OpenAiCompatibleProvider`)

**Path:** `xai.rs` → `OpenAiCompatibleProvider` → `formats/openai.rs::get_usage()`

**Result:** If xAI sends standard OpenAI cache fields (`cache_read_input_tokens`, `cache_creation_input_tokens`), cache tokens **ARE PRESERVED**. ✅  
If xAI uses different field names, cache tokens are lost (same issue as DeepSeek).

---

### 6. OpenRouter Provider (via custom provider → OpenAI path)

**File:** `goose-workspace/crates/goose/src/providers/openrouter.rs`

**Path:** `openrouter.rs` → `formats/openai.rs::create_request()` and `stream_openai_compat()` → `formats/openai.rs::get_usage()`

**Note:** The `X-OpenRouter-Cache` header mentioned in the investigation prompt is **NOT implemented** anywhere in the Goose codebase. Searching for it returns no results.

**Result:** Uses the same OpenAI-compatible path. If OpenRouter normalizes cache fields to `cache_read_input_tokens`/`cache_creation_input_tokens`, cache tokens **ARE PRESERVED**. ✅

---

## Upstream Token Loss Points (ALL Providers)

Even when a provider correctly populates `Usage.cache_read_input_tokens` and `Usage.cache_write_input_tokens` (like OpenAI), the tokens are lost at these points:

### Loss Point 1: Session Update (DROPS cache tokens)

**File:** `goose-workspace/crates/goose/src/agents/reply_parts.rs`  
**Lines:** 465-514

```rust
pub(crate) async fn update_session_metrics(
    &self,
    session_id: &str,
    schedule_id: Option<String>,
    usage: &ProviderUsage,
    is_compaction_usage: bool,
) -> Result<()> {
    let manager = self.config.session_manager.clone();
    let session = manager.get_session(session_id, false).await?;

    // Lines 482-487: Only accumulates total, input, output
    let accumulated_total = accumulate(session.accumulated_total_tokens, usage.usage.total_tokens);
    let accumulated_input = accumulate(session.accumulated_input_tokens, usage.usage.input_tokens);
    let accumulated_output = accumulate(session.accumulated_output_tokens, usage.usage.output_tokens);
    // ❌ cache_read_input_tokens is NEVER accumulated
    // ❌ cache_write_input_tokens is NEVER accumulated

    // Lines 501-511: Only saves total, input, output to Session
    manager.update(session_id)
        .total_tokens(current_total)              // saves total
        .input_tokens(current_input)             // saves input (with cache hidden inside for Anthropic)
        .output_tokens(current_output)           // saves output
        // ❌ NO .cache_read_input_tokens()
        // ❌ NO .cache_write_input_tokens()
        .accumulated_total_tokens(accumulated_total)
        .accumulated_input_tokens(accumulated_input)
        .accumulated_output_tokens(accumulated_output)
        .apply().await?;
    // Cache tokens are DROPPED here
}
```

### Loss Point 2: ACP PromptResponse (DOES NOT populate cache fields)

**File:** `goose-workspace/crates/goose/src/acp/server.rs`  
**Lines:** 790-795

```rust
fn build_prompt_usage(session: &Session) -> Option<Usage> {
    let total = to_nonnegative_u64(session.total_tokens)?;   // 330 (includes cache for Anthropic)
    let input = to_nonnegative_u64(session.input_tokens).unwrap_or(0); // 230 (includes cache!)
    let output = to_nonnegative_u64(session.output_tokens).unwrap_or(0); // 100

    // Line 794: Creates Usage WITHOUT cache tokens
    Some(Usage::new(total, input, output))
    // ❌ cached_read_tokens and cached_write_tokens are left as None
    //    (the Usage::new() default sets them to None)
}
```

**Note:** The SACP protocol's `Usage` struct (in `sacp-source/acp-schema-source/src/agent.rs:3120-3136`) **DOES have** cache fields:
```rust
pub struct Usage {
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub thought_tokens: Option<u64>,
    pub cached_read_tokens: Option<u64>,  // ✅ Exists in protocol
    pub cached_write_tokens: Option<u64>, // ✅ Exists in protocol
}
```

But `build_prompt_usage` never populates them.

### Loss Point 3: ACP UsageUpdate Notification (NO cache info at all)

**File:** `goose-workspace/crates/goose/src/acp/server.rs`  
**Lines:** 797-799

```rust
fn build_usage_update(session: &Session, context_limit: usize) -> UsageUpdate {
    let used = session.total_tokens.unwrap_or(0).max(0) as u64;  // Just total tokens
    UsageUpdate::new(used, context_limit as u64)
    // Only sends: { "used": 330, "size": 200000 }
    // ❌ No cache breakdown
    // ❌ No input/output split
}
```

**Note:** The `UsageUpdate` struct (in `sacp-source/acp-schema-source/src/client.rs:255-270`) does NOT have cache fields:
```rust
pub struct UsageUpdate {
    pub used: u64,   // Total tokens in context
    pub size: u64,   // Context window size
    pub cost: Option<Cost>,
    pub meta: Option<Meta>,
    // ❌ No cached_read_tokens
    // ❌ No cached_write_tokens
}
```

---

## Session Struct (Missing Cache Fields)

**File:** `goose-workspace/crates/goose/src/session/session_manager.rs`  
**Lines:** 56-86

```rust
pub struct Session {
    pub total_tokens: Option<i32>,              // 330 (includes cache for Anthropic)
    pub input_tokens: Option<i32>,              // 230 (includes cache!)
    pub output_tokens: Option<i32>,             // 100
    pub accumulated_total_tokens: Option<i32>,
    pub accumulated_input_tokens: Option<i32>,
    pub accumulated_output_tokens: Option<i32>,
    // ❌ NO cache_read_input_tokens field
    // ❌ NO cache_write_input_tokens field
    // ❌ NO accumulated_cache_read_tokens field
    // ❌ NO accumulated_cache_write_tokens field
}
```

---

## What EduCraw Receives

### Via PromptResponse (from `build_prompt_usage`):

```json
{
  "usage": {
    "total": 330,    // input(230) + output(100) -- includes cache for Anthropic
    "input": 230,     // ⚠️ Includes cache tokens (for Anthropic), pure input (for OpenAI)
    "output": 100,
    "cachedReadTokens": null,   // ❌ Never populated (always null)
    "cachedWriteTokens": null   // ❌ Never populated (always null)
  }
}
```

### Via UsageUpdate notification (from `build_usage_update`):

```json
{
  "used": 330,      // Just total tokens (includes cache for Anthropic)
  "size": 200000  // Context window size
}
```

### In EduCraw's `spawn_token_accounting` handler:

**File:** `educlaw-server/src/acp_bridge/notifications.rs:246-262`

```rust
pub fn spawn_token_accounting(
    pool: SqlitePool,
    session_id: String,
    student_id: String,
    model_name: String,
    used: i64,  // ❌ This is session.total_tokens (includes cache!)
) {
    let tokens = db_tokens::TurnTokens {
        model: model_name,
        input_tokens: used,              // ❌ Wrong: should be just input, not total
        output_tokens: 0,                 // ❌ Not set!
        cache_creation_input_tokens: 0,    // ❌ Always 0 (never sent by Goose)
        cache_read_input_tokens: 0,        // ❌ Always 0 (never sent by Goose)
    };
}
```

---

## Summary Table

| Provider | Cache Fields Read? | Cache in Usage Struct? | Cache Saved to Session? | Cache in ACP Response? |
|----------|-------------------|------------------------|------------------------|----------------------|
| **Anthropic** | ✅ Yes (all 3 fields) | ❌ No (combined into input) | ❌ No | ❌ No |
| **OpenAI** | ✅ Yes | ✅ Yes | ❌ No (dropped at session) | ❌ No (not wired to ACP) |
| **Google/Gemini** | ❌ No (`cachedContentTokenCount` ignored) | ❌ No | ❌ No | ❌ No |
| **DeepSeek** | ❌ No (wrong field names) | ❌ No | ❌ No | ❌ No |
| **xAI/Grok** | ✅ Yes (if using standard fields) | ✅ Yes | ❌ No (dropped at session) | ❌ No |
| **OpenRouter** | ✅ Yes (if normalized to standard) | ✅ Yes | ❌ No (dropped at session) | ❌ No |

---

## Modifications Needed in Goose to Send Full Token Usage

### Fix 1: Anthropic Provider - Separate cache tokens

**File:** `goose-workspace/crates/goose/src/providers/formats/anthropic.rs`  
**Lines:** 409-413

**Change:**
```rust
// BEFORE (lines 409-413):
Ok(Usage::new(
    Some(total_input_i32),
    Some(output_tokens_i32),
    Some(total_tokens_i32),
))

// AFTER:
Ok(Usage::new(
    Some(input_tokens as i32),  // Pure input only (150, not 230)
    Some(output_tokens_i32),
    Some(total_tokens_i32),
).with_cache_tokens(
    Some(cache_read_tokens as i32),    // 30
    Some(cache_creation_tokens as i32), // 50
))
```

---

### Fix 2: Google Provider - Read cachedContentTokenCount

**File:** `goose-workspace/crates/goose/src/providers/formats/google.rs`  
**Lines:** 335-349

**Change:**
```rust
// BEFORE (lines 335-349):
pub fn get_usage(data: &Value) -> Result<Usage> {
    if let Some(usage_meta_data) = data.get("usageMetadata") {
        let input_tokens = usage_meta_data.get("promptTokenCount")...;
        let output_tokens = usage_meta_data.get("candidatesTokenCount")...;
        let total_tokens = usage_meta_data.get("totalTokenCount")...;
        // ❌ Missing: cachedContentTokenCount
        Ok(Usage::new(input_tokens, output_tokens, total_tokens))
    }
}

// AFTER:
pub fn get_usage(data: &Value) -> Result<Usage> {
    if let Some(usage_meta_data) = data.get("usageMetadata") {
        let input_tokens = usage_meta_data.get("promptTokenCount")...;
        let output_tokens = usage_meta_data.get("candidatesTokenCount")...;
        let total_tokens = usage_meta_data.get("totalTokenCount")...;
        let cached_content_tokens = usage_meta_data
            .get("cachedContentTokenCount")
            .and_then(|v| v.as_u64())
            .map(|v| v as i32);

        Ok(Usage::new(input_tokens, output_tokens, total_tokens)
            .with_cache_tokens(cached_content_tokens, None))
    }
}
```

---

### Fix 3: DeepSeek Provider - Read correct field names

**File:** `goose-workspace/crates/goose/src/providers/formats/openai.rs`  
**Lines:** 636-656

**Option A (Recommended):** Add DeepSeek-specific cache field reading in the `get_usage` function:
```rust
// In get_usage(), after reading cache_read_input_tokens and cache_write_input_tokens:

// Add DeepSeek support:
let cache_read_input_tokens = usage
    .get("cache_read_input_tokens")
    .or_else(|| usage.get("prompt_cache_hit_tokens"))  // DeepSeek field
    .and_then(|v| v.as_i64())
    .map(|v| v as i32);

let cache_write_input_tokens = usage
    .get("cache_creation_input_tokens")
    .or_else(|| usage.get("prompt_cache_miss_tokens"))  // DeepSeek field
    .and_then(|v| v.as_i64())
    .map(|v| v as i32);
```

**Option B:** Create a separate `formats/deepseek.rs` that handles DeepSeek-specific fields.

---

### Fix 4: Session Struct - Add cache token fields

**File:** `goose-workspace/crates/goose/src/session/session_manager.rs`  
**Lines:** 56-86

**Change:**
```rust
pub struct Session {
    pub total_tokens: Option<i32>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub cache_read_input_tokens: Option<i32>,      // ✅ NEW
    pub cache_write_input_tokens: Option<i32>,     // ✅ NEW
    pub accumulated_total_tokens: Option<i32>,
    pub accumulated_input_tokens: Option<i32>,
    pub accumulated_output_tokens: Option<i32>,
    pub accumulated_cache_read_tokens: Option<i32>,     // ✅ NEW
    pub accumulated_cache_write_tokens: Option<i32>,    // ✅ NEW
    // ... rest of fields
}
```

Also update `SessionUpdateBuilder` (lines 88-109) to include the new fields.

---

### Fix 5: Session Update - Save cache tokens

**File:** `goose-workspace/crates/goose/src/agents/reply_parts.rs`  
**Lines:** 482-511

**Change:**
```rust
// Add cache accumulation:
let accumulated_cache_read = accumulate(
    session.accumulated_cache_read_tokens,
    usage.usage.cache_read_input_tokens,
);
let accumulated_cache_write = accumulate(
    session.accumulated_cache_write_tokens,
    usage.usage.cache_write_input_tokens,
);

// Save to session:
manager.update(session_id)
    .total_tokens(current_total)
    .input_tokens(current_input)
    .output_tokens(current_output)
    .cache_read_input_tokens(usage.usage.cache_read_input_tokens)      // ✅ NEW
    .cache_write_input_tokens(usage.usage.cache_write_input_tokens)     // ✅ NEW
    .accumulated_total_tokens(accumulated_total)
    .accumulated_input_tokens(accumulated_input)
    .accumulated_output_tokens(accumulated_output)
    .accumulated_cache_read_tokens(accumulated_cache_read)          // ✅ NEW
    .accumulated_cache_write_tokens(accumulated_cache_write)         // ✅ NEW
    .apply().await?;
```

---

### Fix 6: ACP PromptResponse - Populate cache fields

**File:** `goose-workspace/crates/goose/src/acp/server.rs`  
**Lines:** 790-795

**Change:**
```rust
// BEFORE:
fn build_prompt_usage(session: &Session) -> Option<Usage> {
    let total = to_nonnegative_u64(session.total_tokens)?;
    let input = to_nonnegative_u64(session.input_tokens).unwrap_or(0);
    let output = to_nonnegative_u64(session.output_tokens).unwrap_or(0);
    Some(Usage::new(total, input, output))
}

// AFTER:
fn build_prompt_usage(session: &Session) -> Option<Usage> {
    let total = to_nonnegative_u64(session.total_tokens)?;
    let input = to_nonnegative_u64(session.input_tokens).unwrap_or(0);
    let output = to_nonnegative_u64(session.output_tokens).unwrap_or(0);
    let cache_read = to_nonnegative_u64(session.cache_read_input_tokens).unwrap_or(0);
    let cache_write = to_nonnegative_u64(session.cache_write_input_tokens).unwrap_or(0);

    Some(Usage::new(total, input, output)
        .with_cache_tokens(cache_read, cache_write))
}
```

---

### Fix 7: ACP UsageUpdate - Add cache info (Optional)

**File:** `goose-workspace/crates/goose/src/acp/server.rs`  
**Lines:** 797-799

**Note:** The `UsageUpdate` struct in SACP schema does NOT have cache fields. You would need to:
1. Add cache fields to `UsageUpdate` in the SACP schema (requires modifying `sacp-source/acp-schema-source/src/client.rs`)
2. Or use the `_meta` field to attach cache info as metadata

**Option A (Modify SACP schema):**
```rust
// In sacp-source/acp-schema-source/src/client.rs, UsageUpdate struct:
pub struct UsageUpdate {
    pub used: u64,
    pub size: u64,
    pub cache_read_tokens: Option<u64>,   // ✅ NEW
    pub cache_write_tokens: Option<u64>,  // ✅ NEW
    pub cost: Option<Cost>,
    pub meta: Option<Meta>,
}
```

**Option B (Use _meta for now):**
```rust
fn build_usage_update(session: &Session, context_limit: usize) -> UsageUpdate {
    let used = session.total_tokens.unwrap_or(0).max(0) as u64;
    let mut usage_update = UsageUpdate::new(used, context_limit as u64);

    // Attach cache info via meta
    let mut meta = HashMap::new();
    if let Some(cache_read) = session.cache_read_input_tokens {
        meta.insert("cache_read_tokens".to_string(), json!(cache_read));
    }
    if let Some(cache_write) = session.cache_write_input_tokens {
        meta.insert("cache_write_tokens".to_string(), json!(cache_write));
    }
    if !meta.is_empty() {
        usage_update = usage_update.meta(serde_json::to_value(meta).ok());
    }

    usage_update
}
```

---

## Files That Need Modification (Summary)

| File | Lines | Change |
|-----|-------|-------|
| `goose-workspace/crates/goose/src/providers/formats/anthropic.rs` | 409-413 | Call `with_cache_tokens()` to separate cache from input |
| `goose-workspace/crates/goose/src/providers/formats/google.rs` | 335-349 | Read `cachedContentTokenCount` and call `with_cache_tokens()` |
| `goose-workspace/crates/goose/src/providers/formats/openai.rs` | 636-656 | Add DeepSeek field name support |
| `goose-workspace/crates/goose/src/session/session_manager.rs` | 56-86, 88-109 | Add cache token fields to `Session` and `SessionUpdateBuilder` |
| `goose-workspace/crates/goose/src/agents/reply_parts.rs` | 482-511 | Save cache tokens to session |
| `goose-workspace/crates/goose/src/acp/server.rs` | 790-795 | Populate cache fields in `build_prompt_usage` |
| `sacp-source/acp-schema-source/src/client.rs` | 255-270 | (Optional) Add cache fields to `UsageUpdate` |

---

## EduCraw Integration

Once the above fixes are applied, EduCraw will receive:

**Via PromptResponse:**
```json
{
  "usage": {
    "total": 330,
    "input": 150,      // Pure input (cache separated!)
    "output": 100,
    "cachedReadTokens": 30,   // ✅ Now populated
    "cachedWriteTokens": 50   // ✅ Now populated
  }
}
```

**Via UsageUpdate (if using `_meta` approach):**
```json
{
  "used": 330,
  "size": 200000,
  "_meta": {
    "cache_read_tokens": 30,
    "cache_write_tokens": 50
  }
}
```

**In EduCraw's `spawn_token_accounting`:**
```rust
// Now you can properly set all token fields:
let tokens = db_tokens::TurnTokens {
    model: model_name,
    input_tokens: usage.input_tokens,              // Pure input
    output_tokens: usage.output_tokens,           // Pure output
    cache_creation_input_tokens: usage.cachedWriteTokens,  // ✅ Now available
    cache_read_input_tokens: usage.cachedReadTokens,       // ✅ Now available
};
```
