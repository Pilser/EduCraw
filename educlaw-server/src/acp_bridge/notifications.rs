// acp_bridge/notifications.rs
//
// Convert `SessionNotification` events into WebSocket frames (JSON + xterm binary),
// and persist token usage to the database with student-level limit enforcement.

use sacp::schema::{Content, ContentBlock, SessionNotification, SessionUpdate, ToolCallContent, ToolCallStatus};
use sqlx::SqlitePool;

use crate::db::{students as db_students, token_usage as db_tokens};

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
                tracing::info!("👤 [REPLAY] User: {}", text.chars().take(60).collect::<String>());
                let json = serde_json::json!({"type": "user_text", "text": text});
                let binary = text.into_bytes();
                (Some(json), Some(binary))
            } else {
                tracing::debug!("⚠️ UserMessageChunk with non-text content");
                (None, None)
            }
        }

        SessionUpdate::AgentMessageChunk(chunk) => {
            if let ContentBlock::Text(t) = &chunk.content {
                let text = t.text.clone();
                tracing::info!("🤖 [REPLAY] Agent: {}", text.chars().take(60).collect::<String>());
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
            let json =
                serde_json::json!({"type": "tool_start", "name": name, "input": input});
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
                        // Try tuple struct pattern - Content is likely Content(ContentBlock)
                        if let ContentBlock::Text(tc) = &content.0 {
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
            // Send token usage to frontend
            tracing::debug!("📊 [USAGE] Tokens used: {}", usage.used);
            let json = serde_json::json!({
                "type": "token_usage",
                "input_tokens": usage.used,
                "output_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0
            });
            (Some(json), None)
        }

        _ => (None, None),
    }
}

// ---------------------------------------------------------------------------
// Token accounting
// ---------------------------------------------------------------------------

/// Fire-and-forget: records a token-usage turn and blocks the student if the
/// cumulative total meets or exceeds their configured token limit.
pub fn spawn_token_accounting(
    pool: SqlitePool,
    session_id: String,
    student_id: String,
    model_name: String,
    used: i64,
) {
    tokio::spawn(async move {
        let tokens = db_tokens::TurnTokens {
            model: model_name,
            input_tokens: used,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        };

        if let Err(e) = db_tokens::record_turn(&pool, &session_id, &tokens).await {
            tracing::warn!(session_id = %session_id, error = %e, "failed to record token usage");
            return;
        }

        let student = match db_students::get_student(&pool, &student_id).await {
            Ok(Some(s)) => s,
            _ => return,
        };

        let limit = match student.token_limit {
            Some(l) if l > 0 => l,
            _ => return,
        };

        if student.token_blocked_at.is_some() {
            return;
        }

        let used_total = match db_tokens::student_total_tokens(&pool, &student_id).await {
            Ok(n) => n,
            Err(e) => {
                tracing::warn!(student_id = %student_id, error = %e, "failed to sum tokens");
                return;
            }
        };

        if used_total >= limit {
            if let Err(e) = db_students::mark_token_blocked(&pool, &student_id).await {
                tracing::warn!(
                    student_id = %student_id,
                    error = %e,
                    "failed to mark student as token-blocked"
                );
            }
            tracing::info!(
                student_id = %student_id,
                used = used_total,
                limit,
                "token limit reached — student blocked"
            );
        }
    });
}
