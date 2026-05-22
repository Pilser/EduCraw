use crate::db::{BackendResult, HelixBackend, SessionTokenTotals, StudentTokenTotals, TurnTokens, TokenDeductionRecord};
use educlaw_helix::DbBackend as HelixDb;
use super::conv::*;

impl HelixBackend {
    pub async fn _record_turn(&self, student_id: &str, session_id: &str, tokens: &TurnTokens) -> BackendResult<()> {
        let h = educlaw_helix::TurnTokens {
            model: tokens.model.clone(), input_tokens: tokens.input_tokens,
            output_tokens: tokens.output_tokens,
            cache_creation_input_tokens: tokens.cache_creation_input_tokens,
            cache_read_input_tokens: tokens.cache_read_input_tokens,
        };
        Ok(HelixDb::record_turn(&self.client, student_id, session_id, &h).await?)
    }
    pub async fn _session_totals(&self, session_id: &str) -> BackendResult<SessionTokenTotals> {
        let t = HelixDb::session_totals(&self.client, session_id).await?;
        Ok(SessionTokenTotals {
            total_input_tokens: t.total_input_tokens, total_output_tokens: t.total_output_tokens,
            total_cache_creation_tokens: t.total_cache_creation_tokens,
            total_cache_read_tokens: t.total_cache_read_tokens, turn_count: t.turn_count,
        })
    }
    pub async fn _student_total_tokens(&self, student_id: &str) -> BackendResult<StudentTokenTotals> {
        let t = HelixDb::student_total_tokens(&self.client, student_id).await?;
        Ok(StudentTokenTotals {
            total_input_tokens: t.total_input_tokens, total_output_tokens: t.total_output_tokens,
            total_cache_creation_tokens: t.total_cache_creation_tokens,
            total_cache_read_tokens: t.total_cache_read_tokens, turn_count: t.turn_count,
        })
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
        let d = HelixDb::deduction_history(&self.client, student_id).await?;
        Ok(d.into_iter().map(helix_deduction_to_local).collect())
    }
}
