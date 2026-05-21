use crate::db::{BackendResult, SqliteBackend, SessionTokenTotals, StudentTokenTotals, TurnTokens};

impl SqliteBackend {
    pub async fn _record_turn(&self, session_id: &str, tokens: &TurnTokens) -> BackendResult<()> {
        Ok(crate::db::token_usage::record_turn(&self.pool, session_id, tokens).await?)
    }
    pub async fn _session_totals(&self, session_id: &str) -> BackendResult<SessionTokenTotals> {
        Ok(crate::db::token_usage::session_totals(&self.pool, session_id).await?)
    }
    pub async fn _student_total_tokens(&self, student_id: &str) -> BackendResult<StudentTokenTotals> {
        Ok(crate::db::token_usage::student_total_tokens(&self.pool, student_id).await?)
    }
    pub async fn _record_deduction(
        &self, student_id: &str, session_id: &str, model_name: &str,
        input_multiplier: f64, output_multiplier: f64,
        input_tokens_used: i64, output_tokens_used: i64,
        input_tokens_deducted: i64, output_tokens_deducted: i64,
        tokens_deducted: i64, balance_before: i64, balance_after: i64,
    ) -> BackendResult<()> {
        Ok(crate::db::token_usage::record_deduction(
            &self.pool, student_id, session_id, model_name,
            input_multiplier, output_multiplier,
            input_tokens_used, output_tokens_used,
            input_tokens_deducted, output_tokens_deducted,
            tokens_deducted, balance_before, balance_after,
        ).await?)
    }
    pub async fn _deduction_history(&self, student_id: &str) -> BackendResult<Vec<crate::db::TokenDeductionRecord>> {
        use sqlx::Row;
        let rows = sqlx::query(
            "SELECT id, session_id, model_name, input_multiplier, output_multiplier, input_tokens_used, output_tokens_used, input_tokens_deducted, output_tokens_deducted, tokens_used, tokens_deducted, balance_before, balance_after, recorded_at FROM token_deductions WHERE student_id = ? ORDER BY recorded_at DESC LIMIT 100",
        ).bind(student_id).fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(|row| crate::db::TokenDeductionRecord {
            id: row.get("id"), student_id: student_id.to_string(), session_id: row.get("session_id"), model_name: row.get("model_name"),
            input_multiplier: row.get("input_multiplier"), output_multiplier: row.get("output_multiplier"),
            input_tokens_used: row.get("input_tokens_used"), output_tokens_used: row.get("output_tokens_used"),
            input_tokens_deducted: row.get("input_tokens_deducted"), output_tokens_deducted: row.get("output_tokens_deducted"),
            tokens_used: row.get("tokens_used"), tokens_deducted: row.get("tokens_deducted"),
            balance_before: row.get("balance_before"), balance_after: row.get("balance_after"), recorded_at: row.get("recorded_at"),
        }).collect())
    }
}
