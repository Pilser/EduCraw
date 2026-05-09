# Model Switching Verification - Implementation Status

## Date
Created during verification of provider+model switching implementation.

## Summary
✅ **IMPLEMENTATION IS CORRECT** - EduCraw properly handles provider switching before model switching.

---

## What Was Verified

### 1. Provider Field in Database
- ✅ Model struct includes `provider: Option<String>` field
- ✅ Database function `get_model_by_name()` retrieves provider info
- ✅ Database function `update_model_specs()` can update provider, think_mode, visual_support

### 2. Model Poller Implementation (Critical Path)

**File:** `educlaw-server/src/acp_bridge/model_poller.rs`

The implementation follows the recommended pattern from `GOOSE-MODEL-PROVIDER-SETTING.md`:

#### Step 1: Look up provider for the model
```rust
// Lines ~112-127
let provider_id = match db_models::get_model_by_name(&pool, &model_name).await {
    Ok(Some(model)) => model.provider,
    Ok(None) => {
        tracing::warn!("Model not found in database - cannot determine provider");
        None
    }
    Err(e) => {
        tracing::error!("Failed to look up model in database");
        None
    }
};
```

#### Step 2: Switch provider FIRST (if provider is known)
```rust
// Lines ~129-152
if let Some(provider) = &provider_id {
    tracing::info!(
        provider = %provider,
        model = %model_name,
        "[MODEL-POLLER] Switching provider before model"
    );

    match cx
        .send_request(SetSessionConfigOptionRequest::new(
            acp_session_id.clone(),
            SessionConfigId::new("provider"),
            SessionConfigOptionValue::value_id(provider.clone()),
        ))
        .block_task()
        .await
    {
        Ok(_) => {
            tracing::info!("Provider switched successfully");
        }
        Err(e) => {
            tracing::warn!("Provider switch failed - continuing anyway");
        }
    }
} else {
    tracing::debug!("No provider configured - using current provider");
}
```

#### Step 3: Switch model AFTER provider switch
```rust
// Lines ~158-onwards
match cx
    .send_request(SetSessionModelRequest::new(
        acp_session_id.clone(),
        model_name.clone(),
    ))
    .block_task()
    .await
{
    Ok(_) => {
        // Update in-memory cache
        *model_arc.lock().await = Some(model_name.clone());
        
        // Persist to DB
        db_sess::set_session_model(&pool, &session_id, &model_name).await;
        
        // Notify frontend
        let frame = serde_json::json!({
            "type": "model_changed",
            "model": model_name
        }).to_string();
        ctrl_tx.send(frame).await;
    }
    ...
}
```

---

## Compliance with Documentation

### From GOOSE-MODEL-PROVIDER-SETTING.md

#### ✅ Requirement 1: Provider Switch Before Model Switch
> "Provider must be set BEFORE switching to that provider's models"

**Status:** ✅ IMPLEMENTED
- Provider switch happens in lines ~129-152
- Model switch happens after in lines ~158+
- Proper sequencing with `.await` ensures synchronous execution

#### ✅ Requirement 2: Use SetSessionConfigOptionRequest for Provider
> "Use SetSessionConfigOptionRequest with configId='provider' to switch providers"

**Status:** ✅ IMPLEMENTED
```rust
SetSessionConfigOptionRequest::new(
    acp_session_id.clone(),
    SessionConfigId::new("provider"),
    SessionConfigOptionValue::value_id(provider.clone()),
)
```

#### ✅ Requirement 3: Model Names Without Provider Prefix
> "Model names do NOT include provider prefix - Just use 'deepseek-v4', not 'deepseek/deepseek-v4'"

**Status:** ✅ IMPLEMENTED
- Model names stored as-is in database (e.g., "deepseek-v4")
- Provider stored separately in `provider` field
- Model name passed directly to `SetSessionModelRequest` without modification

#### ✅ Requirement 4: Handle Missing Provider Info Gracefully
> "EduCraw's current model list is INCOMPLETE - it doesn't store which provider each model belongs to"

