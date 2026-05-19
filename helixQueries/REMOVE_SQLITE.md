# Task: Remove SQLite Completely

## Context

The HelixDB backend is fully wired and functional. This doc guides the removal of all SQLite code from `educlaw-server`. After this, `educlaw-helix` is the **only** database backend.

---

## Pre-Removal Checklist (MUST verify first)

- [ ] HelixDB instance is running and accessible
- [ ] `DB_BACKEND=helix` in `.env` works — server starts and serves requests
- [ ] All API routes tested: students CRUD, sessions CRUD, admin routes, auth, models, cohorts, subjects, token codes
- [ ] Token recording (`record_turn`, `record_deduction`) works during active sessions
- [ ] Frontend (lit-admin) loads and displays data correctly
- [ ] No runtime errors in server logs related to Helix queries

---

## Phase 1: Remove `sqlite` Feature and Dependency

### `educlaw-server/Cargo.toml`

Remove:
```toml
[features]
sqlite = ["dep:sqlx"]          # DELETE THIS LINE

[dependencies]
sqlx = { workspace = true, optional = true }   # DELETE THIS LINE
```

Keep:
```toml
[features]
default = []
helix = ["dep:educlaw-helix"]

[dependencies]
educlaw-helix = { path = "../educlaw-helix" }   # Make non-optional
```

### `Cargo.toml` (workspace root)

Remove from `[workspace.dependencies]`:
```toml
sqlx = { version = "0.7", features = ["runtime-tokio-native-tls", "sqlite", "macros"] }
```

---

## Phase 2: Remove SQLite Modules

Delete these files entirely:
```
educlaw-server/src/db/schema.rs      # SQLite DDL migrations
educlaw-server/src/db/models.rs      # SQLite model queries
educlaw-server/src/db/sessions.rs    # SQLite session queries
educlaw-server/src/db/students.rs    # SQLite student queries
educlaw-server/src/db/cohorts.rs     # SQLite cohort queries
educlaw-server/src/db/subjects.rs    # SQLite subject queries
educlaw-server/src/db/assignments.rs # SQLite assignment queries (if still exists)
educlaw-server/src/db/token_usage.rs # SQLite token usage queries
educlaw-server/src/db/token_codes.rs # SQLite token code queries
```

Delete the `educlaw-server/src/db/` directory entirely.

---

## Phase 3: Clean Up `db/backend.rs`

This file currently contains:
1. `DbBackend` trait (KEEP — but move to a cleaner location)
2. `SqliteBackend` impl (DELETE — ~500 lines)
3. `HelixBackend` wrapper (DELETE — no longer needed, use `educlaw_helix::HelixClient` directly)
4. Type conversion functions (KEEP — but simplify)

**Replace the entire file** with just the trait and a thin adapter:

```rust
// educlaw-server/src/backend.rs
use async_trait::async_trait;
use educlaw_helix::{HelixClient, DbBackend as HelixDb, Result as HelixResult};
use educlaw_helix::{Model, Student, Session, Cohort, Subject, TokenCode, TokenDeduction, StudentTotals, SessionTotals, TurnTokens, RedeemResult};

// Re-export the trait so API handlers use this path
pub use educlaw_helix::DbBackend;

// Type aliases for local types if any API handlers still reference them
pub type BackendResult<T> = Result<T, crate::error::AppError>;
```

Since `educlaw_helix::HelixClient` already implements `educlaw_helix::DbBackend`, you don't need `SqliteBackend` or `HelixBackend` wrapper anymore. Use `HelixClient` directly.

---

## Phase 4: Update `main.rs`

Remove all SQLite initialization:

```rust
// DELETE:
use sqlx::sqlite::SqlitePoolOptions;
use crate::db::schema::init_db;
use crate::db::backend::SqliteBackend;

// DELETE:
let database_url = std::env::var("DATABASE_URL")...
let pool = SqlitePoolOptions::new()...
init_db(&pool).await?;

// REPLACE backend selection with:
let backend: Arc<dyn educlaw_helix::DbBackend> = {
    tracing::info!("using HelixDB backend");
    educlaw_helix::validate_queries()?;
    let config = educlaw_helix::HelixConfig::from_env();
    let client = educlaw_helix::HelixClient::new(config);
    educlaw_helix::init_schema(&client).await?;
    Arc::new(client)
};
```

Remove `pool` from `AppState::new()` call.

---

## Phase 5: Update `AppState`

**File**: `educlaw-server/src/api/common.rs`

