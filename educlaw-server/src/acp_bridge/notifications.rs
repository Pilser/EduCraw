// acp_bridge/notifications.rs
//
// Convert `SessionNotification` events into WebSocket frames (JSON + xterm binary),
// and persist token usage to the database with student-level limit enforcement.

use sacp::schema::{ContentBlock, SessionNotification, SessionUpdate, ToolCallStatus};
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
            let json =
                serde_json::json!({"type": "tool_start", "name": name, "input": input});
            let binary = format!("\r\n[Tool: {name}]\r\n").into_bytes();
            (Some(json), Some(binary))
        }

        SessionUpdate::ToolCallUpdate(tcu) => {
            if let Some(status) = tcu.fields.status {
                match status {
                    ToolCallStatus::Completed => (
                        Some(serde_json::json!({"type": "tool_end", "status": "completed"})),
                        None,
                    ),
                    ToolCallStatus::Failed => (
                        Some(serde_json::json!({"type": "tool_end", "status": "failed"})),
                        None,
                    ),
                    _ => (None, None),
                }
            } else {
                (None, None)
            }
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
