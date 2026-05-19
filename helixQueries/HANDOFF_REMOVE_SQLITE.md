# HANDOFF: SQLite Removal — Final Phase

## Role Transfer

This document transfers the **orchestrator/manager role** to the next agent. The previous agent managed the project by: analyzing code → writing detailed handoff docs → delegating to agents → verifying → iterating. You are now in that role.

---

## Project Overview

**Goal:** Migrate `educlaw-server` from SQLite to HelixDB (graph database).

**Architecture:**
- `educlaw-server` — Rust Axum web server (sessions, auth, admin API, ACP bridge to Goose AI)
- `educlaw-helix` — HelixDB client crate with `DbBackend` trait
- `helixQueries/` — 66 JSON query templates embedded at compile time
- `acp_bridge/` — Real-time bridge between browser SSE and Goose ACP subprocess

**Key design:** `DbBackend` trait abstracts all DB ops. `Arc<dyn DbBackend>` flows through `AppState` → API handlers → `acp_bridge` modules.

---

## What's Been Completed

| Phase | Status | Deliverable |
|-------|--------|-------------|
| Graph design | ✅ Done | `helixQueries/GRAPH_DESIGN.md` |
| SQLite query analysis | ✅ Done | `helixQueries/QUERY_ANALYSIS.md` |
| 66 HelixDB JSON queries | ✅ Done | `helixQueries/educraw-queries/*.json` |
| `educlaw-helix` crate | ✅ Done | `DbBackend` trait + `HelixClient` impl |
| Wire Helix into server | ✅ Done | `main.rs`, `AppState`, backend selection |
| Migrate all API handlers | ✅ Done | `api/*.rs` use `state.backend.*()` |
| Migrate `acp_bridge/` | ✅ Done | `client.rs`, `session.rs`, `token_calculator.rs`, `model_poller.rs` use `DbBackend` |
| Separate input/output tokens | ✅ Done | `TokenUsage` tracks both, `Model` has `input_multiplier` + `output_multiplier` |
| Compilation verified | ✅ Done | `--features sqlite` and `--features helix` both compile cleanly |

---

## What's Left: Execute `REMOVE_SQLITE.md`

The migration is **functionally complete**. All runtime code paths use HelixDB. What remains is **mechanical cleanup** — deleting dead SQLite code and removing the `sqlx` dependency.

### Scope of Work

1. **Delete `educlaw-server/src/db/` directory** (9 files — all SQLite queries + `SqliteBackend` impl)
2. **Delete `educlaw-server/src/acp_bridge/stats.rs`** (unused, commented out in `mod.rs`)
3. **Remove `sqlx` from `Cargo.toml`** files (workspace + educlaw-server)
4. **Remove `sqlite` feature** from `educlaw-server/Cargo.toml`
5. **Clean up imports** in files that still reference `sqlx`:
   - `main.rs` — remove `SqlitePoolOptions`, `init_db`, `SqliteBackend`, pool creation, `mod db;`
   - `api/mod.rs` — remove `SqlitePool` from `AppState` struct and constructor
   - `error.rs` — replace `Db(#[from] sqlx::Error)` with Helix error variant
   - `api/admin.rs:1265` — remove `sqlx::FromRow` from dead `TokenDeductionRecord` struct
   - `acp_bridge/mod.rs` — remove commented-out `// pub mod stats;` line
   - `acp_bridge/client.rs:121` — remove stale `// pool.clone(),` comment
6. **Make `educlaw-helix` non-optional** in `educlaw-server/Cargo.toml`
7. **Verify build**: `cargo check -p educlaw-server` passes with no features flag

### Detailed Instructions

See `helixQueries/REMOVE_SQLITE.md` for the full step-by-step guide with code snippets, file paths, and line numbers.

### Execution Order

```
Phase 1: Remove sqlx from Cargo.toml files
Phase 2: Delete db/ directory and stats.rs
Phase 3: Update main.rs (remove SQLite init, mod db, pool)
Phase 4: Update api/mod.rs (remove pool from AppState)
Phase 5: Update error.rs (replace sqlx::Error)
Phase 6: Clean up admin.rs, acp_bridge/mod.rs, acp_bridge/client.rs
Phase 7: cargo check → fix any remaining import errors
Phase 8: cargo build --release → verify
```

---

## How to Manage This

### Pattern

1. **Read** `REMOVE_SQLITE.md` for the full plan
2. **Execute** phases sequentially
3. **Run** `cargo check` after each phase that touches code
4. **Fix** compilation errors as they appear (usually missing imports)
5. **Verify** final build with `cargo build --release -p educlaw-server`

### If Something Breaks

- Most errors will be "cannot find module `db`" or "unresolved import `sqlx`" — these are expected, just remove the references
- If a Helix query is missing a method, check `helixQueries/educraw-queries/` for the JSON template and `educlaw-helix/src/backend.rs` for the trait definition
- If `AppState` changes break API handlers, the fix is usually removing `state.pool` from a constructor call

### Files to Reference

| File | Purpose |
|------|---------|
| `helixQueries/REMOVE_SQLITE.md` | **Primary guide** — step-by-step with code snippets |
| `helixQueries/GRAPH_DESIGN.md` | Graph schema (nodes, edges, properties) |
| `helixQueries/QUERY_ANALYSIS.md` | How SQLite queries map to HelixDB |
| `helixQueries/educraw-queries/` | 66 JSON query templates |
| `educlaw-helix/src/backend.rs` | `DbBackend` trait definition |
| `educlaw-helix/src/types.rs` | Shared types (Student, Session, Model, etc.) |

---

## Post-Removal Verification

After all SQLite code is removed:

```bash
# 1. Compile check
cargo check -p educlaw-server
cargo check -p educlaw-helix

# 2. Build release
cargo build --release -p educlaw-server

# 3. Grep for any remaining SQLite references
rg "sqlx|SqlitePool|sqlite|DATABASE_URL" educlaw-server/src/
# Should return ZERO matches

# 4. Verify db/ directory is gone
ls educlaw-server/src/db/
# Should return "No such file or directory"
```

---

## Known Risks

1. **`error.rs` change** — replacing `sqlx::Error` with a Helix error variant may require updating `AppError::from_helix()` or adding a new variant. Check `educlaw-helix/src/lib.rs` for the error type.
2. **`AppState::new()`** — removing `pool` parameter means all callers of `AppState::new()` must be updated (likely just `main.rs`).
3. **`mod db;` removal** — `main.rs` has `mod db;` which declares the entire `db/` module tree. Removing it is required after deleting the directory.

---

## Context for the Next Agent

- This is a **cleanup task**, not a design task. The architecture is already correct.
- Every API handler and `acp_bridge` module already uses `DbBackend`. Nothing needs rewriting.
- The only work is **deletion and import cleanup**.
- If `cargo check` fails, it's always because of a leftover reference to deleted code — not a logic error.
