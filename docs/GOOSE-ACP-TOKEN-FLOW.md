# Goose ACP Token Usage - Analysis & Findings

## Overview

This document analyzes how Goose calculates and sends token usage via the ACP (Agent Client Protocol) when using Goose as the main engine.

---

## Token Calculation Flow

### 1. Provider Level (Anthropic Example)

**File:** `goose-workspace/crates/goose/src/providers/formats/anthropic.rs:374-468`

```rust
// What Anthropic API returns:
input_tokens:             150      // Actual input tokens
cache_creation_input_tokens: 50    // Tokens to create cache
cache_read_input_tokens:    30    // Tokens read from cache
output_tokens:             100    // Output tokens
```

**Current calculation in Anthropic provider:**
```rust
let total_input_tokens = input_tokens + cache_creation_tokens + cache_read_tokens;
// = 150 + 50 + 30 = 230

let total_tokens_i32 = total_input_i32 + output_tokens_i32;
// = 230 + 100 = 330
```

**Problem:** The `Usage::new()` is called WITHOUT `with_cache_tokens()`:
```rust
Ok(Usage::new(
    Some(total_input_i32),   // Sets input_tokens = 230 (includes cache!)
    Some(output_tokens_i32), // Sets output_tokens = 100
    Some(total_tokens_i32),  // Sets total_tokens = 330
))
// NOTE: with_cache_tokens() is NOT called - cache breakdown is LOST!
```

---

### 2. Provider Usage Struct

**File:** `goose-workspace/crates/goose/src/providers/base.rs:411-418`

```rust
pub struct Usage {
    pub input_tokens: Option<i32>,            // ⚠️ Includes cache tokens (from Anthropic)
    pub output_tokens: Option<i32>,
    pub total_tokens: Option<i32>,            // ⚠️ Includes cache tokens
    pub cache_read_input_tokens: Option<i32>, // ❌ NOT SET (None)
    pub cache_write_input_tokens: Option<i32>, // ❌ NOT SET (None)
}
```

---

### 3. Session Update (Where Cache Tokens Are Lost)

**File:** `goose-workspace/crates/goose/src/agents/reply_parts.rs:470-514`

```rust
pub async fn update_session_usage(...) {
    let accumulated_input = accumulate(
        session.accumulated_input_tokens,
        usage.usage.input_tokens      // Gets 230 (includes cache)
    );
    let accumulated_output = accumulate(
        session.accumulated_output_tokens,
        usage.usage.output_tokens     // Gets 100
    );
    let accumulated_total = accumulate(
        session.accumulated_total_tokens,
        usage.usage.total_tokens     // Gets 330 (includes cache)
    );

    // ❌ MISSING: Cache tokens are NOT accumulated!
    // Should also accumulate:
    // - usage.usage.cache_read_input_tokens
    // - usage.usage.cache_write_input_tokens
}
```

---

### 4. ACP Response (What Gets Sent to EduCraw)

**File:** `goose-workspace/crates/goose/src/acp/server.rs:790-794`

```rust
fn build_prompt_usage(session: &Session) -> Option<Usage> {
    let total = to_nonnegative_u64(session.total_tokens)?;   // 330 (includes cache)
    let input = to_nonnegative_u64(session.input_tokens).unwrap_or(0); // 230 (includes cache!)
    let output = to_nonnegative_u64(session.output_tokens).unwrap_or(0); // 100

    Some(Usage::new(total, input, output))
    // ❌ ACP Usage only has total, input, output - NO cache fields!
}
```

**What EduCraw Receives via ACP PromptResponse:**
```json
{
  "usage": {
    "total": 330,    // input(230) + output(100) -- includes cache!
    "input": 230,     // ⚠️ This includes 50+30 cache tokens!
    "output": 100
  }
}
```

**What EduCraw Receives via UsageUpdate Notification:**
```json
{
  "type": "token_usage",
  "used": 330,      // Just the total tokens (includes cache)
  "size": 200000    // Context window size
}
```

---

## Answers to Your Questions

### Q1: Are tokens sent via ACP calculated from input + output + cached?

**YES.** The tokens sent via ACP (`total`, `input`, `output`) ARE calculated from input + output + cached combined:

| Field | Value | Includes Cache? |
|-------|-------|------------------|
| `total` | 330 | ✅ YES (input + cache + output) |
| `input` | 230 | ✅ YES (actual input + cache_creation + cache_read) |
| `output` | 100 | ❌ NO (just output) |

### Q2: Is it output only?

**NO.** The tokens sent are NOT output only. They include:
- Output tokens (explicit)
- Input tokens (which include cache tokens)
- Total tokens (everything combined)

