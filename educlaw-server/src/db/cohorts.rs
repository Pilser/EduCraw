// educlaw-server/src/db/cohorts.rs
//
// Cohort record.
//   id, title, created_at
//   (subjects are now scoped to cohorts via subjects.cohort_id)

use sqlx::SqlitePool;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct Cohort {
    pub id: String,
    pub title: String,
    pub created_at: String,
}

// ── Writes ─────────────────────────────────────────────────────────────────

pub async fn insert_cohort(pool: &SqlitePool, c: &Cohort) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO cohorts (id, title) VALUES (?, ?)")
        .bind(&c.id)
        .bind(&c.title)
        .execute(pool)
        .await?;
    Ok(())
}

/// Rename a cohort: updates the PK (slug id), title, and all FK references.
/// Returns an error if `new_id` is already taken.
pub async fn rename_cohort(
    pool: &SqlitePool,
    old_id: &str,
    new_id: &str,
    new_title: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE cohorts SET id = ?, title = ? WHERE id = ?")
        .bind(new_id)
        .bind(new_title)
        .bind(old_id)
        .execute(pool)
        .await?;
    // Update FK references in subjects and students.
    sqlx::query("UPDATE subjects SET cohort_id = ? WHERE cohort_id = ?")
        .bind(new_id).bind(old_id).execute(pool).await?;
    sqlx::query("UPDATE students SET cohort_id = ? WHERE cohort_id = ?")
        .bind(new_id).bind(old_id).execute(pool).await?;
    Ok(())
}

/// Update cohort title only (no slug change).
pub async fn update_cohort_title(
    pool: &SqlitePool,
    id: &str,
    new_title: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE cohorts SET title = ? WHERE id = ?")
        .bind(new_title)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Delete a cohort and all its subjects. Students are unlinked (cohort_id set to '').
pub async fn delete_cohort(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM subjects WHERE cohort_id = ?")
        .bind(id).execute(pool).await?;
    sqlx::query("UPDATE students SET cohort_id = '' WHERE cohort_id = ?")
        .bind(id).execute(pool).await?;
    sqlx::query("DELETE FROM cohorts WHERE id = ?")
        .bind(id).execute(pool).await?;
    Ok(())
}

// ── Reads ───────────────────────────────────────────────────────────────────

pub async fn get_cohort(pool: &SqlitePool, id: &str) -> Result<Option<Cohort>, sqlx::Error> {
    sqlx::query_as::<_, Cohort>("SELECT * FROM cohorts WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn list_cohorts(pool: &SqlitePool) -> Result<Vec<Cohort>, sqlx::Error> {
    sqlx::query_as::<_, Cohort>("SELECT * FROM cohorts ORDER BY created_at DESC")
        .fetch_all(pool)
        .await
}
