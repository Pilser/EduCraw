// educlaw-server/src/db/subjects.rs
//
// Subject record — scoped to a cohort.
//   id (UUID), cohort_id, slug, title, created_at

use sqlx::SqlitePool;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct Subject {
    pub id: String,
    pub cohort_id: String,
    pub slug: String,
    pub title: String,
    pub created_at: String,
}

// ── Writes ─────────────────────────────────────────────────────────────────

pub async fn insert_subject(pool: &SqlitePool, s: &Subject) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO subjects (id, cohort_id, slug, title) VALUES (?, ?, ?, ?)")
        .bind(&s.id)
        .bind(&s.cohort_id)
        .bind(&s.slug)
        .bind(&s.title)
        .execute(pool)
        .await?;
    Ok(())
}

/// Rename a subject's slug and/or title. cohort_id cannot be changed here.
pub async fn update_subject(
    pool: &SqlitePool,
    id: &str,
    new_slug: &str,
    new_title: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE subjects SET slug = ?, title = ? WHERE id = ?")
        .bind(new_slug)
        .bind(new_title)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_subject(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM subjects WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Reads ───────────────────────────────────────────────────────────────────

pub async fn get_subject(pool: &SqlitePool, id: &str) -> Result<Option<Subject>, sqlx::Error> {
    sqlx::query_as::<_, Subject>("SELECT * FROM subjects WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn get_subject_by_slug(
    pool: &SqlitePool,
    cohort_id: &str,
    slug: &str,
) -> Result<Option<Subject>, sqlx::Error> {
    sqlx::query_as::<_, Subject>(
        "SELECT * FROM subjects WHERE cohort_id = ? AND slug = ?",
    )
    .bind(cohort_id)
    .bind(slug)
    .fetch_optional(pool)
    .await
}

pub async fn list_subjects(
    pool: &SqlitePool,
    cohort_id: &str,
) -> Result<Vec<Subject>, sqlx::Error> {
    sqlx::query_as::<_, Subject>(
        "SELECT * FROM subjects WHERE cohort_id = ? ORDER BY created_at DESC",
    )
    .bind(cohort_id)
    .fetch_all(pool)
    .await
}
