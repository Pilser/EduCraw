// educlaw-server/src/acp_bridge/token_calculator.rs
//
// Token calculation module for handling input/output token deductions
// with separate multipliers applied.

use sqlx::SqlitePool;
use crate::db::{models as db_models, students as db_students, token_usage as db_tokens};

/// Calculate and record token deduction with separate input/output multipliers.
/// 
/// This function:
/// 1. Fetches the model's input and output multipliers from the database
/// 2. Calculates separate deductions for input and output tokens
/// 3. Records the deduction in the audit trail with full breakdown
/// 4. Deducts the total from the student's token balance
/// 
/// Note: Goose sends per-turn token counts, not cumulative totals.
pub async fn calculate_and_deduct(
    pool: &SqlitePool,
    student_id: &str,
    session_id: &str,
    model_name: &str,
    input_tokens: i64,
    output_tokens: i64,
) -> Result<(), anyhow::Error> {
    // Skip if no tokens (can happen on errors or empty responses)
    if input_tokens <= 0 && output_tokens <= 0 {
        tracing::debug!(
            session_id = %session_id,
            "no tokens to deduct, skipping"
        );
        return Ok(());
    }

    // Get model multipliers (input and output)
    let (input_multiplier, output_multiplier) = match db_models::get_model_multipliers(pool, model_name).await {
        Ok((im, om)) => (im, om),
        Err(e) => {
            tracing::warn!(
                model = %model_name,
                error = %e,
                "failed to get model multipliers, defaulting to (1.0, 1.0)"
            );
            (1.0, 1.0)
        }
    };

    // Calculate separate deductions (rounded up)
    let input_tokens_deducted = (input_tokens as f64 * input_multiplier).ceil() as i64;
    let output_tokens_deducted = (output_tokens as f64 * output_multiplier).ceil() as i64;
    let total_tokens_deducted = input_tokens_deducted + output_tokens_deducted;

    tracing::info!(
        session_id = %session_id,
        model = %model_name,
        input_tokens,
        output_tokens,
        input_multiplier,
        output_multiplier,
        input_tokens_deducted,
        output_tokens_deducted,
        total_tokens_deducted,
        "📊 [TOKEN CALC] Calculated token deduction"
    );

    // Skip deduction if total is 0 or negative
    if total_tokens_deducted <= 0 {
        tracing::debug!(
            session_id = %session_id,
            total_tokens_deducted,
            "non-positive deduction, skipping"
        );
        return Ok(());
    }

    // Get current balance before deduction
    let balance_before = db_students::get_token_balance(pool, student_id).await?;

    // Deduct tokens (can go negative)
    let balance_after = db_students::deduct_tokens(pool, student_id, total_tokens_deducted).await?;

    // Record deduction in audit log with full breakdown
    db_tokens::record_deduction(
        pool,
        student_id,
        session_id,
        model_name,
        input_multiplier,
        output_multiplier,
        input_tokens,
        output_tokens,
        input_tokens_deducted,
        output_tokens_deducted,
        total_tokens_deducted,
        balance_before,
        balance_after,
    )
    .await?;

    // Log the deduction
    tracing::info!(
        student_id = %student_id,
        model = %model_name,
        input_multiplier,
        output_multiplier,
        input_tokens_used = input_tokens,
        output_tokens_used = output_tokens,
        input_tokens_deducted,
        output_tokens_deducted,
        total_tokens_deducted,
        balance_before,
        balance_after,
        "✅ [TOKEN DEDUCTION] Token deduction recorded"
    );

    if balance_after < 0 {
        tracing::warn!(
            student_id = %student_id,
            balance_after,
            "⚠️ student token balance is now negative"
        );
    }

    Ok(())
}