**Status:** ✅ FIXED
- Database schema extended with `provider` field
- Graceful fallback if provider is None (uses current provider)
- Proper logging for debugging

---

## Execution Flow

### Scenario: User switches from "grok-3" (xai) to "deepseek-v4" (deepseek)

1. **Frontend:** User selects "deepseek-v4" in model dropdown
2. **API:** POST to `/api/sessions/:id/model` with `{"model": "deepseek-v4"}`
3. **Backend:** Writes "deepseek-v4" to `pending_model.txt`
4. **Model Poller (500ms loop):**
   - Reads "deepseek-v4" from file
   - Removes file (consume signal)
   - Validates student permission to use "deepseek-v4"
   - Looks up model in database → `provider = "deepseek"`
   - **SENDS:** `SetSessionConfigOptionRequest` with provider="deepseek"
   - **WAITS:** for provider switch to complete (`.await`)
   - **SENDS:** `SetSessionModelRequest` with model="deepseek-v4"
   - Updates cache, DB, and notifies frontend

---

## Security & Validation

### ✅ Permission Checking
Lines ~82-105 validate that the student is allowed to use the requested model:
```rust
let allowed_to_switch = match db_sess::get_session(&pool, &session_id).await {
    Ok(Some(sess)) => {
        match crate::db::models::models_for_student(&pool, &sess.student_id).await {
            Ok(allowed_models) => allowed_models.contains(&model_name),
            ...
        }
    }
    ...
};

if !allowed_to_switch {
    tracing::warn!("Rejecting unauthorized model switch attempt");
    continue;
}
```

---

## Potential Issues & Edge Cases

### ⚠️ Provider Field Not Set for Old Models
**Issue:** Models created before the schema migration won't have a provider value.

**Impact:**
- Falls back to current provider (logged as debug)
- May cause issues if switching to a model from a different provider

**Solution:**
- Admin should update model specs via PUT `/admin/models/:id/specs`
- Or run a migration script to populate provider fields

### ⚠️ Provider Switch Failure Handling
**Current behavior:** If provider switch fails, continues with model switch anyway.

**Line 148:**
```rust
Err(e) => {
    tracing::warn!("Provider switch failed - continuing anyway");
}
```

**Risk:** Model switch may fail if provider switch failed.

**Recommendation:** Consider aborting model switch if provider switch fails:
```rust
Err(e) => {
    tracing::error!("Provider switch failed - aborting model switch");
    continue;  // Skip model switch
}
```

---

## Testing Checklist

- [ ] Cross-provider switch (xai → deepseek)
  - [ ] Verify provider switch request sent first
  - [ ] Verify model switch request sent second
  - [ ] Verify both requests succeed
  - [ ] Verify next message uses new provider's endpoint

- [ ] Same-provider switch (xai grok-3 → xai grok-beta)
  - [ ] Verify provider switch is skipped (or harmless)
  - [ ] Verify model switch succeeds

- [ ] Model without provider field
  - [ ] Verify graceful fallback
  - [ ] Verify logging indicates "No provider configured"
  - [ ] Verify model switch still attempted

- [ ] Permission validation
  - [ ] Student tries to switch to unauthorized model
  - [ ] Verify switch is blocked
  - [ ] Verify error logged

- [ ] ACP session not ready
  - [ ] Model switch attempted before ACP connection
  - [ ] Verify graceful skip with warning

---

## Conclusion

✅ **The implementation correctly follows the ACP protocol and GOOSE-MODEL-PROVIDER-SETTING.md guidance.**

The model switching flow:
1. ✅ Looks up provider from database
2. ✅ Switches provider first (if provider is set)
3. ✅ Switches model second (after provider switch completes)
4. ✅ Validates permissions
5. ✅ Handles missing provider gracefully

### Recommendations
1. Ensure all models in the database have their `provider` field populated
2. Consider stricter error handling for provider switch failures
3. Test cross-provider switching end-to-end
4. Monitor logs for "No provider configured" warnings
