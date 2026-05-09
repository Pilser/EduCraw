// acp_bridge/notifications.rs
//
// Convert `SessionNotification` events into WebSocket frames (JSON + xterm binary),
// persist statistics to the database, and enforce student token limits.

use sacp::schema::{
    ContentBlock, PlanEntryStatus, SessionNotification, SessionUpdate, ToolCallContent,
    ToolCallStatus,
};
use serde_json::json;
use sqlx::SqlitePool;

use crate::db::{
    models as db_models, sessions as db_sessions, students as db_students, token_usage as db_tokens,
};

// ---------------------------------------------------------------------------
// Notification → frame conversion
// ---------------------------------------------------------------------------

/// Converts a `SessionNotification` into an optional pair of:
///   - `json_frame`   — `Some(Value)` sent as a WebSocket Text frame to the chat panel.
///   - `xterm_bytes`  — `Some(Vec<u8>)` sent as a WebSocket Binary frame to xterm.js.
pub fn notification_to_frames(
    notif: &SessionNotification,
) -> (Option<serde_json::Value>, Option<Vec<u8>>) {
    match &notif.update {
        SessionUpdate::UserMessageChunk(chunk) => {
            if let ContentBlock::Text(t) = &chunk.content {
                let text = t.text.clone();
                let json = serde_json::json!({"type": "user_text", "text": text});
                let binary = text.into_bytes();
                (Some(json), Some(binary))
            } else {
                (None, None)
            }
        }

        SessionUpdate::AgentMessageChunk(chunk) => {
            if let ContentBlock::Text(t) = &chunk.content {
                let text = t.text.clone();
                let json = serde_json::json!({"type": "assistant_text", "text": text});
                let binary = text.into_bytes();
                (Some(json), Some(binary))
            } else {
                (None, None)
            }
        }

        SessionUpdate::AgentThoughtChunk(_) => {
            (Some(serde_json::json!({"type": "thinking"})), None)
        }

        SessionUpdate::ToolCall(tc) => {
            let name = &tc.title;
            let input = tc
                .raw_input
                .as_ref()
                .map(|v| v.to_string())
                .unwrap_or_default();
            let json = serde_json::json!({"type": "tool_start", "name": name, "input": input});
            let binary = format!("\r\n[Tool: {name}]\r\n").into_bytes();
            (Some(json), Some(binary))
        }

        SessionUpdate::ToolCallUpdate(tcu) => {
            let status_str = tcu
                .fields
                .status
                .as_ref()
                .map(|s| match s {
                    ToolCallStatus::Completed => "completed",
                    ToolCallStatus::Failed => "failed",
                    _ => "unknown",
                })
                .unwrap_or("unknown");

            // Extract content (stdout/stderr) if present
            let mut stdout = String::new();
            let mut stderr = String::new();
            if let Some(content_blocks) = &tcu.fields.content {
                for tool_content in content_blocks {
                    if let ToolCallContent::Content(content) = tool_content {
                        if let ContentBlock::Text(tc) = &content.content {
                            stdout.push_str(&tc.text);
                        }
                    }
                }
            }

            let exit_code = if status_str == "completed" { 0 } else { 1 };

            let json = serde_json::json!({
                "type": "tool_end",
                "status": status_str,
                "exit_code": exit_code,
                "stdout": stdout,
                "stderr": stderr
            });
            (Some(json), None)
        }

        SessionUpdate::UsageUpdate(usage) => {
            // Extract cache token info from meta field
            let cache_read = usage
                .meta
                .as_ref()
                .and_then(|m| m.get("cache_read_tokens"))
                .and_then(|v| v.as_i64());
            let cache_write = usage
                .meta
                .as_ref()
                .and_then(|m| m.get("cache_write_tokens"))
                .and_then(|v| v.as_i64());

            tracing::info!(
                used = usage.used,
                size = usage.size,
                cost = ?usage.cost,
                cache_read_tokens = ?cache_read,
                cache_write_tokens = ?cache_write,
                "📊 [GOOSE TOKEN USAGE] Full token usage with cache info received from goose"
            );
            let json = json!({
                "type": "token_usage",
                "used": usage.used,
                "size": usage.size,
                "cache_read_tokens": cache_read,
                "cache_write_tokens": cache_write,
                "cost": usage.cost.as_ref().map(|c| {
                    json!({
                        "amount": c.amount,
                        "currency": &c.currency
                    })
                })
            });
            (Some(json), None)
        }

        SessionUpdate::Plan(plan) => {
            let completed = plan
                .entries
                .iter()
                .filter(|e| e.status == PlanEntryStatus::Completed)
                .count();
            let in_progress = plan
                .entries
                .iter()
                .filter(|e| e.status == PlanEntryStatus::InProgress)
                .count();
            let total = plan.entries.len();

            tracing::debug!(
                total_tasks = total,
                completed = completed,
                in_progress = in_progress,
                pending = total - completed - in_progress,
                "📊 [STATS] Plan update received from goose"
            );

            let entries = plan
                .entries
                .iter()
                .map(|e| {
                    json!({
                        "content": &e.content,
                        "priority": format!("{:?}", e.priority),
                        "status": format!("{:?}", e.status)
                    })
                })
                .collect::<Vec<_>>();

            let percent = if total > 0 {
                (completed as f32 / total as f32 * 100.0) as u32
            } else {
                0
            };

            let json = json!({
                "type": "plan_update",
                "entries": entries,
                "stats": {
                    "total": total,
                    "completed": completed,
                    "in_progress": in_progress,
                    "pending": total - completed - in_progress,
                    "progress_percent": percent
                }
            });
            (Some(json), None)
        }

        SessionUpdate::CurrentModeUpdate(mode) => {
            tracing::debug!(
                mode_id = %mode.current_mode_id.0,
                "📊 [STATS] Mode change received from goose"
            );
            let json = json!({
                "type": "mode_update",
                "current_mode_id": mode.current_mode_id.0.as_ref()
            });
            (Some(json), None)
        }

        SessionUpdate::SessionInfoUpdate(info) => {
            let title = match &info.title {
                sacp::schema::MaybeUndefined::Value(v) => Some(v.clone()),
                _ => None,
            };
            let updated_at = match &info.updated_at {
                sacp::schema::MaybeUndefined::Value(v) => Some(v.clone()),
                _ => None,
            };

            tracing::debug!(
                title = ?title,
                updated_at = ?updated_at,
                "📊 [STATS] Session info update received from goose"
            );

            let json = json!({
                "type": "session_info_update",
                "title": title,
                "updated_at": updated_at
            });
            (Some(json), None)
        }

        SessionUpdate::ConfigOptionUpdate(config) => {
            tracing::debug!(
                config_count = config.config_options.len(),
                configs = ?config.config_options.iter().map(|c| &c.name).collect::<Vec<_>>(),
                "📊 [STATS] Config options update received from goose"
            );

            let options = config
                .config_options
                .iter()
                .map(|opt| {
                    json!({
                        "id": opt.id.0.as_ref(),
                        "name": &opt.name,
                        "description": &opt.description,
                        "category": &opt.category
                    })
                })
                .collect::<Vec<_>>();

            let json = json!({
                "type": "config_update",
                "config_options": options
            });
            (Some(json), None)
        }

        SessionUpdate::AvailableCommandsUpdate(cmds) => {
            tracing::debug!(
                command_count = cmds.available_commands.len(),
                commands = ?cmds.available_commands.iter().map(|c| &c.name).collect::<Vec<_>>(),
                "📊 [STATS] Available commands update received from goose"
            );

            let commands = cmds
                .available_commands
                .iter()
                .map(|cmd| {
                    json!({
                        "name": &cmd.name,
                        "description": &cmd.description
                    })
                })
                .collect::<Vec<_>>();

            let json = json!({
                "type": "available_commands",
                "commands": commands,
                "count": commands.len()
            });
            (Some(json), None)
        }

        _ => (None, None),
    }
}

