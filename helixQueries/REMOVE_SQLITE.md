# Task: Remove SQLite Completely

## Context

The HelixDB backend is fully wired and functional. All API handlers and `acp_bridge/` modules have been migrated to use `DbBackend`. This doc guides the removal of all remaining SQLite code from `educlaw-server`. After this, `educlaw-helix` is the **only** database backend.

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
| `db/*.rs` (10 files) | Entire SQLite module directory | **Delete entire directory** |
| `main.rs:18` | `use sqlx::sqlite::SqlitePoolOptions` | Remove import + pool creation |
| `api/mod.rs:15,27,45` | `SqlitePool` in `AppState` | Remove `pool` field from `AppState` |
| `db/mod.rs` | `SqliteBackend` + `HelixBackend` + trait + re-exports (~308 lines) | **Rewrite** — see Phase 3 |
| `error.rs:14` | `Db(#[from] sqlx::Error)` | Replace with Helix error variant |
| `api/admin.rs:1274` | `#[derive(Serialize, sqlx::FromRow)]` on unused `TokenDeductionRecord` | Remove `sqlx::FromRow` |
| `acp_bridge/stats.rs` | Full file uses `SqlitePool` directly | **Delete file** — commented out in `mod.rs` |
| `acp_bridge/client.rs:120-126` | Commented-out `spawn_token_accounting(pool.clone(), ...)` | Remove the comment block |

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
- [ ] Session model name stored correctly — `set_session_model`, `set_session_model_api`, `set_last_model` all pass `model_name` (not `model`) as the param key (fixed in recent audit)
- [ ] All timestamps use `chrono::Utc::now().to_rfc3339()` via params — no `"Expr": "Timestamp"` remains in any JSON template (converted in recent audit)

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

Delete these files/dirs entirely:
```
educlaw-server/src/db/sqlite/                 # DELETE ENTIRE SUBDIRECTORY
educlaw-server/src/db/schema.rs               # DELETE — SQLite DDL migrations
educlaw-server/src/db/cohorts.rs              # DELETE — SQLite query modules
educlaw-server/src/db/models.rs               # DELETE
educlaw-server/src/db/sessions.rs             # DELETE
educlaw-server/src/db/students.rs             # DELETE
educlaw-server/src/db/subjects.rs             # DELETE
educlaw-server/src/db/token_codes.rs          # DELETE
educlaw-server/src/db/token_usage.rs          # DELETE

educlaw-server/src/acp_bridge/stats.rs        # DELETE — unused, commented out in mod.rs
```

Note: `db/backend.rs` does **not** exist. All trait + impl code is in `db/mod.rs`.
Note: `assignments.rs` does **not** exist.

---

## Phase 3: Restructure `db/mod.rs`

`db/mod.rs` (~308 lines) defines the `DbBackend` trait, `SqliteBackend` struct+impl, `HelixBackend` struct+impl, and re-exports from the SQLite helper modules. After Phase 2, the SQLite module declarations and `SqliteBackend` must be removed, and the `HelixBackend` must be restructured.

### What to Remove from `db/mod.rs`

| Item | Lines | Action |
|------|-------|--------|
| `use sqlx::SqlitePool;` | 7 | Remove |
| `pub mod cohorts;` through `pub mod token_usage;` | 11-18 | Remove module decls |
| `pub mod sqlite;` | 22 | Remove |
| Re-exports (`pub use crate::db::...`) | 28-34 | **KEEP** — types used by API handlers |
| `BackendError::Db` variant | 43 | Remove variant |
| `From<BackendError> for AppError` impl `Db` arm | 56 | Remove arm |
| `SqliteBackend` struct + impl (entire block) | 139-218 | Remove |
| `use educlaw_helix::DbBackend as HelixDb` | 223 | Remove (aliasing is confusing) |
| `HelixBackend` struct | 226 | Keep |
| `HelixBackend::new()` | 229 | Keep |
| `impl DbBackend for HelixBackend` delegations | 233-307 | **Rewrite** — currently delegates to `_*` methods in `db/helix/` subdir, which themselves delegate to `HelixDb` methods. After Phase 2 removes `db/` subdirs, these must delegate to `HelixClient` directly. |

