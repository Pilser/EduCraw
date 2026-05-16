// educlaw-server/src/db/token_usage.rs
//
// Per-turn token usage persisted from the OSC `token_usage` envelope
// emitted by the claw binary after every AI turn.

use sqlx::SqlitePool;
use uuid::Uuid;

/// Values decoded from the `token_usage` OSC envelope.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TurnTokens {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
}

/// Aggregated token totals for a session (summed over all turns).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct SessionTokenTotals {
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_creation_tokens: i64,
    pub total_cache_read_tokens: i64,
    pub turn_count: i64,
}

// ── Writes ────────────────────────────────────────────────────────────────

/// Insert one token-usage row for a completed turn.
pub async fn record_turn(
    pool: &SqlitePool,
    session_id: &str,
    tokens: &TurnTokens,
) -> Result<(), sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO token_usage
             (id, session_id, model,
              input_tokens, output_tokens,
              cache_creation_tokens, cache_read_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(session_id)
    .bind(&tokens.model)
    .bind(tokens.input_tokens)
    .bind(tokens.output_tokens)
    .bind(tokens.cache_creation_input_tokens)
    .bind(tokens.cache_read_input_tokens)
    .execute(pool)
    .await?;
    Ok(())
}

// ── Reads ─────────────────────────────────────────────────────────────────

/// Sum all token usage for a specific session.
pub async fn session_totals(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<SessionTokenTotals, sqlx::Error> {
    sqlx::query_as::<_, SessionTokenTotals>(
        "SELECT
            COALESCE(SUM(input_tokens),          0) AS total_input_tokens,
            COALESCE(SUM(output_tokens),         0) AS total_output_tokens,
            COALESCE(SUM(cache_creation_tokens), 0) AS total_cache_creation_tokens,
            COALESCE(SUM(cache_read_tokens),     0) AS total_cache_read_tokens,
            COUNT(*)                                AS turn_count
         FROM token_usage
         WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_one(pool)
    .await
}

/// Sum ALL token usage across every session belonging to a student.
pub async fn student_total_tokens(
    pool: &SqlitePool,
    student_id: &str,
) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(tu.input_tokens + tu.output_tokens), 0)
         FROM token_usage tu
         JOIN sessions s ON s.id = tu.session_id
         WHERE s.student_id = ?",
    )
    .bind(student_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

/// Record a token deduction with separate input/output multipliers applied (audit trail).
pub async fn record_deduction(
    pool: &SqlitePool,
    student_id: &str,
    session_id: &str,
    model_name: &str,
    input_multiplier: f64,
    output_multiplier: f64,
    input_tokens_used: i64,
    output_tokens_used: i64,
    input_tokens_deducted: i64,
    output_tokens_deducted: i64,
    tokens_deducted: i64,
    balance_before: i64,
    balance_after: i64,
) -> Result<(), sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    // Calculate average multiplier for legacy 'multiplier' column (weighted by token count)
    let total_tokens = input_tokens_used + output_tokens_used;
    let avg_multiplier = if total_tokens > 0 {
        ((input_tokens_used as f64 * input_multiplier) + (output_tokens_used as f64 * output_multiplier)) 
            / total_tokens as f64
    } else {
        1.0
    };
    
    sqlx::query(
        "INSERT INTO token_deductions
            (id, student_id, session_id, model_name,
             multiplier, input_multiplier, output_multiplier,
             input_tokens_used, output_tokens_used,
             input_tokens_deducted, output_tokens_deducted,
             tokens_used, tokens_deducted,
             balance_before, balance_after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(student_id)
    .bind(session_id)
    .bind(model_name)
    .bind(avg_multiplier)
    .bind(input_multiplier)
    .bind(output_multiplier)
    .bind(input_tokens_used)
    .bind(output_tokens_used)
    .bind(input_tokens_deducted)
    .bind(output_tokens_deducted)
    .bind(total_tokens)
    .bind(tokens_deducted)
    .bind(balance_before)
    .bind(balance_after)
    .execute(pool)
    .await?;
    Ok(())
}
