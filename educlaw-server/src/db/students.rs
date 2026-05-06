// educlaw-server/src/db/students.rs
//
// Student record.
//   id, username, password_hash, display_name, role, cohort_id, uid_slot,
//   created_at, last_seen

use sqlx::SqlitePool;

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
    /// Host uid mapping while a session is active; NULL when idle.
    pub uid_slot: Option<i64>,
    /// Total token budget. NULL = unlimited.
    pub token_limit: Option<i64>,
    /// Current token balance (can be negative until topped up).
    pub token_balance: i64,
    /// Banner shown to the student when limit is reached. NULL = default message.
    pub token_block_banner: Option<String>,
    /// Timestamp when the student was first blocked; NULL = not blocked.
    pub token_blocked_at: Option<String>,
    pub created_at: String,
    pub last_seen: Option<String>,
}

// ── Writes ────────────────────────────────────────────────────────────────

pub async fn insert_student(pool: &SqlitePool, s: &Student) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO students
             (id, username, password_hash, display_name, role, cohort_id)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&s.id)
    .bind(&s.username)
    .bind(&s.password_hash)
    .bind(&s.display_name)
    .bind(&s.role)
    .bind(&s.cohort_id)
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

/// Set the token budget and optional custom block banner for a student.
/// Pass `None` to remove the limit (unlimited).
pub async fn set_token_limit(
    pool: &SqlitePool,
    id: &str,
    limit: Option<i64>,
    banner: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE students SET token_limit = ?, token_block_banner = ? WHERE id = ?",
    )
    .bind(limit)
    .bind(banner)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Stamp `token_blocked_at = now()` when a student first exceeds their limit.
/// Does nothing if they are already blocked.
pub async fn mark_token_blocked(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE students SET token_blocked_at = datetime('now')
         WHERE id = ? AND token_blocked_at IS NULL",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Clear the block so a student can chat again (admin resets it).
pub async fn clear_token_block(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE students SET token_blocked_at = NULL WHERE id = ?")
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

