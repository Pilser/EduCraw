// educlaw-server/src/db/models.rs
//
// Admin-managed list of available AI models.

use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub enabled: i64,    // 1 = enabled, 0 = disabled
    pub multiplier: f64, // Token deduction multiplier (e.g., 1.0, 2.5, 3.33)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>, // Provider ID (e.g., "xai", "deepseek", "openai")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub think_mode: Option<i64>, // 1 = thinking model, 0 = non-thinking, NULL = unknown
    pub visual_support: i64, // 1 = supports vision, 0 = text-only
    /// JSON with provider-specific thinking parameters.
    /// Stored as TEXT in SQLite; use `parsed_thinking_params()` at call sites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_params: Option<String>,
    pub created_at: String,
}

impl Model {
    /// Parse `thinking_params` JSON into the `HashMap` Goose expects.
    pub fn parsed_thinking_params(
        &self,
    ) -> Option<std::collections::HashMap<String, serde_json::Value>> {
        self.thinking_params
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
    }
}

// ── Writes ────────────────────────────────────────────────────────────────

pub async fn insert_model(
    pool: &SqlitePool,
    name: &str,
    display_name: &str,
    multiplier: f64,
) -> Result<String, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO models (id, name, display_name, multiplier) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(display_name)
        .bind(multiplier)
        .execute(pool)
        .await?;
    Ok(id)
}

pub async fn set_enabled(pool: &SqlitePool, id: &str, enabled: bool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE models SET enabled = ? WHERE id = ?")
        .bind(i64::from(enabled))
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_multiplier(
    pool: &SqlitePool,
    name: &str,
    multiplier: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE models SET multiplier = ? WHERE name = ?")
        .bind(multiplier)
        .bind(name)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_model(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM models WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_model_specs(
    pool: &SqlitePool,
    id: &str,
    provider: Option<&str>,
    think_mode: Option<i64>,
    visual_support: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE models SET provider = ?, think_mode = ?, visual_support = ? WHERE id = ?")
        .bind(provider)
        .bind(think_mode)
        .bind(visual_support)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Reads ─────────────────────────────────────────────────────────────────

pub async fn list_models(pool: &SqlitePool) -> Result<Vec<Model>, sqlx::Error> {
    sqlx::query_as::<_, Model>("SELECT * FROM models ORDER BY display_name")
        .fetch_all(pool)
        .await
}

pub async fn list_enabled(pool: &SqlitePool) -> Result<Vec<Model>, sqlx::Error> {
    sqlx::query_as::<_, Model>(
        // grok-4-1-fast-reasoning is the default (system priority)
        "SELECT * FROM models WHERE enabled = 1
         ORDER BY CASE WHEN name = 'grok-4-1-fast-reasoning' THEN 0 ELSE 1 END, display_name",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_model_by_name(
    pool: &SqlitePool,
    name: &str,
) -> Result<Option<Model>, sqlx::Error> {
    sqlx::query_as::<_, Model>("SELECT * FROM models WHERE name = ?")
        .bind(name)
        .fetch_optional(pool)
        .await
}

pub async fn get_model_multiplier(pool: &SqlitePool, name: &str) -> Result<f64, sqlx::Error> {
    let row: (f64,) = sqlx::query_as("SELECT COALESCE(multiplier, 1.0) FROM models WHERE name = ?")
        .bind(name)
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}

// ── Per-student model assignments ─────────────────────────────────────────

/// Returns the model names this student is allowed to use.
/// Falls back to all enabled models (with default first) if no specific
/// assignment has been made.
pub async fn models_for_student(
    pool: &SqlitePool,
    student_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    // Check if any specific assignment exists.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM student_models WHERE student_id = ?")
        .bind(student_id)
        .fetch_one(pool)
        .await?;

    if count == 0 {
        // No assignment → return all enabled models, default first.
        let all = list_enabled(pool).await?;
        return Ok(all.into_iter().map(|m| m.name).collect());
    }

    // Return only the explicitly assigned models that are still enabled, default first.
    sqlx::query_scalar::<_, String>(
        "SELECT sm.model_name FROM student_models sm
         JOIN models m ON m.name = sm.model_name AND m.enabled = 1
         WHERE sm.student_id = ?
         ORDER BY CASE WHEN sm.model_name = 'grok-4-1-fast-reasoning' THEN 0 ELSE 1 END,
                  sm.model_name",
    )
    .bind(student_id)
    .fetch_all(pool)
    .await
}

/// Returns the full Model objects this student is allowed to use (with specs).
/// Falls back to all enabled models if no specific assignment.
pub async fn full_models_for_student(
    pool: &SqlitePool,
    student_id: &str,
) -> Result<Vec<Model>, sqlx::Error> {
    // Check if any specific assignment exists.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM student_models WHERE student_id = ?")
        .bind(student_id)
        .fetch_one(pool)
        .await?;

    if count == 0 {
        // No assignment → return all enabled models.
        return list_enabled(pool).await;
    }

    // Return only the explicitly assigned models that are still enabled.
    sqlx::query_as::<_, Model>(
        "SELECT m.* FROM student_models sm
         JOIN models m ON m.name = sm.model_name AND m.enabled = 1
         WHERE sm.student_id = ?
         ORDER BY CASE WHEN sm.model_name = 'grok-4-1-fast-reasoning' THEN 0 ELSE 1 END,
                  sm.model_name",
    )
    .bind(student_id)
    .fetch_all(pool)
    .await
}

/// Returns ONLY what is explicitly stored in student_models (no fallback),
/// filtered to models that are still enabled. Used by the admin panel to
/// show the actual assignment state (empty = "allow all enabled").
pub async fn raw_assignments_for_student(
    pool: &SqlitePool,
    student_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT sm.model_name FROM student_models sm
         JOIN models m ON m.name = sm.model_name AND m.enabled = 1
         WHERE sm.student_id = ?
         ORDER BY CASE WHEN sm.model_name = 'grok-4-1-fast-reasoning' THEN 0 ELSE 1 END,
                  sm.model_name",
    )
    .bind(student_id)
    .fetch_all(pool)
    .await
}

/// Replace the full set of model assignments for a student.
/// Pass an empty vec to revert to the global enabled list.
pub async fn set_student_models(
    pool: &SqlitePool,
    student_id: &str,
    model_names: &[String],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM student_models WHERE student_id = ?")
        .bind(student_id)
        .execute(pool)
        .await?;
    for name in model_names {
        sqlx::query("INSERT OR IGNORE INTO student_models (student_id, model_name) VALUES (?, ?)")
            .bind(student_id)
            .bind(name)
            .execute(pool)
            .await?;
    }
    Ok(())
}
