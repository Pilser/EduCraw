// educlaw-server/src/db/students.rs
//
// Student record.
//   id, username, password_hash, display_name, role, cohort_id, uid_slot,
//   created_at, last_seen

use sqlx::SqlitePool;
use std::path::PathBuf;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct Student {
    pub id: String,
    pub username: String,
    /// Argon2id PHC string — never serialised into API responses.
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub display_name: String,
    /// "student" | "teacher" | "admin"
    pub role: String,
    /// ID of the cohort this student belongs to (e.g. "primary-2b").
    pub cohort_id: String,
    /// Filesystem directory name for this student under students_root.
    /// Defaults to username for existing students; new registrations use username_uuidPrefix.
    pub home_dir: Option<String>,
    /// Host uid mapping while a session is active; NULL when idle.
    pub uid_slot: Option<i64>,
    /// Total token budget. NULL = unlimited (deprecated, use token_balance instead).
    pub token_limit: Option<i64>,
    /// Current token balance (can be negative until topped up).
    pub token_balance: i64,
    /// Restriction status: NULL = not restricted, else timestamp when banned.
    pub restriction_status: Option<String>,
    /// Message shown to the student when they are restricted.
    pub restriction_message: Option<String>,
    /// Last model used by the student (persisted across sessions).
    pub last_model: Option<String>,
    pub created_at: String,
    pub last_seen: Option<String>,
}

// ── Writes ────────────────────────────────────────────────────────────────

pub async fn insert_student(pool: &SqlitePool, s: &Student) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO students
             (id, username, password_hash, display_name, role, cohort_id, home_dir)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&s.id)
    .bind(&s.username)
    .bind(&s.password_hash)
    .bind(&s.display_name)
    .bind(&s.role)
    .bind(&s.cohort_id)
    .bind(&s.home_dir)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn touch_last_seen(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE students SET last_seen = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_student(
    pool: &SqlitePool,
    id: &str,
    display_name: Option<&str>,
    cohort_id: Option<&str>,
    password_hash: Option<&str>,
) -> Result<(), sqlx::Error> {
    if let Some(n) = display_name {
        sqlx::query("UPDATE students SET display_name = ? WHERE id = ?")
            .bind(n).bind(id).execute(pool).await?;
    }
    if let Some(c) = cohort_id {
        sqlx::query("UPDATE students SET cohort_id = ? WHERE id = ?")
            .bind(c).bind(id).execute(pool).await?;
    }
    if let Some(h) = password_hash {
        sqlx::query("UPDATE students SET password_hash = ? WHERE id = ?")
            .bind(h).bind(id).execute(pool).await?;
    }
    Ok(())
}

pub async fn delete_student(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    // Delete in reverse FK dependency order to avoid constraint violations.

    // 1. Delete token_usage for all sessions of this student
    sqlx::query(
        "DELETE FROM token_usage WHERE session_id IN (SELECT id FROM sessions WHERE student_id = ?)",
    )
        .bind(id)
        .execute(pool)
        .await?;

    // 2. Delete all sessions for this student
    sqlx::query("DELETE FROM sessions WHERE student_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    // 3. Delete student model restrictions
    sqlx::query("DELETE FROM student_models WHERE student_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    // 4. Delete token_codes used by this student (if table exists)
    let _ = sqlx::query("DELETE FROM token_codes WHERE used_by = ?")
        .bind(id)
        .execute(pool)
        .await;

    // 5. Finally delete the student
    sqlx::query("DELETE FROM students WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn set_uid_slot(
    pool: &SqlitePool,
    id: &str,
    slot: Option<i64>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE students SET uid_slot = ? WHERE id = ?")
        .bind(slot)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Reads ─────────────────────────────────────────────────────────────────

pub async fn get_student(pool: &SqlitePool, id: &str) -> Result<Option<Student>, sqlx::Error> {
    sqlx::query_as::<_, Student>("SELECT * FROM students WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn get_student_by_username(
    pool: &SqlitePool,
    username: &str,
) -> Result<Option<Student>, sqlx::Error> {
    sqlx::query_as::<_, Student>("SELECT * FROM students WHERE username = ?")
        .bind(username)
        .fetch_optional(pool)
        .await
}

pub async fn list_students(pool: &SqlitePool) -> Result<Vec<Student>, sqlx::Error> {
    sqlx::query_as::<_, Student>("SELECT * FROM students ORDER BY created_at DESC")
        .fetch_all(pool)
        .await
}

/// Ban a student: set restriction_status to now() and optionally store a message.
pub async fn ban_student(
    pool: &SqlitePool,
    id: &str,
    message: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE students SET restriction_status = datetime('now'), restriction_message = ? WHERE id = ?",
    )
    .bind(message)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Unban a student: clear restriction_status and restriction_message.
pub async fn unban_student(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE students SET restriction_status = NULL, restriction_message = NULL WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Update the student's last used model (persisted across sessions).
pub async fn set_last_model(pool: &SqlitePool, id: &str, model: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE students SET last_model = ? WHERE id = ?")
        .bind(model)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Get current token balance for a student.
pub async fn get_token_balance(pool: &SqlitePool, id: &str) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as("SELECT token_balance FROM students WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}

/// Deduct tokens from student balance (can go negative).
/// Returns the new balance.
pub async fn deduct_tokens(
    pool: &SqlitePool,
    id: &str,
    amount: i64,
) -> Result<i64, sqlx::Error> {
    sqlx::query(
        "UPDATE students SET token_balance = token_balance - ? WHERE id = ?",
    )
    .bind(amount)
    .bind(id)
    .execute(pool)
    .await?;
    
    get_token_balance(pool, id).await
}

/// Add tokens to student balance (topup; offsets negative balance first).
/// Returns the new balance.
pub async fn topup_tokens(
    pool: &SqlitePool,
    id: &str,
    amount: i64,
) -> Result<i64, sqlx::Error> {
    sqlx::query(
        "UPDATE students SET token_balance = token_balance + ? WHERE id = ?",
    )
    .bind(amount)
    .bind(id)
    .execute(pool)
    .await?;
    
    get_token_balance(pool, id).await
}

/// Resolve the disk path for a student's persistent home directory.
/// Uses `home_dir` if set, otherwise falls back to `username`.
pub fn student_home_path(students_root: &str, s: &Student) -> PathBuf {
    let component = s.home_dir.as_deref().unwrap_or(&s.username);
    PathBuf::from(students_root).join(component)
}

