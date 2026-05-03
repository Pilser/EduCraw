# LLM Provider Routing (API Keys & Per-Student Configuration)

## Current Behavior

**Static**: All students use same API key from `.env`
```
XAI_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-yyy
```

Educraw passes these to every goose subprocess via environment variables.

---

## Dynamic Per-Student Routing

### Option 1: Database + Env Var Override (Recommended)

**Store student's LLM provider in DB:**

```
students table:
  id, username, llm_provider, llm_api_key_env_name
  
  student-1, alice, anthropic, ALICE_ANTHROPIC_KEY
  student-2, bob, openai, BOB_OPENAI_KEY
```

**Educraw selects API key per session:**

```rust
// In educlaw-server/src/api/ws.rs

let student = db_students::get_student(&pool, &student_id).await?;
let api_key_env = student.llm_api_key_env_name; // e.g., "ALICE_ANTHROPIC_KEY"

// Forward only that student's key to goose
if let Ok(val) = std::env::var(&api_key_env) {
    env_vars.push((api_key_env, val));
}
```

**Setup in `.env`:**
```
ALICE_ANTHROPIC_KEY=sk-ant-alice-xxx
BOB_OPENAI_KEY=sk-openai-bob-yyy
CHARLIE_GROQ_KEY=gsk-charlie-zzz
```

---

### Option 2: Model Override Per Session

**Student requests specific model in session params:**

```json
POST /sessions
{
  "model": "gpt-4o",           // OpenAI model
  "student_id": "bob"
}
```

**Educraw maps model → provider → API key:**

```rust
match requested_model {
    m if m.starts_with("claude-") => env_vars.push(("ANTHROPIC_API_KEY", key)),
    m if m.starts_with("gpt-") => env_vars.push(("OPENAI_API_KEY", key)),
    m if m.starts_with("llama-") => env_vars.push(("GROQ_API_KEY", key)),
    _ => {}
}
```

---

## Can API Keys Be Passed via ACP Protocol?

**NO**. Limitations:
- Goose reads secrets at startup via `config.get_secret()` (environment only)
- ACP protocol has no request type for dynamic secret injection
- Once goose subprocess starts, environment is fixed

---

## Implementation Steps

1. **Add column to students table:**
   ```sql
   ALTER TABLE students ADD llm_provider TEXT;
   ALTER TABLE students ADD llm_api_key_env_name TEXT;
   ```

2. **Update educraw session spawn:**
   ```rust
   let student = db_students::get_student(&pool, &student_id).await?;
   
   // Selective key forwarding based on student's provider
   if let Some(key_env_name) = &student.llm_api_key_env_name {
       if let Ok(val) = std::env::var(key_env_name) {
           env_vars.push((key_env_name.clone(), val));
       }
   }
   ```

3. **Set different API keys in `/srv/educraw/.env`:**
   ```
   STUDENT_ALICE_KEY=sk-ant-xxx
   STUDENT_BOB_KEY=sk-openai-yyy
   ```

---

## Summary

| Approach | Per-Student? | Dynamic? | Implementation |
|----------|---|---|---|
| Single shared key | ❌ | ❌ | Current (all students share) |
| DB routing + env | ✅ | ✅ | Select API key env var per student |
| Model-based routing | ✅ | ✅ | Map model name → provider → key |
| ACP Protocol | ❌ | ❌ | Not supported by goose |

**Recommendation**: Use **Option 1** (DB routing) — simple, secure, and allows each student/cohort to have their own provider.