### Q3: Does the calculation work fairly?

**PARTIALLY.** The token COUNTING is accurate (all tokens are counted), but the BREAKDOWN is misleading:

✅ **Fair:**
- All tokens are counted (input + output + cache)
- Total token count is accurate
- Cost calculation uses the correct token counts

❌ **Not Fair (Misleading):**
- Cache tokens are hidden inside `input_tokens` with no way to distinguish them
- Users see "input tokens: 230" but don't know 80 of those are cache tokens
- No visibility into cache savings
- The ACP protocol doesn't support sending cache breakdown currently

---

## The Session Struct (Missing Cache Fields)

**File:** `goose-workspace/crates/goose/src/session/session_manager.rs:56-86`

```rust
pub struct Session {
    pub total_tokens: Option<i32>,              // 330 (includes cache)
    pub input_tokens: Option<i32>,              // 230 (includes cache!)
    pub output_tokens: Option<i32>,             // 100
    pub accumulated_total_tokens: Option<i32>,
    pub accumulated_input_tokens: Option<i32>,
    pub accumulated_output_tokens: Option<i32>,

    // ❌ MISSING: No cache token fields!
    // Should have:
    // pub cache_creation_input_tokens: Option<i32>,
    // pub cache_read_input_tokens: Option<i32>,
    // pub accumulated_cache_creation_tokens: Option<i32>,
    // pub accumulated_cache_read_tokens: Option<i32>,
}
```

---

## What Needs to Change (To Send Cache Tokens via ACP)

### Option A: Extend ACP Protocol (Recommended)

1. **Extend `sacp` crate's `Usage` struct** to add cache fields:
   ```rust
   pub struct Usage {
       pub total: u64,
       pub input: u64,
       pub output: u64,
       pub cache_creation: u64,  // NEW
       pub cache_read: u64,       // NEW
   }
   ```

2. **Update `build_prompt_usage`** in `acp/server.rs`:
   ```rust
   fn build_prompt_usage(session: &Session) -> Option<Usage> {
       let total = to_nonnegative_u64(session.total_tokens)?;
       let input = to_nonnegative_u64(session.input_tokens).unwrap_or(0);
       let output = to_nonnegative_u64(session.output_tokens).unwrap_or(0);
       let cache_creation = to_nonnegative_u64(session.cache_creation_input_tokens).unwrap_or(0);
       let cache_read = to_nonnegative_u64(session.cache_read_input_tokens).unwrap_or(0);

       Some(Usage::new(total, input, output)
           .with_cache_tokens(cache_creation, cache_read))
   }
   ```

### Option B: Quick Fix - Send Separate UsageUpdate with Cache Info

Modify `build_usage_update` to include cache tokens in the `UsageUpdate` notification.

---

## Current EduCraw Server Handling

**File:** `educlaw-server/src/acp_bridge/notifications.rs:246-262`

```rust
pub fn spawn_token_accounting(
    pool: SqlitePool,
    session_id: String,
    student_id: String,
    model_name: String,
    used: i64,  // ⚠️ This is total_tokens (includes cache!)
) {
    let tokens = db_tokens::TurnTokens {
        model: model_name,
        input_tokens: used,              // ❌ Wrong: should be just input, not total
        output_tokens: 0,                 // ❌ Not set!
        cache_creation_input_tokens: 0,    // ❌ Always 0 (never sent by Goose)
        cache_read_input_tokens: 0,        // ❌ Always 0 (never sent by Goose)
    };
    // ...
}
```

**File:** `educlaw-server/src/acp_bridge/client.rs:83` (UsageUpdate handler)
- Receives `usage.used` which is `session.total_tokens`
- Cannot break down into input/output/cache

---

## Summary

| Issue | Status |
|-------|--------|
| Token counting | ✅ Accurate (all tokens counted) |
| Cache token tracking in Provider Usage | ✅ Present in `Usage` struct |
| Cache tokens saved to Session | ❌ NOT SAVED |
| Cache tokens sent via ACP PromptResponse | ❌ NOT SENT (hidden in `input`) |
| Cache tokens sent via ACP UsageUpdate | ❌ NOT SENT (only total) |
| EduCraw can distinguish cache vs input | ❌ NO (receives combined count) |

**Root Cause:** The cache tokens are calculated by providers (Anthropic, OpenAI, etc.) but get lost when:
1. `update_session_usage` doesn't save them to Session
2. `build_prompt_usage` doesn't include them in ACP response
3. ACP `Usage` struct may not support cache fields (depends on `sacp` crate version)
