use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub enabled: i64,
    #[serde(default = "default_multiplier")]
    pub input_multiplier: f64,
    #[serde(default = "default_multiplier")]
    pub output_multiplier: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub think_mode: Option<i64>,
    pub visual_support: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_params: Option<String>,
    pub created_at: String,
}

fn default_multiplier() -> f64 {
    1.0
}

impl Model {
    pub fn parsed_thinking_params(
        &self,
    ) -> Option<std::collections::HashMap<String, serde_json::Value>> {
        self.thinking_params
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Student {
    pub id: String,
    pub username: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub display_name: String,
    pub role: String,
    pub cohort_id: String,
    pub home_dir: Option<String>,
    pub uid_slot: Option<i64>,
    pub token_limit: Option<i64>,
    pub token_balance: i64,
    pub restriction_status: Option<String>,
    pub restriction_message: Option<String>,
    pub last_model: Option<String>,
    pub created_at: String,
    pub last_seen: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub student_id: String,
    pub state: String,
    pub namespace_pid: Option<i64>,
    pub overlay_mount: String,
    pub model: Option<String>,
    pub last_input_at: Option<String>,
    pub last_token_checkpoint: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cohort {
    pub id: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subject {
    pub id: String,
    pub cohort_id: String,
    pub slug: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenCode {
    pub id: String,
    pub code: String,
    pub tokens: i64,
    pub used_by: Option<String>,
    pub used_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudentTotals {
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_creation_tokens: i64,
    pub total_cache_read_tokens: i64,
    pub turn_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTotals {
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_creation_tokens: i64,
    pub total_cache_read_tokens: i64,
    pub turn_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenDeduction {
    pub id: String,
    pub student_id: String,
    pub session_id: String,
    pub model_name: String,
    pub input_multiplier: f64,
    pub output_multiplier: f64,
    pub input_tokens_used: i64,
    pub output_tokens_used: i64,
    pub input_tokens_deducted: i64,
    pub output_tokens_deducted: i64,
    pub tokens_used: i64,
    pub tokens_deducted: i64,
    pub balance_before: i64,
    pub balance_after: i64,
    pub recorded_at: String,
}

#[derive(Debug)]
pub enum RedeemResult {
    Success { tokens: i64, new_balance: i64 },
    NotFound,
    AlreadyUsed,
}
