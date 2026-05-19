# EduClaw SQLite Schema & Queries — Full Reference

> Purpose: Complete catalog of the current SQLite schema and every query, for systematic porting to HelixDB.
> Tenant model: **Student (user) is the tenant.** Cohorts will become edges in HelixDB.

---

## 1. Full DDL Schema

### `models` — AI model configurations (global)
```sql
CREATE TABLE IF NOT EXISTS models (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    multiplier      REAL NOT NULL DEFAULT 1.0,          -- legacy
    input_multiplier REAL NOT NULL DEFAULT 1.0,
    output_multiplier REAL NOT NULL DEFAULT 1.0,
    provider        TEXT,
    think_mode      INTEGER,
    visual_support  INTEGER NOT NULL DEFAULT 0,
    thinking_params TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `cohorts` — Student groupings (tenant root)
```sql
CREATE TABLE IF NOT EXISTS cohorts (
    id         TEXT PRIMARY KEY,   -- slug-style id
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `subjects` — Subjects scoped per cohort
```sql
CREATE TABLE IF NOT EXISTS subjects (
    id         TEXT PRIMARY KEY,
    cohort_id  TEXT NOT NULL,
    slug       TEXT NOT NULL,
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_subjects_cohort_slug ON subjects(cohort_id, slug);
CREATE INDEX idx_subjects_cohort ON subjects(cohort_id);
```

### `assignments` — Assignments per subject
```sql
CREATE TABLE IF NOT EXISTS assignments (
    id          TEXT PRIMARY KEY,
    subject_id  TEXT NOT NULL REFERENCES subjects(id),
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_date    TEXT,
    created_by  TEXT NOT NULL,      -- student_id of teacher
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_assignments_subject ON assignments(subject_id);
```

### `students` — Users (THE TENANT)
```sql
CREATE TABLE IF NOT EXISTS students (
    id                  TEXT PRIMARY KEY,
    username            TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    display_name        TEXT NOT NULL,
    role                TEXT NOT NULL DEFAULT 'student',   -- student|teacher|admin
    cohort_id           TEXT NOT NULL DEFAULT '',
    home_dir            TEXT,
    uid_slot            INTEGER,
    token_limit         INTEGER,
    token_balance       INTEGER NOT NULL DEFAULT 0,
    restriction_message TEXT,
    restriction_status  TEXT,
    last_model          TEXT,
    token_block_banner  TEXT,      -- legacy
    token_blocked_at    TEXT,      -- legacy
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen           TEXT
);
```

### `sessions` — Active/ended AI sessions
```sql
CREATE TABLE IF NOT EXISTS sessions (
    id                      TEXT PRIMARY KEY,
    student_id              TEXT NOT NULL REFERENCES students(id),
    state                   TEXT NOT NULL DEFAULT 'active',  -- active|idle_warning|terminating|ended
    namespace_pid           INTEGER,
    overlay_mount           TEXT NOT NULL,
    model                   TEXT,
    last_input_at           TEXT,
    last_token_checkpoint   INTEGER NOT NULL DEFAULT 0,
    started_at              TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at                TEXT
);
CREATE INDEX idx_sessions_student ON sessions(student_id);
CREATE INDEX idx_sessions_state ON sessions(state);
```

### `token_usage` — Per-turn token deltas
```sql
CREATE TABLE IF NOT EXISTS token_usage (
    id                        TEXT PRIMARY KEY,
    session_id                TEXT NOT NULL REFERENCES sessions(id),
    model                     TEXT NOT NULL DEFAULT '',
    input_tokens              INTEGER NOT NULL DEFAULT 0,
    output_tokens             INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens     INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens         INTEGER NOT NULL DEFAULT 0,
    recorded_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_token_usage_session ON token_usage(session_id);
```

### `token_deductions` — Audit trail for token deductions
```sql
CREATE TABLE IF NOT EXISTS token_deductions (
    id                    TEXT PRIMARY KEY,
    student_id            TEXT NOT NULL REFERENCES students(id),
    session_id            TEXT NOT NULL REFERENCES sessions(id),
    model_name            TEXT NOT NULL,
    multiplier            REAL NOT NULL,              -- legacy avg
    tokens_used           INTEGER NOT NULL,
    tokens_deducted       INTEGER NOT NULL,
    balance_before        INTEGER NOT NULL,
    balance_after         INTEGER NOT NULL,
    input_tokens_used     INTEGER NOT NULL DEFAULT 0,
    output_tokens_used    INTEGER NOT NULL DEFAULT 0,
    input_multiplier      REAL NOT NULL DEFAULT 1.0,
    output_multiplier     REAL NOT NULL DEFAULT 1.0,
    input_tokens_deducted INTEGER NOT NULL DEFAULT 0,
    output_tokens_deducted INTEGER NOT NULL DEFAULT 0,
    recorded_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_token_deductions_student ON token_deductions(student_id);
CREATE INDEX idx_token_deductions_session ON token_deductions(session_id);
```

### `student_models` — Per-student allowed models
```sql
CREATE TABLE IF NOT EXISTS student_models (
    student_id  TEXT NOT NULL,
    model_name  TEXT NOT NULL,
    PRIMARY KEY (student_id, model_name)
);
```

### `token_codes` — Redeemable token codes
```sql
CREATE TABLE IF NOT EXISTS token_codes (
    id         TEXT PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE,
    tokens     INTEGER NOT NULL,
    used_by    TEXT,
    used_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_token_codes_tokens ON token_codes(tokens);
CREATE INDEX idx_token_codes_used ON token_codes(used_by);
```

---

## 2. Complete Query Catalog

Legend: **R** = Read, **W** = Write, **W×N** = Write executed N times

---

### MODULE: models (`src/db/models.rs`)

| # | Op | Function | SQL | Params | Returns |
|---|----|----------|-----|--------|---------|
| M1 | W | `insert_model` | `INSERT INTO models (id, name, display_name, input_multiplier, output_multiplier) VALUES (?, ?, ?, ?, ?)` | id, name, display_name, input_mult, output_mult | id (String) |
| M2 | W | `set_enabled` | `UPDATE models SET enabled = ? WHERE id = ?` | i64(enabled), id | () |
| M3 | W | `set_multipliers` | `UPDATE models SET input_multiplier = ?, output_multiplier = ? WHERE name = ?` | input_mult, output_mult, name | () |
| M4 | W | `delete_model` | `DELETE FROM models WHERE id = ?` | id | () |
| M5 | W | `update_model_specs` | `UPDATE models SET provider = ?, think_mode = ?, visual_support = ? WHERE id = ?` | provider, think_mode, visual_support, id | () |
| M6 | W | `update_thinking_params` | `UPDATE models SET thinking_params = ? WHERE id = ?` | params(json), id | () |
| M7 | R | `list_models` | `SELECT * FROM models ORDER BY display_name` | — | Vec<Model> |
| M8 | R | `list_enabled` | `SELECT * FROM models WHERE enabled = 1 ORDER BY CASE WHEN name = 'grok-4-1-fast-reasoning' THEN 0 ELSE 1 END, display_name` | — | Vec<Model> |
| M9 | R | `get_model_by_name` | `SELECT * FROM models WHERE name = ?` | name | Option<Model> |
| M10 | R | `get_model_multipliers` | `SELECT COALESCE(input_multiplier, 1.0), COALESCE(output_multiplier, 1.0) FROM models WHERE name = ?` | name | (f64, f64) |
| M11 | R | `models_for_student` | Calls `list_enabled` (M8) — no per-student filtering currently | — | Vec<String> |
| M12 | R | `full_models_for_student` | Calls `list_enabled` (M8) | — | Vec<Model> |
| M13 | R | `raw_assignments_for_student` | `SELECT sm.model_name FROM student_models sm JOIN models m ON m.name = sm.model_name AND m.enabled = 1 WHERE sm.student_id = ? ORDER BY CASE WHEN sm.model_name = 'grok-4-1-fast-reasoning' THEN 0 ELSE 1 END, sm.model_name` | student_id | Vec<String> |
| M14 | W | `set_student_models` (part 1) | `DELETE FROM student_models WHERE student_id = ?` | student_id | () |
| M15 | W×N | `set_student_models` (part 2) | `INSERT OR IGNORE INTO student_models (student_id, model_name) VALUES (?, ?)` | student_id, model_name (loop) | () |

---

### MODULE: sessions (`src/db/sessions.rs`)

| # | Op | Function | SQL | Params | Returns |
|---|----|----------|-----|--------|---------|
| S1 | W | `insert_session` | `INSERT INTO sessions (id, student_id, state, overlay_mount, model) VALUES (?, ?, ?, ?, ?)` | id, student_id, state, overlay_mount, model | () |
| S2 | W | `set_session_model` | `UPDATE sessions SET model = ? WHERE id = ?` | model, id | () |
| S3a | W | `set_session_state` (ended) | `UPDATE sessions SET state = ?, ended_at = datetime('now') WHERE id = ?` | state, id | () |
| S3b | W | `set_session_state` (other) | `UPDATE sessions SET state = ? WHERE id = ?` | state, id | () |
| S4 | W | `set_namespace_pid` | `UPDATE sessions SET namespace_pid = ? WHERE id = ?` | pid, id | () |
| S5 | W | `touch_last_input` | `UPDATE sessions SET last_input_at = datetime('now') WHERE id = ?` | id | () |
| S6 | R | `get_last_token_checkpoint` | `SELECT COALESCE(last_token_checkpoint, 0) FROM sessions WHERE id = ?` | id | i64 |
| S7 | W | `update_last_token_checkpoint` | `UPDATE sessions SET last_token_checkpoint = ? WHERE id = ?` | checkpoint, id | () |
| S8 | R | `get_session` | `SELECT * FROM sessions WHERE id = ?` | id | Option<Session> |
| S9 | R | `list_active_sessions` | `SELECT * FROM sessions WHERE state = 'active' ORDER BY started_at DESC` | — | Vec<Session> |

---

### MODULE: students (`src/db/students.rs`)

| # | Op | Function | SQL | Params | Returns |
|---|----|----------|-----|--------|---------|
| ST1 | W | `insert_student` | `INSERT INTO students (id, username, password_hash, display_name, role, cohort_id, home_dir) VALUES (?, ?, ?, ?, ?, ?, ?)` | id, username, pw_hash, display_name, role, cohort_id, home_dir | () |
| ST2 | W | `touch_last_seen` | `UPDATE students SET last_seen = datetime('now') WHERE id = ?` | id | () |
| ST3a | W | `update_student` (display) | `UPDATE students SET display_name = ? WHERE id = ?` | display_name, id | () |
| ST3b | W | `update_student` (cohort) | `UPDATE students SET cohort_id = ? WHERE id = ?` | cohort_id, id | () |
| ST3c | W | `update_student` (password) | `UPDATE students SET password_hash = ? WHERE id = ?` | pw_hash, id | () |
| ST4a | W | `delete_student` (token_usage) | `DELETE FROM token_usage WHERE session_id IN (SELECT id FROM sessions WHERE student_id = ?)` | id | () |
| ST4b | W | `delete_student` (sessions) | `DELETE FROM sessions WHERE student_id = ?` | id | () |
| ST4c | W | `delete_student` (student_models) | `DELETE FROM student_models WHERE student_id = ?` | id | () |
| ST4d | W | `delete_student` (token_codes) | `DELETE FROM token_codes WHERE used_by = ?` | id | () (errors swallowed) |
| ST4e | W | `delete_student` (student) | `DELETE FROM students WHERE id = ?` | id | () |
| ST5 | W | `set_uid_slot` | `UPDATE students SET uid_slot = ? WHERE id = ?` | slot, id | () |
| ST6 | R | `get_student` | `SELECT * FROM students WHERE id = ?` | id | Option<Student> |
| ST7 | R | `get_student_by_username` | `SELECT * FROM students WHERE username = ?` | username | Option<Student> |
| ST8 | R | `list_students` | `SELECT * FROM students ORDER BY created_at DESC` | — | Vec<Student> |
| ST9 | W | `ban_student` | `UPDATE students SET restriction_status = datetime('now'), restriction_message = ? WHERE id = ?` | message, id | () |
| ST10 | W | `unban_student` | `UPDATE students SET restriction_status = NULL, restriction_message = NULL WHERE id = ?` | id | () |
| ST11 | W | `set_last_model` | `UPDATE students SET last_model = ? WHERE id = ?` | model, id | () |
| ST12 | R | `get_token_balance` | `SELECT token_balance FROM students WHERE id = ?` | id | i64 |
| ST13 | W | `deduct_tokens` | `UPDATE students SET token_balance = token_balance - ? WHERE id = ?` | amount, id | i64 (new balance) |
| ST14 | W | `topup_tokens` | `UPDATE students SET token_balance = token_balance + ? WHERE id = ?` | amount, id | i64 (new balance) |

---

### MODULE: cohorts (`src/db/cohorts.rs`)

| # | Op | Function | SQL | Params | Returns |
|---|----|----------|-----|--------|---------|
| C1 | W | `insert_cohort` | `INSERT INTO cohorts (id, title) VALUES (?, ?)` | id, title | () |
| C2a | W | `rename_cohort` (cohort) | `UPDATE cohorts SET id = ?, title = ? WHERE id = ?` | new_id, new_title, old_id | () |
| C2b | W | `rename_cohort` (subjects FK) | `UPDATE subjects SET cohort_id = ? WHERE cohort_id = ?` | new_id, old_id | () |
| C2c | W | `rename_cohort` (students FK) | `UPDATE students SET cohort_id = ? WHERE cohort_id = ?` | new_id, old_id | () |
| C3 | W | `update_cohort_title` | `UPDATE cohorts SET title = ? WHERE id = ?` | new_title, id | () |
| C4a | W | `delete_cohort` (subjects) | `DELETE FROM subjects WHERE cohort_id = ?` | id | () |
| C4b | W | `delete_cohort` (students unlink) | `UPDATE students SET cohort_id = '' WHERE cohort_id = ?` | id | () |
| C4c | W | `delete_cohort` (cohort) | `DELETE FROM cohorts WHERE id = ?` | id | () |
| C5 | R | `get_cohort` | `SELECT * FROM cohorts WHERE id = ?` | id | Option<Cohort> |
| C6 | R | `list_cohorts` | `SELECT * FROM cohorts ORDER BY created_at DESC` | — | Vec<Cohort> |

---

### MODULE: subjects (`src/db/subjects.rs`)

| # | Op | Function | SQL | Params | Returns |
|---|----|----------|-----|--------|---------|
| SU1 | W | `insert_subject` | `INSERT INTO subjects (id, cohort_id, slug, title) VALUES (?, ?, ?, ?)` | id, cohort_id, slug, title | () |
| SU2 | W | `update_subject` | `UPDATE subjects SET slug = ?, title = ? WHERE id = ?` | new_slug, new_title, id | () |
| SU3 | W | `delete_subject` | `DELETE FROM subjects WHERE id = ?` | id | () |
| SU4 | R | `get_subject` | `SELECT * FROM subjects WHERE id = ?` | id | Option<Subject> |
| SU5 | R | `get_subject_by_slug` | `SELECT * FROM subjects WHERE cohort_id = ? AND slug = ?` | cohort_id, slug | Option<Subject> |
| SU6 | R | `list_subjects` | `SELECT * FROM subjects WHERE cohort_id = ? ORDER BY created_at DESC` | cohort_id | Vec<Subject> |

---

### MODULE: assignments (`src/db/assignments.rs`)

| # | Op | Function | SQL | Params | Returns |
|---|----|----------|-----|--------|---------|
| A1 | W | `insert_assignment` | `INSERT INTO assignments (id, subject_id, title, description, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?)` | id, subject_id, title, description, due_date, created_by | () |
| A2 | R | `get_assignment` | `SELECT * FROM assignments WHERE id = ?` | id | Option<Assignment> |
| A3 | R | `list_assignments_for_subject` | `SELECT * FROM assignments WHERE subject_id = ? ORDER BY created_at DESC` | subject_id | Vec<Assignment> |
| A4 | R | `list_assignments_for_student` | `SELECT a.* FROM assignments a WHERE a.subject_id IN (SELECT value FROM json_each(?)) ORDER BY a.created_at DESC` | subject_ids_json (JSON array) | Vec<Assignment> |

---

### MODULE: token_usage (`src/db/token_usage.rs`)

| # | Op | Function | SQL | Params | Returns |
|---|----|----------|-----|--------|---------|
| TU1 | W | `record_turn` | `INSERT INTO token_usage (id, session_id, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)` | id, session_id, model, input, output, cache_create, cache_read | () |
| TU2 | R | `session_totals` | `SELECT COALESCE(SUM(input_tokens),0) AS total_input_tokens, COALESCE(SUM(output_tokens),0) AS total_output_tokens, COALESCE(SUM(cache_creation_tokens),0) AS total_cache_creation_tokens, COALESCE(SUM(cache_read_tokens),0) AS total_cache_read_tokens, COUNT(*) AS turn_count FROM token_usage WHERE session_id = ?` | session_id | SessionTokenTotals |
| TU3 | R | `student_total_tokens` | `SELECT COALESCE(SUM(tu.input_tokens + tu.output_tokens), 0) FROM token_usage tu JOIN sessions s ON s.id = tu.session_id WHERE s.student_id = ?` | student_id | i64 |
| TU4 | W | `record_deduction` | `INSERT INTO token_deductions (id, student_id, session_id, model_name, multiplier, input_multiplier, output_multiplier, input_tokens_used, output_tokens_used, input_tokens_deducted, output_tokens_deducted, tokens_used, tokens_deducted, balance_before, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` | 15 params (see source) | () |

---

### MODULE: token_codes (`src/db/token_codes.rs`)

| # | Op | Function | SQL | Params | Returns |
|---|----|----------|-----|--------|---------|
| TC1 | W×N | `generate_codes` | `INSERT INTO token_codes (id, code, tokens) VALUES (?, ?, ?)` | id, code, tokens (loop) | Vec<String> |
| TC2 | R | `list_codes` | `SELECT * FROM token_codes WHERE 1=1 [AND tokens = ?] [AND used_by IS/IS NOT NULL] ORDER BY created_at DESC LIMIT 500` | tokens (optional) | Vec<TokenCode> |
| TC3 | W | `delete_code` | `DELETE FROM token_codes WHERE id = ?` | id | () |
| TC4a | R | `redeem_code` (lookup) | `SELECT * FROM token_codes WHERE code = ?` | code | Option<TokenCode> |
| TC4b | W | `redeem_code` (mark used) | `UPDATE token_codes SET used_by = ?, used_at = datetime('now') WHERE id = ?` | student_id, tc.id | () |
| TC4c | W | `redeem_code` (add tokens) | `UPDATE students SET token_balance = token_balance + ? WHERE id = ?` | tc.tokens, student_id | () |
| TC5 | R | `export_codes` | `SELECT * FROM token_codes WHERE tokens = ? ORDER BY created_at ASC` | tokens | Vec<TokenCode> |

---

### MODULE: schema init (`src/db/schema.rs`) — startup DDL

| # | Op | Purpose |
|---|----|---------|
| DDL1-10 | W | CREATE TABLE for all 10 tables |
| DDL11-17 | W | ALTER TABLE column additions (idempotent, errors swallowed) |
| DDL18-22 | W | CREATE INDEX statements |
| DDL23-25 | W | Migration UPDATEs (home_dir, restriction fields, multiplier split) |
| DDL26 | W | Seed default model: `INSERT OR IGNORE INTO models ... 'grok-4-1-fast-reasoning'` |
| DDL27 | W | Cleanup stale sessions: `UPDATE sessions SET state = 'ended', ended_at = datetime('now') WHERE state = 'active'` |

---

## 3. Query Count Summary

| Module | Reads | Writes | Total |
|--------|-------|--------|-------|
| models | 7 | 8 | 15 |
| sessions | 3 | 8 | 11 |
| students | 4 | 13 | 17 |
| cohorts | 2 | 8 | 10 |
| subjects | 3 | 3 | 6 |
| assignments | 3 | 1 | 4 |
| token_usage | 2 | 2 | 4 |
| token_codes | 4 | 4 | 8 |
| schema DDL | 0 | 27 | 27 |
| **Total** | **28** | **74** | **102** |

---

## 4. Consolidation Opportunities for HelixDB

### High-impact merges (multi-query → single traversal)

| Current SQLite | HelixDB approach |
|---|---|
| `delete_student` (5 queries in FK order) | Single `Drop` on Student node with cascading edge deletions |
| `student_total_tokens` (JOIN sessions + token_usage + SUM) | Single traversal: Student → HAS_SESSION → HAS_TOKEN_USAGE → AggregateBy Sum |
| `rename_cohort` (3 queries updating FK refs) | Rename cohort node label/id; edges auto-follow |
| `delete_cohort` (3 queries) | Drop cohort node + cascade edges |
| `redeem_code` (3 queries: lookup + mark + update balance) | Single write batch: Coalesce lookup → SetProperty + AddE |
| `set_student_models` (DELETE + N INSERTs) | Single write: Drop existing edges + AddE for new models |
| `list_assignments_for_student` (json_each IN clause) | Traversal: Student → IN_COHORT → HAS_SUBJECT → HAS_ASSIGNMENT |
| `session_totals` (SUM + COUNT) | Single traversal with AggregateBy |
| `raw_assignments_for_student` (JOIN student_models + models) | Traversal: Student → ALLOWED_MODEL → filter enabled |

### Queries that map 1:1 to HelixDB

All simple CRUD: get by id, list all, insert, update single field, delete single entity.
