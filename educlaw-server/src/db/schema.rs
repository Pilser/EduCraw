// educlaw-server/src/db/schema.rs
//
// Inline DDL migrations — run once at server startup.
// Column names and types follow the plan exactly.

use sqlx::SqlitePool;

pub async fn init_db(pool: &SqlitePool) -> anyhow::Result<()> {
    // ── available models (admin-managed list) ────────────────────────────────
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS models (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            enabled      INTEGER NOT NULL DEFAULT 1,
            multiplier   REAL NOT NULL DEFAULT 1.0,
            created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    // ── cohorts ───────────────────────────────────────────────────────────────
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS cohorts (
            id         TEXT PRIMARY KEY,
            title      TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    // ── subjects ──────────────────────────────────────────────────────────────
    // Scoped per cohort: (cohort_id, slug) is the natural unique key.
    // Disk layout: {EDUCLAW_SUBJECTS_ROOT}/{cohort_id}/{slug}/
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS subjects (
            id         TEXT PRIMARY KEY,
            cohort_id  TEXT NOT NULL,
            slug       TEXT NOT NULL,
            title      TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_cohort_slug ON subjects(cohort_id, slug)",
    )
    .execute(pool)
    .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_subjects_cohort ON subjects(cohort_id)")
        .execute(pool)
        .await?;

    // ── assignments ───────────────────────────────────────────────────────────
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS assignments (
            id          TEXT PRIMARY KEY,
            subject_id  TEXT NOT NULL REFERENCES subjects(id),
            title       TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            due_date    TEXT,
            created_by  TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    // ── students ──────────────────────────────────────────────────────────────
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS students (
            id               TEXT PRIMARY KEY,
            username         TEXT NOT NULL UNIQUE,
            password_hash    TEXT NOT NULL,
            display_name     TEXT NOT NULL,
            role             TEXT NOT NULL DEFAULT 'student',
            cohort_id        TEXT NOT NULL DEFAULT '',
            home_dir         TEXT,
            uid_slot         INTEGER,
            token_limit          INTEGER,
            token_balance        INTEGER NOT NULL DEFAULT 0,
            restriction_message  TEXT,
            restriction_status   TEXT,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            last_seen        TEXT
        )",
    )
    .execute(pool)
    .await?;

    // Idempotent column additions for existing databases.
    for col in &[
        "ALTER TABLE students ADD COLUMN token_limit INTEGER",
        "ALTER TABLE students ADD COLUMN token_balance INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE students ADD COLUMN token_block_banner TEXT",
        "ALTER TABLE students ADD COLUMN token_blocked_at TEXT",
        "ALTER TABLE students ADD COLUMN restriction_status TEXT",
        "ALTER TABLE students ADD COLUMN restriction_message TEXT",
        "ALTER TABLE students ADD COLUMN last_model TEXT",
        "ALTER TABLE students ADD COLUMN home_dir TEXT",
        "ALTER TABLE models ADD COLUMN multiplier REAL NOT NULL DEFAULT 1.0",
        "ALTER TABLE models ADD COLUMN provider TEXT",
        "ALTER TABLE models ADD COLUMN think_mode INTEGER",
        "ALTER TABLE models ADD COLUMN visual_support INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE models ADD COLUMN thinking_params TEXT",
        "ALTER TABLE sessions ADD COLUMN last_token_checkpoint INTEGER NOT NULL DEFAULT 0",
    ] {
        let _ = sqlx::query(col).execute(pool).await;
    }

    // Migrate existing students: set home_dir = username for those without one
    let _ = sqlx::query(
        "UPDATE students SET home_dir = username WHERE home_dir IS NULL",
    )
    .execute(pool)
    .await;

    // Migrate token_blocked_at/banner → restriction_status/message
    let _ = sqlx::query(
        "UPDATE students SET restriction_status = token_blocked_at WHERE restriction_status IS NULL AND token_blocked_at IS NOT NULL",
    )
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "UPDATE students SET restriction_message = token_block_banner WHERE restriction_message IS NULL AND token_block_banner IS NOT NULL",
    )
    .execute(pool)
    .await;

    // ── sessions ──────────────────────────────────────────────────────────────
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS sessions (
            id                      TEXT PRIMARY KEY,
            student_id              TEXT NOT NULL REFERENCES students(id),
            state                   TEXT NOT NULL DEFAULT 'active',
            namespace_pid           INTEGER,
            overlay_mount           TEXT NOT NULL,
            model                   TEXT,
            last_input_at           TEXT,
            last_token_checkpoint   INTEGER NOT NULL DEFAULT 0,
            started_at              TEXT NOT NULL DEFAULT (datetime('now')),
            ended_at                TEXT
        )",
    )
    .execute(pool)
    .await?;

    // Add model column to sessions if upgrading from an older schema that
    // doesn't have it yet (idempotent; errors on "duplicate column" are swallowed).
    let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN model TEXT")
        .execute(pool)
        .await;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions(student_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_assignments_subject ON assignments(subject_id)")
        .execute(pool)
        .await?;

    // ── token_usage ───────────────────────────────────────────────────────────
    // One row per API turn; each row stores the deltas reported by claw for
    // that single turn so we can sum over a session or across all sessions.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS token_usage (
            id                        TEXT PRIMARY KEY,
            session_id                TEXT NOT NULL REFERENCES sessions(id),
            model                     TEXT NOT NULL DEFAULT '',
            input_tokens              INTEGER NOT NULL DEFAULT 0,
            output_tokens             INTEGER NOT NULL DEFAULT 0,
            cache_creation_tokens     INTEGER NOT NULL DEFAULT 0,
            cache_read_tokens         INTEGER NOT NULL DEFAULT 0,
            recorded_at               TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id)")
        .execute(pool)
        .await?;

    // ── token_deductions ──────────────────────────────────────────────────────
    // Audit trail for token deductions with model multiplier applied
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS token_deductions (
            id                TEXT PRIMARY KEY,
            student_id        TEXT NOT NULL REFERENCES students(id),
            session_id        TEXT NOT NULL REFERENCES sessions(id),
            model_name        TEXT NOT NULL,
            multiplier        REAL NOT NULL,
            tokens_used       INTEGER NOT NULL,
            tokens_deducted   INTEGER NOT NULL,
            balance_before    INTEGER NOT NULL,
            balance_after     INTEGER NOT NULL,
            recorded_at       TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_token_deductions_student ON token_deductions(student_id)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_token_deductions_session ON token_deductions(session_id)",
    )
    .execute(pool)
    .await?;

    // ── student_models ────────────────────────────────────────────────────────
    // Allows admin to assign a specific list of model names to a student.
    // If no rows exist for a student they fall back to all enabled models.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS student_models (
            student_id  TEXT NOT NULL,
            model_name  TEXT NOT NULL,
            PRIMARY KEY (student_id, model_name)
        )",
    )
    .execute(pool)
    .await?;

    // ── seed default model ────────────────────────────────────────────────────
    // Ensure grok-4-1-fast-reasoning is always present and is the first/default.
    sqlx::query(
        "INSERT OR IGNORE INTO models (id, name, display_name, enabled)
         VALUES ('grok-4-1-fast-reasoning', 'grok-4-1-fast-reasoning', 'Grok 4.1 Fast Reasoning', 1)",
    )
    .execute(pool)
    .await?;

    tracing::info!("database schema initialised");
    Ok(())
}
