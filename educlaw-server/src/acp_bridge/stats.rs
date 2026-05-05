// acp_bridge/stats.rs
//
// Backend storage for ACP statistics received via SessionNotification.
// Records: plan progress, mode changes, config updates, session metadata.

use serde_json::{json, Value};
use sqlx::SqlitePool;

/// Store execution plan statistics for a session.
pub async fn record_plan_stats(
    pool: &SqlitePool,
    session_id: &str,
    total: usize,
    completed: usize,
    in_progress: usize,
    entries_json: &str, // Serialized JSON of plan entries
) -> Result<(), sqlx::Error> {
    let pending = total.saturating_sub(completed + in_progress);
    let progress_percent = if total > 0 {
        ((completed as f32 / total as f32) * 100.0) as i32
    } else {
        0
    };

    tracing::info!(
        session_id = %session_id,
        total = total,
        completed = completed,
        in_progress = in_progress,
        pending = pending,
        progress_percent = progress_percent,
        "💾 [DB] Persisting plan stats to database"
    );

    // Insert or ignore (plan updates frequently, we just track latest)
    sqlx::query(
        "INSERT INTO session_plan_stats 
             (session_id, total_tasks, completed_tasks, in_progress_tasks, pending_tasks, progress_percent, entries_json, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(session_id) DO UPDATE SET
             total_tasks = excluded.total_tasks,
             completed_tasks = excluded.completed_tasks,
             in_progress_tasks = excluded.in_progress_tasks,
             pending_tasks = excluded.pending_tasks,
             progress_percent = excluded.progress_percent,
             entries_json = excluded.entries_json,
             recorded_at = datetime('now')",
    )
    .bind(session_id)
    .bind(total as i32)
    .bind(completed as i32)
    .bind(in_progress as i32)
    .bind(pending as i32)
    .bind(progress_percent)
    .bind(entries_json)
    .execute(pool)
    .await?;

    Ok(())
}

/// Store mode change event for a session.
pub async fn record_mode_change(
    pool: &SqlitePool,
    session_id: &str,
    mode_id: &str,
) -> Result<(), sqlx::Error> {
    tracing::info!(
        session_id = %session_id,
        mode_id = %mode_id,
        "💾 [DB] Recording mode change to database"
    );

    sqlx::query(
        "INSERT INTO session_mode_history 
             (session_id, mode_id, changed_at)
         VALUES (?, ?, datetime('now'))",
    )
    .bind(session_id)
    .bind(mode_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Store session metadata updates.
pub async fn record_session_info(
    pool: &SqlitePool,
    session_id: &str,
    title: Option<&str>,
    updated_at: Option<&str>,
) -> Result<(), sqlx::Error> {
    tracing::info!(
        session_id = %session_id,
        title = ?title,
        updated_at = ?updated_at,
        "💾 [DB] Recording session metadata to database"
    );

    sqlx::query(
        "INSERT INTO session_metadata 
             (session_id, title, last_info_update)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(session_id) DO UPDATE SET
             title = coalesce(excluded.title, title),
             last_info_update = datetime('now')",
    )
    .bind(session_id)
    .bind(title)
    .execute(pool)
    .await?;

    Ok(())
}

/// Store available commands snapshot for a session.
pub async fn record_available_commands(
    pool: &SqlitePool,
    session_id: &str,
    commands_json: &str, // Serialized JSON of available commands
) -> Result<(), sqlx::Error> {
    let command_count = serde_json::from_str::<serde_json::Value>(commands_json)
        .ok()
        .and_then(|v| v.as_array().map(|a| a.len()))
        .unwrap_or(0);

    tracing::info!(
        session_id = %session_id,
        command_count = command_count,
        "💾 [DB] Recording available commands to database"
    );

    sqlx::query(
        "INSERT INTO session_available_commands 
             (session_id, commands_json, recorded_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(session_id) DO UPDATE SET
             commands_json = excluded.commands_json,
             recorded_at = datetime('now')",
    )
    .bind(session_id)
    .bind(commands_json)
    .execute(pool)
    .await?;

    Ok(())
}

/// Store config option updates.
pub async fn record_config_options(
    pool: &SqlitePool,
    session_id: &str,
    config_json: &str, // Serialized JSON of config options
) -> Result<(), sqlx::Error> {
    let config_names = serde_json::from_str::<serde_json::Value>(config_json)
        .ok()
        .and_then(|v| v.as_array().map(|a| {
            a.iter().filter_map(|item| {
                item.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())
            }).collect::<Vec<_>>()
        }))
        .unwrap_or_default();

    tracing::info!(
        session_id = %session_id,
        config_count = config_names.len(),
        configs = ?config_names,
        "💾 [DB] Recording config options to database"
    );

    sqlx::query(
        "INSERT INTO session_config_snapshot 
             (session_id, config_options_json, recorded_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(session_id) DO UPDATE SET
             config_options_json = excluded.config_options_json,
             recorded_at = datetime('now')",
    )
    .bind(session_id)
    .bind(config_json)
    .execute(pool)
    .await?;

    Ok(())
}

/// Retrieve latest plan stats for a session.
pub async fn get_latest_plan_stats(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let row = sqlx::query!(
        "SELECT total_tasks, completed_tasks, in_progress_tasks, pending_tasks, progress_percent, entries_json 
         FROM session_plan_stats 
         WHERE session_id = ? 
         ORDER BY recorded_at DESC 
         LIMIT 1",
        session_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| {
        json!({
            "total": r.total_tasks,
            "completed": r.completed_tasks,
            "in_progress": r.in_progress_tasks,
            "pending": r.pending_tasks,
            "progress_percent": r.progress_percent,
            "entries": serde_json::from_str::<Value>(&r.entries_json).unwrap_or(json!([]))
        })
    }))
}

/// Retrieve latest mode for a session.
pub async fn get_current_mode(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query!(
        "SELECT mode_id FROM session_mode_history 
         WHERE session_id = ? 
         ORDER BY changed_at DESC 
         LIMIT 1",
        session_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| r.mode_id))
}

/// Retrieve latest config snapshot.
pub async fn get_latest_config(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let row = sqlx::query!(
        "SELECT config_options_json FROM session_config_snapshot 
         WHERE session_id = ? 
         ORDER BY recorded_at DESC 
         LIMIT 1",
        session_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| {
        serde_json::from_str::<Value>(&r.config_options_json).unwrap_or(json!([]))
    }))
}

/// Retrieve available commands for a session.
pub async fn get_available_commands(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let row = sqlx::query!(
        "SELECT commands_json FROM session_available_commands 
         WHERE session_id = ? 
         ORDER BY recorded_at DESC 
         LIMIT 1",
        session_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| {
        serde_json::from_str::<Value>(&r.commands_json).unwrap_or(json!([]))
    }))
}
