use crate::db::{BackendResult, HelixBackend, SessionTokenTotals, StudentTokenTotals, TurnTokens, TokenDeductionRecord};
use educlaw_helix::DbBackend as HelixDb;

impl HelixBackend {
    pub async fn _record_turn(&self, student_id: &str, session_id: &str, tokens: &TurnTokens) -> BackendResult<()> {
        Ok(HelixDb::record_turn(&self.client, student_id, session_id, tokens).await?)
    }
    pub async fn _session_totals(&self, session_id: &str) -> BackendResult<SessionTokenTotals> {
        Ok(HelixDb::session_totals(&self.client, session_id).await?)
    }
    pub async fn _student_total_tokens(&self, student_id: &str) -> BackendResult<StudentTokenTotals> {
        Ok(HelixDb::student_total_tokens(&self.client, student_id).await?)
    }
    pub async fn _record_deduction(
        &self, student_id: &str, session_id: &str, model_name: &str,
        input_multiplier: f64, output_multiplier: f64,
        input_tokens_used: i64, output_tokens_used: i64,
        input_tokens_deducted: i64, output_tokens_deducted: i64,
        tokens_deducted: i64, balance_before: i64, balance_after: i64,
    ) -> BackendResult<()> {
        Ok(HelixDb::record_deduction(&self.client, student_id, session_id, model_name,
            input_multiplier, output_multiplier, input_tokens_used, output_tokens_used,
            input_tokens_deducted, output_tokens_deducted, tokens_deducted, balance_before, balance_after).await?)
    }
    pub async fn _deduction_history(&self, student_id: &str) -> BackendResult<Vec<TokenDeductionRecord>> {
        Ok(HelixDb::deduction_history(&self.client, student_id).await?)
    }
}
