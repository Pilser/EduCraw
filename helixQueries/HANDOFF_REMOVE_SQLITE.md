# HANDOFF: Project Manager — SQLite Removal Oversight

## ⚠️ Your Role

**You are the manager. You do NOT write code.**

Your job:
1. **Hand off** `helixQueries/REMOVE_SQLITE.md` to an implementing agent
2. **Verify** the implementing agent's work is correct
3. **Plan** the next phase after SQLite is removed

---

## Project State

**What's done:** Full HelixDB migration. All API handlers and `acp_bridge/` modules use `DbBackend`. Both `--features sqlite` and `--features helix` compile cleanly.

**What's left:** Delete dead SQLite code. Nothing to design, nothing to rewrite. Pure deletion and import cleanup.

---

## The Implementing Guide

`helixQueries/REMOVE_SQLITE.md` — This is the document you give to the implementing agent. It contains the complete step-by-step plan with code snippets, file paths, and line numbers.

**Do not implement it yourself.** Give it to an agent and tell them to follow it exactly.

---

## Your Verification Checklist

After the implementing agent reports done, verify these:

- [ ] `cargo check -p educlaw-server` passes (no `--features` flag)
- [ ] `cargo build --release -p educlaw-server` succeeds
- [ ] `rg "sqlx|SqlitePool|sqlite|DATABASE_URL" educlaw-server/src/` returns ZERO matches
- [ ] `educlaw-server/src/db/` directory is gone
- [ ] `educlaw-server/src/acp_bridge/stats.rs` is gone

If any check fails, send the implementing agent back to fix it.

---

## Common Mistakes to Watch For

| Mistake | How to catch it |
|---------|----------------|
| Forgot to remove `mod db;` from `main.rs` | `cargo check` will fail with "cannot find module `db`" |
| Left `pool` field in `AppState` | `cargo check` will fail with "cannot find type `SqlitePool`" |
| Didn't remove `sqlx` from workspace `Cargo.toml` | `cargo check` may still pass but `sqlx` remains as unused dep |
| Wrong error type in `error.rs` | `cargo check` will fail on `AppError` impl |

---

## After SQLite is Removed — Plan Next

Once verified, the next phases to consider:

1. **Runtime testing** — Start server, hit all API routes, verify sessions and token accounting work with HelixDB
2. **Remove `DB_BACKEND` env var** — Only one backend now, the check is dead code
3. **Remove `helix` feature flag** — It's the only option, make it default
4. **Review deferred `acp_bridge` persistence** — Plan stats, mode changes, config snapshots are logged but not persisted to HelixDB
5. **Performance review** — Check if any HelixDB queries are slow under load

---

## Reference Files

| File | Purpose |
|------|---------|
| `helixQueries/REMOVE_SQLITE.md` | **Give this to the implementing agent** |
| `helixQueries/GRAPH_DESIGN.md` | Graph schema reference |
| `helixQueries/QUERY_ANALYSIS.md` | SQLite → HelixDB mapping |
| `educlaw-helix/src/backend.rs` | `DbBackend` trait |
| `educlaw-helix/src/lib.rs` | Crate exports, error types |
