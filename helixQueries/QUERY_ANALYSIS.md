# SQLite → HelixDB Query Analysis

> Findings from cross-referencing all SQLite queries (db layer + API layer) against the graph design and HelixDB capabilities.

---

## 1. Missing Queries (found in API layer, not in db modules)

| # | Location | SQL | Purpose |
|---|----------|-----|---------|
| MQ1 | `admin.rs:1350` | `SELECT ... FROM token_deductions WHERE student_id = ? ORDER BY recorded_at DESC LIMIT 100` | Student deduction history (inline in handler, not in token_usage.rs) |
| MQ2 | `admin.rs:195-200` | `list_students` + `list_active_sessions` combined in-memory | Student list with `has_active_session` flag (JOIN done in Rust) |

---

## 2. API-Layer Multi-Query Patterns (candidates for consolidation)

These are endpoint handlers that fire multiple DB queries in sequence. Each row shows current queries vs what HelixDB can do.

| Endpoint | Current Queries | HelixDB | Savings |
|----------|----------------|---------|---------|
| `POST /sessions` (create_session) | `get_student` → `list_subjects` → `insert_session` → `touch_last_seen` (4) | 1 traversal (load student+subjects) + 1 write batch (AddN Session + 3 AddE + SetProperty last_seen) | 4→2 |
| `PUT /sessions/:id/model` (set_model) | `get_session` → `set_session_model` → `set_last_model` (3) | 1 write batch (load session → Drop USED_MODEL + AddE new + Drop LAST_USED_MODEL + AddE new) | 3→1 |
| `GET /sessions/:id/models` | `get_session` → `full_models_for_student` → `get_student` (3) | 1 traversal (Session → HAS_SESSION⁻¹ → ALLOWED_MODEL → Model, with Choose fallback) | 3→1 |
| `GET /me` | `get_student` → `get_cohort` → `list_cohorts` (3) | 1 traversal (Student + IN_COHORT + all Cohorts) | 3→1 |
| `PATCH /me` (update_me) | `get_student` → `get_cohort` (validate) → `update_student` (1-3) → `get_student` (re-read) → `list_subjects` (up to 7) | 1 read (load student+cohort) + 1 write batch (SetProperty + edge swap) + 1 read (re-read with subjects) | 7→3 |
| `GET /admin/students` | `list_students` + `list_active_sessions` (2, merged in Rust) | 1 traversal (all Students + HAS_SESSION filter state=active) | 2→1 |
| `GET /admin/students/:id/token-usage` | `get_student` + `student_total_tokens` (2) | 1 traversal (Student → HAS_TOKEN_USAGE → AggregateBy Sum) | 2→1 |
| `GET /admin/students/:id/token-balance` | `get_student` (just for balance) (1) | Direct property read on Student node | 1→1 (simpler) |
| `POST /admin/students/:id/topup` | `get_student` (verify) + `topup_tokens` (2) | 1 write batch (verify exists + Add math) | 2→1 |
| `POST /admin/students/:id/deduct` | `get_student` (verify) + `deduct_tokens` (2) | 1 write batch (verify exists + Sub math) | 2→1 |
| `POST /me/redeem-code` | `SELECT code` → `UPDATE code` → `UPDATE student balance` → `SELECT balance` (4) | 1 write batch (Coalesce lookup → AddE USED_BY + Add math on balance) | 4→1 |
| `PUT /admin/students/:id/models` | `DELETE student_models` + N×`INSERT` (1+N) | 1 write batch (Drop all ALLOWED_MODEL edges + ForEach AddE) | 1+N→1 |

---

## 3. HelixDB Advanced Features That Reduce Queries

### 3.1 Math Expressions (`Add`, `Sub`, `Mul`, `Div`)

| Current Pattern | HelixDB Replacement |
|----------------|---------------------|
| `deduct_tokens`: `UPDATE students SET token_balance = token_balance - ?` then `SELECT token_balance` (2 queries) | Single `SetProperty` with `Sub(Property("token_balance"), Param("amount"))` — computes and returns in 1 op |
| `topup_tokens`: `UPDATE students SET token_balance = token_balance + ?` then `SELECT token_balance` (2 queries) | Single `SetProperty` with `Add(Property("token_balance"), Param("amount"))` |
| `redeem_code`: read code.tokens → `UPDATE students SET token_balance = token_balance + ?` → `SELECT` (3 queries) | `SetProperty` with `Add(Property("token_balance"), Param("codeTokens"))` in same batch |
| `record_deduction`: compute `tokens_used = input + output`, `tokens_deducted = (input*input_mult) + (output*output_mult)` in Rust, then INSERT | HelixDB `Expr::Add` / `Expr::Mul` in the AddN properties — compute at write time |

### 3.2 `Choose` (conditional traversal)

| Current Pattern | HelixDB Replacement |
|----------------|---------------------|
| `set_session_state`: if "ended" → set ended_at, else → just state (branch in Rust) | `Choose` with `Eq("state", "ended")` → then sets both, else sets state only |
| `models_for_student`: if student has ALLOWED_MODEL edges → traverse them, else → all enabled models | `Choose` with `VarNotEmpty("allowed")` → use allowed models, else → NWhere(enabled=1) |
| `get_session_models` model priority: last_model → session.model → default (3-step Rust fallback) | `Coalesce` with 3 sub-traversals: LAST_USED_MODEL → USED_MODEL → first enabled |

### 3.3 `AggregateBy` (server-side aggregation)