// ---------------------------------------------------------------------------
// Token accounting
// ---------------------------------------------------------------------------

/// Fire-and-forget: records a token-usage turn, calculates delta-based
/// deduction with model multiplier, and deducts from student's token_balance.
pub fn spawn_token_accounting(
    pool: SqlitePool,
    session_id: String,
    student_id: String,
    model_name: String,
    used: i64,
) {
    tokio::spawn(async move {
        let tokens = db_tokens::TurnTokens {
            model: model_name.clone(),
            input_tokens: used,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        };

        // Record the raw token usage
        if let Err(e) = db_tokens::record_turn(&pool, &session_id, &tokens).await {
            tracing::warn!(session_id = %session_id, error = %e, "failed to record token usage");
            return;
        }

        // Get session to check current checkpoint
        let session = match db_sessions::get_session(&pool, &session_id).await {
            Ok(Some(s)) => s,
            Err(e) => {
                tracing::warn!(session_id = %session_id, error = %e, "failed to fetch session");
                return;
            }
            Ok(None) => {
                tracing::warn!(session_id = %session_id, "session not found");
                return;
            }
        };

        // Calculate delta: tokens_used (cumulative in Goose) - last_checkpoint
        let last_checkpoint = session.last_token_checkpoint;
        let delta = used - last_checkpoint;

        // Always update checkpoint to current cumulative count
        if let Err(e) = db_sessions::update_last_token_checkpoint(&pool, &session_id, used).await {
            tracing::warn!(
                session_id = %session_id,
                error = %e,
                "failed to update token checkpoint"
            );
        }

        // Only deduct if delta > 0
        if delta <= 0 {
            tracing::debug!(
                session_id = %session_id,
                delta,
                "non-positive delta, skipping deduction"
            );
        } else {
            // Get model multiplier
            let multiplier = match db_models::get_model_multiplier(&pool, &model_name).await {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!(
                        model = %model_name,
                        error = %e,
                        "failed to get model multiplier, defaulting to 1.0"
                    );
                    1.0
                }
            };

            // Calculate tokens to deduct (delta * multiplier, rounded up)
            let tokens_deducted = (delta as f64 * multiplier).ceil() as i64;

            // Get current balance before deduction
            let balance_before = match db_students::get_token_balance(&pool, &student_id).await {
                Ok(b) => b,
                Err(e) => {
                    tracing::warn!(student_id = %student_id, error = %e, "failed to fetch token balance");
                    return;
                }
            };

            // Deduct tokens (can go negative)
            let balance_after =
                match db_students::deduct_tokens(&pool, &student_id, tokens_deducted).await {
                    Ok(new_balance) => new_balance,
                    Err(e) => {
                        tracing::warn!(
                            student_id = %student_id,
                            error = %e,
                            "failed to deduct tokens"
                        );
                        return;
                    }
                };

            // Record deduction in audit log
            if let Err(e) = db_tokens::record_deduction(
                &pool,
                &student_id,
                &session_id,
                &model_name,
                multiplier,
                delta,
                tokens_deducted,
                balance_before,
                balance_after,
            )
            .await
            {
                tracing::warn!(
                    student_id = %student_id,
                    session_id = %session_id,
                    error = %e,
                    "failed to record token deduction"
                );
            }

            // Log the deduction (allow negative balance, just warn if it is)
            tracing::info!(
                student_id = %student_id,
                model = %model_name,
                multiplier,
                delta,
                tokens_deducted,
                balance_before,
                balance_after,
                "token deduction recorded"
            );

            if balance_after < 0 {
                tracing::warn!(
                    student_id = %student_id,
                    balance_after,
                    "student token balance is now negative"
                );
            }

            // Token deduction complete — frontend will poll /api/me/token-balance to get updated balance
            tracing::info!(
                student_id = %student_id,
                session_id = %session_id,
                balance_after,
                "token balance available for polling"
            );
        } // Close else block
    });
}
