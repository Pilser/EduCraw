use crate::client::QueryParams;
use crate::error::Result;
use crate::types::*;
use super::TurnTokens;
use super::extract::{extract_array, extract_aggregate_sum, extract_count};

impl crate::client::HelixClient {
    pub async fn _record_turn(&self, student_id: &str, session_id: &str, tokens: &TurnTokens) -> Result<()> {
        self.write("record_turn", QueryParams::new()
            .add("student_id", student_id)
            .add("session_id", session_id)
            .add("model", tokens.model.as_str())
            .add("input_tokens", tokens.input_tokens)
            .add("output_tokens", tokens.output_tokens)
            .add("cache_creation_tokens", tokens.cache_creation_input_tokens)
            .add("cache_read_tokens", tokens.cache_read_input_tokens)).await?;
        Ok(())
    }

    pub async fn _session_totals(&self, session_id: &str) -> Result<SessionTotals> {
        let resp = self.read("session_totals", QueryParams::new().add("session_id", session_id)).await?;
        Ok(SessionTotals {
            total_input_tokens: extract_aggregate_sum(&resp, "totals", "input_tokens")?,
            total_output_tokens: extract_aggregate_sum(&resp, "output", "output_tokens")?,
            total_cache_creation_tokens: extract_aggregate_sum(&resp, "cache_creation", "cache_creation_tokens")?,
            total_cache_read_tokens: extract_aggregate_sum(&resp, "cache_read", "cache_read_tokens")?,
            turn_count: extract_count(&resp, "turn_count")?,
        })
    }

    pub async fn _student_total_tokens(&self, student_id: &str) -> Result<StudentTotals> {
        let resp = self.read("student_total_tokens", QueryParams::new().add("student_id", student_id)).await?;
        Ok(StudentTotals {
            total_input_tokens: extract_aggregate_sum(&resp, "input_total", "input_tokens")?,
            total_output_tokens: extract_aggregate_sum(&resp, "output_total", "output_tokens")?,
            total_cache_creation_tokens: extract_aggregate_sum(&resp, "cache_creation_total", "cache_creation_tokens")?,
            total_cache_read_tokens: extract_aggregate_sum(&resp, "cache_read_total", "cache_read_tokens")?,
            turn_count: extract_count(&resp, "turn_count")?,
        })
    }

    pub async fn _record_deduction(
        &self, student_id: &str, session_id: &str, model_name: &str,
        input_multiplier: f64, output_multiplier: f64,
        input_tokens_used: i64, output_tokens_used: i64,
        input_tokens_deducted: i64, output_tokens_deducted: i64,
        tokens_deducted: i64, balance_before: i64, balance_after: i64,
    ) -> Result<()> {
        let recorded_at = chrono::Utc::now().to_rfc3339();
        self.write("record_deduction", QueryParams::new()
            .add("student_id", student_id)
            .add("session_id", session_id)
            .add("model_name", model_name)
            .add("input_multiplier", input_multiplier)
            .add("output_multiplier", output_multiplier)
            .add("input_tokens_used", input_tokens_used)
            .add("output_tokens_used", output_tokens_used)
            .add("input_tokens_deducted", input_tokens_deducted)
            .add("output_tokens_deducted", output_tokens_deducted)
            .add("tokens_deducted", tokens_deducted)
            .add("balance_before", balance_before)
            .add("balance_after", balance_after)
            .add("recorded_at", recorded_at)).await?;
        Ok(())
    }

    pub async fn _deduction_history(&self, student_id: &str) -> Result<Vec<TokenDeduction>> {
        let resp = self.read("deduction_history", QueryParams::new().add("student_id", student_id)).await?;
        extract_array(&resp, "deductions")
    }
}