| Current Pattern | HelixDB Replacement |
|----------------|---------------------|
| `session_totals`: `SUM(input_tokens), SUM(output_tokens), SUM(cache_creation), SUM(cache_read), COUNT(*)` (1 SQL, but pulls all rows) | `AggregateBy` with Sum/Count — server computes, returns only totals |
| `student_total_tokens`: JOIN sessions + token_usage + SUM (2-table join) | Single traversal: Student → HAS_TOKEN_USAGE → AggregateBy Sum |
| Future: cohort token report (not yet implemented) | Cohort → IN_COHORT⁻¹ → HAS_TOKEN_USAGE → AggregateBy Sum |
| Future: sessions per status count | NWhere(Session) → GroupCount("state") |

### 3.4 `ForEach` (bulk operations)

| Current Pattern | HelixDB Replacement |
|----------------|---------------------|
| `generate_codes`: loop N×`INSERT INTO token_codes` (N queries) | `ForEach` over `data` param → AddN TokenCode per iteration (1 request) |
| `set_student_models`: DELETE + N×INSERT (1+N queries) | Drop existing edges + ForEach AddE ALLOWED_MODEL (1 batch) |

### 3.5 `Coalesce` (fallback chains)

| Current Pattern | HelixDB Replacement |
|----------------|---------------------|
| Model resolution: `student.last_model` → `session.model` → `first enabled model` → `CLAW_MODEL env` (4-step Rust logic) | `Coalesce` with 4 sub-traversals, returns first non-empty |
| Student home_dir: `home_dir` → `username` (Rust fallback) | `Coalesce` in Project: first try home_dir property, else username |

### 3.6 Cascading `Drop` (delete with relationships)

| Current Pattern | HelixDB Replacement |
|----------------|---------------------|
| `delete_student`: 5 queries in FK order (token_usage → sessions → student_models → token_codes → students) | Single `Drop` on Student node — all connected edges auto-deleted |
| `delete_cohort`: 3 queries (subjects → students unlink → cohort) | Single `Drop` on Cohort node with edge cascade |

---

## 4. Consolidation Summary

### By Module

| Module | Current Queries | After HelixDB | Reduction |
|--------|----------------|---------------|-----------|
| models | 15 | 12 | -3 (set_student_models batch, models_for_student Choose) |
| sessions | 11 | 6 | -5 (create_session batch, set_model batch, set_session_state Choose) |
| students | 17 | 9 | -8 (delete_student Drop, topup/deduct math, update_me batch) |
| cohorts | 10 | 6 | -4 (rename_cohort edge auto-follow, delete_cohort Drop) |
| subjects | 6 | 5 | -1 (insert_subject AddN+AddE batch) |
| token_usage | 4 | 3 | -1 (record_turn AddN+2×AddE batch) |
| token_codes | 8 | 4 | -4 (redeem_code batch, generate_codes ForEach) |
| **Total** | **71** | **45** | **-26 (37% reduction)** |

### By Category

| Category | Before | After | Technique |
|----------|--------|-------|-----------|
| Multi-query → single batch | 12 endpoints | 12 single batches | WriteBatch with Var references |
| Read-then-write → compute-and-set | 4 ops | 4 single writes | Math expressions (Add/Sub) |
| FK cascade deletes | 2 operations (8 queries) | 2 single Drops | Cascading edge deletion |
| Conditional branches | 3 operations | 3 Choose/Coalesce | Conditional traversal |
| Loop inserts | 2 operations (N queries) | 2 ForEach | Bulk iteration |

---

## 5. Design Implications

### 5.1 TokenUsage `model` property — keep or remove?

Current: TokenUsage has `model` TEXT (denormalized from Session → USED_MODEL → Model.name)

**Keep it.** Reasons:
- TokenUsage is written on every AI turn (high frequency). Traversing Session → USED_MODEL → Model.name adds a hop on every write.
- Aggregation queries (`AggregateBy Sum`) filter by model name — having it as a property allows `Has("model", "grok-4")` before aggregation.
- The denormalization cost is negligible (one extra property per node) vs the traversal savings.

### 5.2 TokenDeduction dual edges — necessary?

Current plan: `Student → HAS_DEDUCTION → TokenDeduction` AND `TokenDeduction → OF_SESSION → Session`

**Keep both.** Reasons:
- `HAS_DEDUCTION` answers "show me this student's deduction history" (admin.rs:1350)
- `OF_SESSION` answers "which session caused this deduction?" (audit trail)
- Without OF_SESSION, you'd need to traverse TokenDeduction → ??? → Session, which requires an edge anyway.

### 5.3 Session → IN_COHORT denormalized edge

**Keep it.** Reasons:
- Admin queries like "active sessions in cohort X" would require `Cohort → IN_COHORT⁻¹ → HAS_SESSION` (2 hops) vs `Cohort → IN_COHORT⁻¹ → HAS_SESSION` with the edge already there.
- More importantly: cohort-level token reports need `Cohort → IN_COHORT⁻¹ → HAS_TOKEN_USAGE` which is only possible if Session has the cohort edge (since HAS_TOKEN_USAGE originates from Session).
- Written once at creation, never changes.

---

## 6. Open Questions / TODOs

- [x] Confirm: should `TokenUsage` nodes also get a `student_id` property for direct filtering, or is `Student → HAS_TOKEN_USAGE` sufficient?
- [ ] Confirm: should `TokenDeduction` nodes store the computed `tokens_deducted` value, or should it be computed on-read with `Expr::Add` + `Expr::Mul`?
- [ ] Investigate: can HelixDB's `Project` with `Expr::Case` replace the `ORDER BY CASE WHEN name = 'grok-4-1-fast-reasoning' THEN 0 ELSE 1 END` pattern used in `list_enabled` and `raw_assignments_for_student`?
- [ ] Investigate: does HelixDB support `LIMIT` on `AggregateBy` results? (Needed for `list_codes LIMIT 500`)