### How to Restructure HelixBackend

Currently the delegation chain is:
```
HelixBackend::method()
  → HelixBackend::_method()     (in db/helix/*.rs)
    → educlaw_helix::HelixClient::_method()   (in educlaw-helix/src/backend/*.rs)
```

After removing `db/helix/` subdirectory, the `HelixBackend` must call `HelixClient` methods directly:
```
HelixBackend::method()
  → self.client._method()
```

So `db/mod.rs` becomes a single file containing:
- The `DbBackend` trait
- `HelixBackend` struct (holds `HelixClient`)
- `impl DbBackend for HelixBackend` (delegates to `self.client._method()`)
- Re-exports of domain types

The cleaned up file would look like:
```rust
use async_trait::async_trait;
use educlaw_helix::HelixClient;

// ── Re-export domain types ──
// (These come from educlaw-helix types now, not from SQLite modules)
pub use educlaw_helix::{ Cohort, Model, Session, Student, Subject, TokenCode, TokenDeductionRecord };

pub type BackendResult<T> = std::result::Result<T, BackendError>;

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("internal: {0}")]
    Internal(#[from] anyhow::Error),
    #[error("helix error: {0}")]
    Helix(#[from] educlaw_helix::HelixError),
}

impl From<BackendError> for crate::error::AppError {
    fn from(err: BackendError) -> Self { /* ... */ }
}

#[async_trait]
pub trait DbBackend: Send + Sync { /* all method signatures */ }

pub struct HelixBackend { client: HelixClient }
impl HelixBackend { pub fn new(client: HelixClient) -> Self { Self { client } } }

#[async_trait]
impl DbBackend for HelixBackend {
    // Each method delegates to self.client._method()
    async fn list_models(&self) -> BackendResult<Vec<Model>> {
        Ok(self.client._list_models().await?)
    }
    // ...
}
```

### Which Types Need Re-export?

Currently re-exported from `db/mod.rs:28-34`:
- `Cohort` — from `db/cohorts.rs`
- `Model` — from `db/models.rs`
- `Session` — from `db/sessions.rs`
- `Student` — from `db/students.rs`
- `Subject` — from `db/subjects.rs`
- `RedeemResult, TokenCode` — from `db/token_codes.rs`
- `SessionTokenTotals, StudentTokenTotals, TokenDeductionRecord, TurnTokens` — from `db/token_usage.rs`

These same types exist in `educlaw-helix/src/types.rs` with the same field names. They can be re-exported from there. If field names differ, a conversion layer (`conv.rs` already exists in `db/helix/conv.rs`) would be needed in the new `HelixBackend`.

---

## Phase 4: Update `main.rs`

Remove all SQLite initialization:

```rust
// DELETE:
use sqlx::sqlite::SqlitePoolOptions;
use crate::db::schema::init_db;
use crate::db::SqliteBackend;
use crate::db::HelixBackend;

// DELETE (lines 61-68):
let database_url = std::env::var("DATABASE_URL")...
let pool = SqlitePoolOptions::new()...
init_db(&pool).await?;

// REPLACE the backend selection block (lines 109-136) with:
let backend: Arc<crate::db::HelixBackend> = {
    tracing::info!("using HelixDB backend");
    educlaw_helix::validate_queries()?;
    let config = educlaw_helix::HelixConfig::from_env()
        .map_err(|e| anyhow::anyhow!("HelixDB config error: {e}"))?;
    let client = educlaw_helix::HelixClient::new(config);
    tracing::info!("testing HelixDB connection...");
    client.test_connection().await
        .map_err(|e| anyhow::anyhow!("HelixDB connection failed: {e}"))?;
    educlaw_helix::init_schema(&client).await?;
    Arc::new(crate::db::HelixBackend::new(client))
};
```

Remove `pool` from `AppState::new()` call.

