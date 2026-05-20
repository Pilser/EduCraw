use serde::{Deserialize, Serialize};
use serde_json;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub enabled: i64,
    #[serde(default = "default_multiplier")]
    pub input_multiplier: f64,
    #[serde(default = "default_multiplier")]
    pub output_multiplier: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub think_mode: Option<i64>,
    #[serde(default)]
    pub visual_support: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_params: Option<String>,
    #[serde(default)]
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
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub id: String,
    #[serde(default)]
    pub username: String,
    #[serde(skip_serializing, default)]
    pub password_hash: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub cohort_id: String,
    #[serde(default)]
    pub home_dir: Option<String>,
    #[serde(default)]
    pub uid_slot: Option<i64>,
    #[serde(default)]
    pub token_limit: Option<i64>,
    #[serde(default)]
    pub token_balance: i64,
    #[serde(default)]
    pub restriction_status: Option<String>,
    #[serde(default)]
    pub restriction_message: Option<String>,
    #[serde(default)]
    pub last_model: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub last_seen: Option<String>,
}

fn deserialize_string_or_int<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        _ => Ok(String::new()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub id: String,
    #[serde(default)]
    pub student_id: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub namespace_pid: Option<i64>,
    #[serde(default)]
    pub overlay_mount: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub last_input_at: Option<String>,
    #[serde(default)]
    pub last_token_checkpoint: i64,
    #[serde(default)]
    pub started_at: String,
    #[serde(default)]
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cohort {
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subject {
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub id: String,
    #[serde(default)]
    pub cohort_id: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenCode {
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub id: String,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub tokens: i64,
    #[serde(default)]
    pub used_by: Option<String>,
    #[serde(default)]
    pub used_at: Option<String>,
    #[serde(default)]
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
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub id: String,
    #[serde(default)]
    pub student_id: String,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub input_multiplier: f64,
    #[serde(default)]
    pub output_multiplier: f64,
    #[serde(default)]
    pub input_tokens_used: i64,
    #[serde(default)]
    pub output_tokens_used: i64,
    #[serde(default)]
    pub input_tokens_deducted: i64,
    #[serde(default)]
    pub output_tokens_deducted: i64,
    #[serde(default)]
    pub tokens_used: i64,
    #[serde(default)]
    pub tokens_deducted: i64,
    #[serde(default)]
    pub balance_before: i64,
    #[serde(default)]
    pub balance_after: i64,
    #[serde(default)]
    pub recorded_at: String,
}

#[derive(Debug)]
pub enum RedeemResult {
    Success { tokens: i64, new_balance: i64 },
    NotFound,
    AlreadyUsed,
}
