# EduClaw HelixDB Graph Design

> Tenant: **Student**. Cohorts are graph-connected, not tenant boundaries.
> Public nodes (Model, TokenCode) are shared across all tenants.

---

## Node Labels

### Global (single copy, shared)
| Label | Properties | Key Index |
|-------|-----------|-----------|
| `Model` | `name`, `display_name`, `enabled`, `sort_priority`, `input_multiplier`, `output_multiplier`, `provider`, `think_mode`, `visual_support`, `thinking_params`, `created_at` | `name` (equality) |
| `TokenCode` | `code`, `tokens`, `used_by`, `used_at`, `created_at` | `code` (equality) |

### Cohort-Scope (shared within cohort)
| Label | Properties | Key Index |
|-------|-----------|-----------|
| `Cohort` | `id` (slug), `title`, `created_at` | `id` (equality) |
| `Subject` | `slug`, `title`, `created_at` | — |

### Tenant-Scope (per student)
| Label | Properties | Key Index |
|-------|-----------|-----------|
| `Student` | `username`, `password_hash`, `display_name`, `role`, `token_balance`, `restriction_status`, `restriction_message`, `uid_slot`, `home_dir`, `token_limit`, `created_at`, `last_seen` | `username` (equality) |
| `Session` | `state`, `overlay_mount`, `namespace_pid`, `last_input_at`, `last_token_checkpoint`, `started_at`, `ended_at` | — |
| `TokenUsage` | `student_id`, `model`, `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens`, `recorded_at` | — |
| `TokenDeduction` | `model_name`, `multiplier`, `input_multiplier`, `output_multiplier`, `input_tokens_used`, `output_tokens_used`, `input_tokens_deducted`, `output_tokens_deducted`, `tokens_used`, `tokens_deducted`, `balance_before`, `balance_after`, `recorded_at` | — |

---

## Edges

| From | Label | To | Purpose | Notes |
|------|-------|----|---------|-------|
| Student | `IN_COHORT` | Cohort | Student's cohort membership | Replaces `cohort_id` FK |
| Cohort | `HAS_SUBJECT` | Subject | Subjects in this cohort | Replaces `cohort_id` FK |
| Student | `ALLOWED_MODEL` | Model | Per-student model whitelist | Replaces `student_models` table. No edges = all enabled models |
| Student | `LAST_USED_MODEL` | Model | Student's most recent model | Single edge; drop old, add new on switch |
| Student | `HAS_SESSION` | Session | Student's sessions | Replaces `student_id` FK |
| Session | `USED_MODEL` | Model | Model used in this session | Replaces `model` TEXT column |
| Session | `IN_COHORT` | Cohort | Cohort of the session | Denormalized; set at creation, immutable |
| Session | `HAS_USAGE` | TokenUsage | Token records for this session | Replaces `session_id` FK |
| Student | `HAS_TOKEN_USAGE` | TokenUsage | Direct link for fast aggregation | Dual edge with HAS_USAGE; written at creation |
| Student | `HAS_DEDUCTION` | TokenDeduction | Student's deduction audit trail | Replaces `student_id` FK |
| TokenDeduction | `OF_SESSION` | Session | Which session caused this deduction | Replaces `session_id` FK |
| TokenCode | `USED_BY` | Student | Which student redeemed this code | Optional; only present when redeemed |

---

## Lookup Keys (non-traversable direct access)

| Node | Property | Use Case |
|------|----------|----------|
| Student | `username` | Login / auth |
| Model | `name` | API model references |
| TokenCode | `code` | Code redemption |

All other lookups use HelixDB node IDs or graph traversal.

---

## Common Query Patterns

| Query | Traversal |
|-------|-----------|
| Student's subjects | `Student → IN_COHORT → HAS_SUBJECT → Subject` |
| Student's allowed models | `Student → ALLOWED_MODEL → Model` (filter `enabled=1`) |
| Fallback: all enabled models | `NWhere(Model, enabled=1)` (no ALLOWED_MODEL edges) |
| Student's total tokens | `Student → HAS_TOKEN_USAGE → TokenUsage → AggregateBy Sum` |
| Session's token usage | `Session → HAS_USAGE → TokenUsage → AggregateBy Sum` |
| Active sessions in cohort | `Cohort → IN_COHORT⁻¹ → HAS_SESSION → Session` (filter `state=active`) |
| Cohort token report | `Cohort → IN_COHORT⁻¹ → HAS_TOKEN_USAGE → TokenUsage → AggregateBy Sum` |
| Redeem code | `TokenCode (by code) → check no USED_BY → add USED_BY edge → update Student.token_balance` |

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| `last_model` → `LAST_USED_MODEL` edge | Graph-consistent; drop/add on switch |
| Dual edges for TokenUsage (Session + Student) | Session link for detail queries; Student link for fast aggregation |
| `TokenUsage.student_id` property | Direct filtering without traversal; admin queries need student-scoped token lookups |
| `Model.sort_priority` property | HelixDB `OrderBy` doesn't support expressions; replaces SQL `ORDER BY CASE` pattern |
| `TokenDeduction.tokens_deducted` stored | Computed once at write; audit trail should be self-contained |
| `Session → IN_COHORT` denormalized | Admin queries need cohort→session without traversing all students; set once, never changes |
| `ALLOWED_MODEL` edges optional | No edges = fall back to all enabled models (matches current SQLite behavior) |
| No `assignments` table | Removed per user decision |
| No `multiplier` legacy column | Removed from models and token_deductions |

---

## Open Questions / TODOs

> Add items here as they arise during query porting.

- [ ] _None yet_