---

## Phase 5: Update `AppState`

**File**: `educlaw-server/src/api/mod.rs` (NOT `api/common.rs` — that file contains utility functions `copy_dir_all`, `setup_goose_config`)

Remove `pool` field and update imports:

```rust
// DELETE line 15:
// use sqlx::SqlitePool;

// REPLACE line 19:
// Was: use crate::db::{DbBackend, SqliteBackend};
use crate::db::DbBackend;
```

```rust
pub struct AppState {
    pub backend: Arc<dyn DbBackend>,   // Keep as-is
    pub auth: AuthConfig,
    pub workspace_root: String,
    pub goose_bin: String,
    pub broker: Arc<SessionBroker>,
    pub registry: Arc<SessionRegistry>,
    pub subjects_root: String,
    pub students_root: String,
    // DELETE: pub pool: SqlitePool,
}
```

Update `new()` constructor to remove `pool` parameter and field assignment.

---

## Phase 6: Fix Remaining `sqlx` References in Non-DB Files

| File | Line | Usage | Fix |
|------|------|-------|-----|
| `api/admin.rs` | 1274 | `#[derive(Serialize, sqlx::FromRow)]` on local `TokenDeductionRecord` | Remove `sqlx::FromRow` |
| `error.rs` | 14 | `Db(#[from] sqlx::Error)` variant | Replace with `Helix(#[from] educlaw_helix::HelixError)` |
| `acp_bridge/client.rs` | 120-126 | Commented-out `spawn_token_accounting(pool.clone(), ...)` | Remove the comment block |

**No `state.pool` references remain** — grep returns zero matches in `api/`.

---

## Phase 7: Remove Unused Imports

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
use crate::db::{DbBackend, SqliteBackend, HelixBackend};
```

Affected files:
- `main.rs` — remove SQLite imports + pool creation + `mod db;`
- `api/mod.rs` — remove `SqlitePool` import + `pool` param/field
- `error.rs` — replace `sqlx::Error` with `educlaw_helix::HelixError`

---

## Phase 8: Update `mod.rs` Files

**`educlaw-server/src/main.rs`** — Remove `mod db;` declaration (line 8).

**`educlaw-server/src/acp_bridge/mod.rs`** — Remove `// pub mod stats;` comment (line 20).

**`educlaw-server/src/db/mod.rs`** — **KEEP** (it's the restructured file from Phase 3, not a raw SQLite module). The `db/` directory stays but now only contains `mod.rs` and `helix/` (which is also removed — see note).

**Note on `db/helix/` subdirectory**: The 9 files in `db/helix/` can either be kept (as the delegation layer) or inlined into `db/mod.rs` for the `HelixBackend` impl. If kept, they must be updated to call `HelixClient` methods directly instead of `HelixDb` methods.

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
│   ├── common.rs        # Utility functions (copy_dir_all, setup_goose_config)
│   ├── admin.rs         # Uses backend.*, no sqlx::FromRow
│   ├── students.rs      # Uses backend.*
│   ├── sessions.rs      # Uses backend.*
│   ├── auth_routes.rs   # Uses backend.*
│   ├── threads.rs       # Uses backend.*
│   ├── sse.rs           # Uses backend.*
│   └── files.rs         # Uses backend.*
├── acp_bridge/
│   ├── mod.rs           # No stats module comment
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

No `db/sqlite/`, `db/schema.rs`, or SQLite query modules. No `stats.rs`. No `sqlx` anywhere.

If `db/helix/` was inlined into `db/mod.rs`, the `db/` directory contains only `mod.rs` and possibly a `conv.rs`.

---

## Runtime Configuration (After Removal)

Only env vars needed:
```
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

`DATABASE_URL` and `DB_BACKEND` are no longer needed.

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
- [ ] **Zero** `db/sqlite/` directory exists
- [ ] **Zero** `db/schema.rs` exists
- [ ] **Zero** `acp_bridge/stats.rs` exists
- [ ] `educraw.db` file is no longer created or used
