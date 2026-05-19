# Task: Remove SQLite Completely

## Context

The HelixDB backend is fully wired and functional. All API handlers and `acp_bridge/` modules (except the unused `stats.rs`) have been migrated to use `DbBackend`. This doc guides the removal of all remaining SQLite code from `educlaw-server`. After this, `educlaw-helix` is the **only** database backend.

---

## Current State (Pre-Removal Audit)

### ✅ Already Migrated to DbBackend
- All API handlers in `api/*.rs` — use `state.backend.*()`
- `acp_bridge/client.rs` — uses `Arc<dyn DbBackend>`
- `acp_bridge/session.rs` — uses `Arc<dyn DbBackend>`
- `acp_bridge/token_calculator.rs` — uses `&dyn DbBackend`
- `acp_bridge/model_poller.rs` — uses `Arc<dyn DbBackend>`
- `acp_bridge/notifications.rs` — no DB calls (pure frame conversion)
- `acp_bridge/commands.rs` — no DB calls (pure ACP forwarding)
- `acp_bridge/permissions.rs` — no DB calls (pure logic)
- `acp_bridge/images.rs` — no DB calls (pure image parsing)
- `acp_bridge/custom_requests.rs` — no DB calls (re-exports)

### ⚠️ Remaining SQLite References (All Will Be Removed)

| Location | What | Action |
|----------|------|--------|
| `db/*.rs` (all 9 files) | Entire SQLite module directory | **Delete entire directory** |
| `main.rs:18` | `use sqlx::sqlite::SqlitePoolOptions` | Remove import + pool creation |
| `api/mod.rs:15,27,45` | `SqlitePool` in `AppState` | Remove `pool` field from `AppState` |
| `db/backend.rs` | `SqliteBackend` impl (~500 lines) | Delete entire file, keep trait re-export |
| `error.rs:14` | `Db(#[from] sqlx::Error)` | Replace with Helix error variant |
| `api/admin.rs:1265` | `#[derive(Serialize, sqlx::FromRow)]` on unused `TokenDeductionRecord` | Remove `sqlx::FromRow` (struct is dead code — function uses `backend.deduction_history()`) |
| `acp_bridge/stats.rs` | Full file uses `SqlitePool` directly | **Delete file** — commented out in `mod.rs`, never compiled |
| `acp_bridge/client.rs:121` | Commented-out `pool.clone()` | Remove comment |

### ✅ No Remaining `state.pool` Usage
- Grep for `state\.pool` in `api/` returns **zero matches** — all migrated.

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
educlaw-server/src/db/                         # DELETE ENTIRE DIRECTORY
├── mod.rs
├── schema.rs      # SQLite DDL migrations
├── models.rs      # SQLite model queries
├── sessions.rs    # SQLite session queries
├── students.rs    # SQLite student queries
├── cohorts.rs     # SQLite cohort queries
├── subjects.rs    # SQLite subject queries
├── assignments.rs # SQLite assignment queries (if still exists)
├── token_usage.rs # SQLite token usage queries
├── token_codes.rs # SQLite token code queries
└── backend.rs     # SqliteBackend impl + trait (trait re-exported elsewhere)

educlaw-server/src/acp_bridge/stats.rs         # DELETE — unused, commented out in mod.rs
```

---

## Phase 3: Clean Up `db/backend.rs`

The entire `db/backend.rs` file is **deleted** (part of Phase 2 directory removal).

The `DbBackend` trait lives in `educlaw-helix` and is used directly. No wrapper or adapter needed.

If any file imports `crate::db::backend::DbBackend`, change to:
```rust
use educlaw_helix::DbBackend;
```

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

## Phase 6: Fix Remaining `sqlx` References in Non-DB Files

These files have residual `sqlx` references that must be cleaned up:

| File | Line | Usage | Fix |
|------|------|-------|-----|
| `api/admin.rs` | 1265 | `#[derive(Serialize, sqlx::FromRow)]` on `TokenDeductionRecord` | Remove `sqlx::FromRow` — struct is dead code, function uses `backend.deduction_history()` |
| `error.rs` | 14 | `Db(#[from] sqlx::Error)` | Replace with `Helix(#[from] educlaw_helix::HelixError)` or similar |
| `acp_bridge/client.rs` | 121 | Commented-out `// pool.clone(),` | Remove the comment |

**No `state.pool` references remain** — grep returns zero matches in `api/`.

---

## Phase 7: Remove Unused Imports

After deleting modules, fix import errors:

```rust
// DELETE from any file:
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;
use crate::db::students;
use crate::db::sessions;
use crate::db::models;
use crate::db::cohorts;
use crate::db::subjects;
use crate::db::token_codes;
use crate::db::token_usage;
use crate::db::schema;
use crate::db::backend::{DbBackend, SqliteBackend, HelixBackend};
```

Affected files:
- `main.rs` — remove `SqlitePoolOptions`, `init_db`, `SqliteBackend` imports
- `api/mod.rs` — remove `SqlitePool` import and `pool` field from `AppState`
- `error.rs` — replace `sqlx::Error` with Helix error type
- `api/admin.rs` — remove `sqlx::FromRow` from `TokenDeductionRecord` derive

---

## Phase 8: Update `mod.rs` Files

**`educlaw-server/src/db/mod.rs`** — DELETED (directory is gone).

**`educlaw-server/src/main.rs`** — Remove `mod db;` declaration.

**`educlaw-server/src/acp_bridge/mod.rs`** — Remove `mod stats;` line (already commented out, delete the comment too).

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
├── error.rs             # AppError with Helix error variant (no sqlx)
├── auth.rs              # Unchanged
├── api/
│   ├── mod.rs           # AppState without pool field
│   ├── common.rs        # AppState struct
│   ├── admin.rs         # Uses state.backend.*, no sqlx::FromRow
│   ├── students.rs      # Uses state.backend.*
│   ├── sessions.rs      # Uses state.backend.*
│   ├── auth_routes.rs   # Uses state.backend.*
│   ├── threads.rs       # Uses state.backend.*
│   ├── sse.rs           # Uses state.backend.*
│   └── files.rs         # Uses state.backend.*
├── acp_bridge/
│   ├── mod.rs           # No stats module
│   ├── client.rs        # Uses Arc<dyn DbBackend>
│   ├── session.rs       # Uses Arc<dyn DbBackend>
│   ├── token_calculator.rs  # Uses &dyn DbBackend
│   ├── model_poller.rs  # Uses Arc<dyn DbBackend>
│   ├── notifications.rs # Pure frame conversion (no DB)
│   ├── commands.rs      # Pure ACP forwarding (no DB)
│   ├── permissions.rs   # Pure logic (no DB)
│   ├── images.rs        # Pure image parsing (no DB)
│   └── custom_requests.rs  # Re-exports (no DB)
├── session/             # Unchanged
└── security/            # Unchanged
```

No `db/` directory. No `stats.rs`. No `sqlx` anywhere.

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
- [ ] Server starts with HelixDB env vars
- [ ] All API routes work (test with curl or frontend)
- [ ] Session creation works (creates Session node + edges in HelixDB)
- [ ] Token recording works during active sessions
- [ ] Admin panel loads students, cohorts, subjects, models
- [ ] Student login works
- [ ] Token code redemption works
- [ ] **Zero** `sqlx`, `SqlitePool`, `sqlite`, or `DATABASE_URL` references remain in code
- [ ] **Zero** `db/` directory exists
- [ ] **Zero** `acp_bridge/stats.rs` exists
- [ ] `educraw.db` file is no longer created or used
