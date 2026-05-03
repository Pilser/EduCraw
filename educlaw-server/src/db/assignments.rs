// educlaw-server/src/db/assignments.rs
//
// Assignment record.
//   id, subject_id, title, description, due_date, created_by, created_at
//
// Assignments are created by teachers and read by the agent via MCP tools.

use sqlx::SqlitePool;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct Assignment {
    pub id: String,
    pub subject_id: String,
    pub title: String,
    pub description: String,
    pub due_date: Option<String>,
    /// student_id of the teacher who created this assignment.
    pub created_by: String,
    pub created_at: String,
}

// ── Writes ─────────────────────────────────────────────────────────────────

pub async fn insert_assignment(pool: &SqlitePool, a: &Assignment) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO assignments
             (id, subject_id, title, description, due_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&a.id)
    .bind(&a.subject_id)
    .bind(&a.title)
    .bind(&a.description)
    .bind(&a.due_date)
    .bind(&a.created_by)
    .execute(pool)
    .await?;
    Ok(())
}

// ── Reads ───────────────────────────────────────────────────────────────────

pub async fn get_assignment(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<Assignment>, sqlx::Error> {
    sqlx::query_as::<_, Assignment>("SELECT * FROM assignments WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// All assignments for a specific subject, ordered newest first.
pub async fn list_assignments_for_subject(
    pool: &SqlitePool,
    subject_id: &str,
) -> Result<Vec<Assignment>, sqlx::Error> {
    sqlx::query_as::<_, Assignment>(
        "SELECT * FROM assignments WHERE subject_id = ? ORDER BY created_at DESC",
    )
    .bind(subject_id)
    .fetch_all(pool)
    .await
}

/// Assignments visible to a student: subjects must be a comma-separated list
/// of UUIDs that the caller derives from cohort.subject_ids.
/// Uses a parameterised IN clause via a JSON each() trick that works with sqlx.
pub async fn list_assignments_for_student(
    pool: &SqlitePool,
    subject_ids_json: &str,
) -> Result<Vec<Assignment>, sqlx::Error> {
    // subject_ids_json: JSON array string, e.g. '["id1","id2"]'
    sqlx::query_as::<_, Assignment>(
        "SELECT a.*
           FROM assignments a
          WHERE a.subject_id IN (
                SELECT value FROM json_each(?)
          )
          ORDER BY a.created_at DESC",
    )
    .bind(subject_ids_json)
    .fetch_all(pool)
    .await
}