Remove `pool` field:
```rust
pub struct AppState {
    pub backend: Arc<dyn educlaw_helix::DbBackend>,  // Keep
    pub auth: crate::auth::AuthConfig,
    pub workspace_root: String,
    pub goose_bin: String,
    pub broker: crate::session::broker::SessionBroker,
    pub registry: Arc<crate::session::registry::SessionRegistry>,
    pub subjects_root: String,
    pub students_root: String,
    // DELETE: pub pool: SqlitePool,
}
```

Update `new()` constructor to not take `pool`.

---

## Phase 6: Fix Remaining `state.pool` References

These files still reference `state.pool` directly (not through `DbBackend`):

| File | Line | Usage | Fix |
|------|------|-------|-----|
| `api/sse.rs` | 66, 135, 157, 206 | `db_sess::get_session(&state.pool, ...)` | Use `state.backend.get_session()` |
| `api/threads.rs` | 60, 118 | `db_sess::get_session(&state.pool, ...)` | Use `state.backend.get_session()` |
| `api/files.rs` | 199 | `students::get_student(&state.pool, ...)` | Use `state.backend.get_student()` |
| `api/sessions.rs` | 252 | `state.pool.clone()` for watchdog | Remove — watchdog doesn't need DB, or pass backend |

Update each to use `state.backend.method()` instead.

---

## Phase 7: Remove Unused Imports

After deleting modules, fix import errors:

```rust
// DELETE from any file:
use crate::db::students;
use crate::db::sessions;
use crate::db::models;
use crate::db::cohorts;
use crate::db::subjects;
use crate::db::token_codes;
use crate::db::token_usage;
use crate::db::schema;
```

Replace with:
```rust
use crate::db::backend::DbBackend;
```

---

## Phase 8: Update `mod.rs` Files

**`educlaw-server/src/db/mod.rs`** — DELETE the entire file (directory is gone).

**`educlaw-server/src/main.rs`** — Remove `mod db;` declaration.

---

## Phase 9: Remove `educraw.db` References

If any code references the SQLite file path, remove it. The `DATABASE_URL` env var is no longer needed.

---

## Phase 10: Build Verification

```bash
cargo check -p educlaw-server
cargo check -p educlaw-helix
cargo build --release -p educlaw-server
```

All must pass with NO `--features` flag (helix is now the default and only backend).

---

## Post-Removal Structure

```
educlaw-server/src/
├── main.rs              # No SQLite, only HelixClient init
├── error.rs             # AppError with From<HelixError>
├── auth.rs              # Unchanged
├── backend.rs           # Re-exports educlaw_helix::DbBackend
├── api/
│   ├── mod.rs           # AppState without pool
│   ├── common.rs        # AppState struct
│   ├── admin.rs         # Uses state.backend.*
│   ├── students.rs      # Uses state.backend.*
│   ├── sessions.rs      # Uses state.backend.*
│   ├── auth_routes.rs   # Uses state.backend.*
│   ├── threads.rs       # Uses state.backend.*
│   ├── sse.rs           # Uses state.backend.*
│   └── files.rs         # Uses state.backend.*
├── acp_bridge/          # Unchanged (calls backend for token recording)
├── session/             # Unchanged
└── security/            # Unchanged
```

---

## Runtime Configuration (After Removal)

Only env vars needed:
```
DB_BACKEND=helix              # Always helix now (can remove this check)
HELIX_URL=http://localhost:8000
HELIX_TIMEOUT=30
JWT_SECRET=...
GOOSE_BIN=...
EDUCLAW_WORKSPACE_ROOT=...
EDUCLAW_SUBJECTS_ROOT=...
EDUCLAW_STUDENTS_ROOT=...
EDUCLAW_WEB_ROOT=...
BIND_ADDR=0.0.0.0:8080
```

`DATABASE_URL` is no longer needed.

---

## Validation Checklist

- [ ] `cargo check` passes with no features flag
- [ ] `cargo build --release` produces binary
- [ ] Server starts with `DB_BACKEND=helix` in `.env`
- [ ] All API routes work (test with curl or frontend)
- [ ] Session creation works (creates Session node + edges in HelixDB)
- [ ] Token recording works during active sessions
- [ ] Admin panel loads students, cohorts, subjects, models
- [ ] Student login works
- [ ] Token code redemption works
- [ ] No `sqlx`, `SqlitePool`, or `DATABASE_URL` references remain in code
- [ ] `educraw.db` file is no longer created or used
