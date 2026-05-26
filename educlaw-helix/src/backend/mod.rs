use async_trait::async_trait;

use crate::client::HelixClient;
use crate::error::Result;
use crate::types::*;

pub mod api;
pub mod cohorts;
pub mod extract;
pub mod models;
pub mod sessions;
pub mod students;
pub mod subjects;
pub mod token_codes;
pub mod tokens;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TurnTokens {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
}

#[async_trait]
pub trait DbBackend: Send + Sync {
    // ── Models ──
    async fn list_models(&self) -> Result<Vec<Model>>;
    async fn list_enabled_models(&self) -> Result<Vec<Model>>;
    async fn get_model_by_name(&self, name: &str) -> Result<Option<Model>>;
    async fn get_model_multipliers(&self, name: &str) -> Result<(f64, f64)>;
    async fn models_for_student(&self, student_id: &str) -> Result<Vec<String>>;
    async fn raw_assignments_for_student(&self, student_id: &str) -> Result<Vec<String>>;
    async fn insert_model(&self, id: &str, name: &str, display_name: &str, input_multiplier: f64, output_multiplier: f64) -> Result<String>;
    async fn set_enabled(&self, id: &str, enabled: bool) -> Result<()>;
    async fn set_multipliers(&self, name: &str, input_multiplier: f64, output_multiplier: f64) -> Result<()>;
    async fn delete_model(&self, id: &str) -> Result<()>;
    async fn update_model_specs(&self, id: &str, provider: Option<&str>, think_mode: Option<i64>, visual_support: i64) -> Result<()>;
    async fn update_thinking_params(&self, id: &str, params: Option<&str>) -> Result<()>;
    async fn set_student_models(&self, student_id: &str, model_names: &[String]) -> Result<()>;
    // ── Students ──
    async fn get_student(&self, id: &str) -> Result<Option<Student>>;
    async fn get_student_by_username(&self, username: &str) -> Result<Option<Student>>;
    async fn list_students(&self) -> Result<Vec<Student>>;
    async fn insert_student(&self, student: &Student) -> Result<()>;
    async fn touch_last_seen(&self, id: &str) -> Result<()>;
    async fn update_display_name(&self, id: &str, display_name: &str) -> Result<()>;
    async fn update_cohort(&self, id: &str, cohort_id: &str) -> Result<()>;
    async fn update_password(&self, id: &str, password_hash: &str) -> Result<()>;
    async fn delete_student(&self, id: &str) -> Result<()>;
    async fn set_uid_slot(&self, id: &str, slot: Option<i64>) -> Result<()>;
    async fn ban_student(&self, id: &str, message: Option<&str>) -> Result<()>;
    async fn unban_student(&self, id: &str) -> Result<()>;
    async fn set_last_model(&self, id: &str, model: &str) -> Result<()>;
    async fn set_recent_thread_id(&self, id: &str, thread_id: &str) -> Result<()>;
    async fn get_recent_thread_id(&self, id: &str) -> Result<Option<String>>;
    async fn get_token_balance(&self, id: &str) -> Result<i64>;
    async fn deduct_tokens(&self, id: &str, amount: i64) -> Result<i64>;
    async fn topup_tokens(&self, id: &str, amount: i64) -> Result<i64>;
    // ── Sessions ──
    async fn get_session(&self, id: &str) -> Result<Option<Session>>;
    async fn list_active_sessions(&self) -> Result<Vec<Session>>;
    async fn insert_session(&self, session: &Session) -> Result<()>;
    async fn set_session_model(&self, id: &str, model: &str) -> Result<()>;
    async fn set_session_state(&self, id: &str, state: &str) -> Result<()>;
    async fn set_namespace_pid(&self, id: &str, pid: i64) -> Result<()>;
    async fn touch_last_input(&self, id: &str) -> Result<()>;
    async fn get_last_token_checkpoint(&self, id: &str) -> Result<i64>;
    async fn update_last_token_checkpoint(&self, id: &str, checkpoint: i64) -> Result<()>;
    // ── Cohorts ──
    async fn get_cohort(&self, id: &str) -> Result<Option<Cohort>>;
    async fn list_cohorts(&self) -> Result<Vec<Cohort>>;
    async fn insert_cohort(&self, cohort: &Cohort) -> Result<()>;
    async fn rename_cohort(&self, old_id: &str, new_id: &str, new_title: &str) -> Result<()>;
    async fn update_cohort_title(&self, id: &str, new_title: &str) -> Result<()>;
    async fn delete_cohort(&self, id: &str) -> Result<()>;
    // ── Subjects ──
    async fn get_subject(&self, id: &str) -> Result<Option<Subject>>;
    async fn get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> Result<Option<Subject>>;
    async fn list_subjects(&self, cohort_id: &str) -> Result<Vec<Subject>>;
    async fn insert_subject(&self, subject: &Subject) -> Result<()>;
    async fn update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> Result<()>;
    async fn delete_subject(&self, id: &str) -> Result<()>;
    // ── Token usage ──
    async fn record_turn(&self, student_id: &str, session_id: &str, tokens: &TurnTokens) -> Result<()>;
    async fn session_totals(&self, session_id: &str) -> Result<SessionTotals>;
    async fn student_total_tokens(&self, student_id: &str) -> Result<StudentTotals>;
    async fn record_deduction(&self, student_id: &str, session_id: &str, model_name: &str, input_multiplier: f64, output_multiplier: f64, input_tokens_used: i64, output_tokens_used: i64, input_tokens_deducted: i64, output_tokens_deducted: i64, tokens_deducted: i64, balance_before: i64, balance_after: i64) -> Result<()>;
    async fn deduction_history(&self, student_id: &str) -> Result<Vec<TokenDeduction>>;
    // ── Token codes ──
    async fn generate_codes(&self, tokens: i64, count: i64) -> Result<Vec<String>>;
    async fn list_codes(&self, tokens: Option<i64>, used: Option<bool>) -> Result<Vec<TokenCode>>;
    async fn delete_code(&self, id: &str) -> Result<()>;
    async fn redeem_code(&self, code: &str, student_id: &str) -> Result<RedeemResult>;
    async fn export_codes(&self, tokens: i64) -> Result<Vec<TokenCode>>;
    // ── API ──
    async fn get_me(&self, student_id: &str) -> Result<serde_json::Value>;
    async fn get_session_models(&self, session_id: &str) -> Result<serde_json::Value>;
    async fn students_with_active_sessions(&self) -> Result<serde_json::Value>;
    async fn create_session_api(&self, params: &serde_json::Value) -> Result<serde_json::Value>;
    async fn set_session_model_api(&self, session_id: &str, model: &str) -> Result<()>;
    async fn update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> Result<serde_json::Value>;
}

#[async_trait]
impl DbBackend for HelixClient {
    // ── Models (delegates to models.rs) ──
    async fn list_models(&self) -> Result<Vec<Model>> { self._list_models().await }
    async fn list_enabled_models(&self) -> Result<Vec<Model>> { self._list_enabled_models().await }
    async fn get_model_by_name(&self, name: &str) -> Result<Option<Model>> { self._get_model_by_name(name).await }
    async fn get_model_multipliers(&self, name: &str) -> Result<(f64, f64)> { self._get_model_multipliers(name).await }
    async fn models_for_student(&self, student_id: &str) -> Result<Vec<String>> { self._models_for_student(student_id).await }
    async fn raw_assignments_for_student(&self, student_id: &str) -> Result<Vec<String>> { self._raw_assignments_for_student(student_id).await }
    async fn insert_model(&self, id: &str, name: &str, display_name: &str, input_multiplier: f64, output_multiplier: f64) -> Result<String> { self._insert_model(id, name, display_name, input_multiplier, output_multiplier).await }
    async fn set_enabled(&self, id: &str, enabled: bool) -> Result<()> { self._set_enabled(id, enabled).await }
    async fn set_multipliers(&self, name: &str, input_multiplier: f64, output_multiplier: f64) -> Result<()> { self._set_multipliers(name, input_multiplier, output_multiplier).await }
    async fn delete_model(&self, id: &str) -> Result<()> { self._delete_model(id).await }
    async fn update_model_specs(&self, id: &str, provider: Option<&str>, think_mode: Option<i64>, visual_support: i64) -> Result<()> { self._update_model_specs(id, provider, think_mode, visual_support).await }
    async fn update_thinking_params(&self, id: &str, params: Option<&str>) -> Result<()> { self._update_thinking_params(id, params).await }
    async fn set_student_models(&self, student_id: &str, model_names: &[String]) -> Result<()> { self._set_student_models(student_id, model_names).await }

    // ── Students (delegates to students.rs) ──
    async fn get_student(&self, id: &str) -> Result<Option<Student>> { self._get_student(id).await }
    async fn get_student_by_username(&self, username: &str) -> Result<Option<Student>> { self._get_student_by_username(username).await }
    async fn list_students(&self) -> Result<Vec<Student>> { self._list_students().await }
    async fn insert_student(&self, student: &Student) -> Result<()> { self._insert_student(student).await }
    async fn touch_last_seen(&self, id: &str) -> Result<()> { self._touch_last_seen(id).await }
    async fn update_display_name(&self, id: &str, display_name: &str) -> Result<()> { self._update_display_name(id, display_name).await }
    async fn update_cohort(&self, id: &str, cohort_id: &str) -> Result<()> { self._update_cohort(id, cohort_id).await }
    async fn update_password(&self, id: &str, password_hash: &str) -> Result<()> { self._update_password(id, password_hash).await }
    async fn delete_student(&self, id: &str) -> Result<()> { self._delete_student(id).await }
    async fn set_uid_slot(&self, id: &str, slot: Option<i64>) -> Result<()> { self._set_uid_slot(id, slot).await }
    async fn ban_student(&self, id: &str, message: Option<&str>) -> Result<()> { self._ban_student(id, message).await }
    async fn unban_student(&self, id: &str) -> Result<()> { self._unban_student(id).await }
    async fn set_last_model(&self, id: &str, model: &str) -> Result<()> { self._set_last_model(id, model).await }
    async fn set_recent_thread_id(&self, id: &str, thread_id: &str) -> Result<()> { self._set_recent_thread_id(id, thread_id).await }
    async fn get_recent_thread_id(&self, id: &str) -> Result<Option<String>> { self._get_recent_thread_id(id).await }
    async fn get_token_balance(&self, id: &str) -> Result<i64> { self._get_token_balance(id).await }
    async fn deduct_tokens(&self, id: &str, amount: i64) -> Result<i64> { self._deduct_tokens(id, amount).await }
    async fn topup_tokens(&self, id: &str, amount: i64) -> Result<i64> { self._topup_tokens(id, amount).await }

    // ── Sessions (delegates to sessions.rs) ──
    async fn get_session(&self, id: &str) -> Result<Option<Session>> { self._get_session(id).await }
    async fn list_active_sessions(&self) -> Result<Vec<Session>> { self._list_active_sessions().await }
    async fn insert_session(&self, session: &Session) -> Result<()> { self._insert_session(session).await }
    async fn set_session_model(&self, id: &str, model: &str) -> Result<()> { self._set_session_model(id, model).await }
    async fn set_session_state(&self, id: &str, state: &str) -> Result<()> { self._set_session_state(id, state).await }
    async fn set_namespace_pid(&self, id: &str, pid: i64) -> Result<()> { self._set_namespace_pid(id, pid).await }
    async fn touch_last_input(&self, id: &str) -> Result<()> { self._touch_last_input(id).await }
    async fn get_last_token_checkpoint(&self, id: &str) -> Result<i64> { self._get_last_token_checkpoint(id).await }
    async fn update_last_token_checkpoint(&self, id: &str, checkpoint: i64) -> Result<()> { self._update_last_token_checkpoint(id, checkpoint).await }

    // ── Cohorts (delegates to cohorts.rs) ──
    async fn get_cohort(&self, id: &str) -> Result<Option<Cohort>> { self._get_cohort(id).await }
    async fn list_cohorts(&self) -> Result<Vec<Cohort>> { self._list_cohorts().await }
    async fn insert_cohort(&self, cohort: &Cohort) -> Result<()> { self._insert_cohort(cohort).await }
    async fn rename_cohort(&self, old_id: &str, new_id: &str, new_title: &str) -> Result<()> { self._rename_cohort(old_id, new_id, new_title).await }
    async fn update_cohort_title(&self, id: &str, new_title: &str) -> Result<()> { self._update_cohort_title(id, new_title).await }
    async fn delete_cohort(&self, id: &str) -> Result<()> { self._delete_cohort(id).await }

    // ── Subjects (delegates to subjects.rs) ──
    async fn get_subject(&self, id: &str) -> Result<Option<Subject>> { self._get_subject(id).await }
    async fn get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> Result<Option<Subject>> { self._get_subject_by_slug(cohort_id, slug).await }
    async fn list_subjects(&self, cohort_id: &str) -> Result<Vec<Subject>> { self._list_subjects(cohort_id).await }
    async fn insert_subject(&self, subject: &Subject) -> Result<()> { self._insert_subject(subject).await }
    async fn update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> Result<()> { self._update_subject(id, new_slug, new_title).await }
    async fn delete_subject(&self, id: &str) -> Result<()> { self._delete_subject(id).await }

    // ── Tokens (delegates to tokens.rs) ──
    async fn record_turn(&self, student_id: &str, session_id: &str, tokens: &TurnTokens) -> Result<()> { self._record_turn(student_id, session_id, tokens).await }
    async fn session_totals(&self, session_id: &str) -> Result<SessionTotals> { self._session_totals(session_id).await }
    async fn student_total_tokens(&self, student_id: &str) -> Result<StudentTotals> { self._student_total_tokens(student_id).await }
    async fn record_deduction(&self, student_id: &str, session_id: &str, model_name: &str, input_multiplier: f64, output_multiplier: f64, input_tokens_used: i64, output_tokens_used: i64, input_tokens_deducted: i64, output_tokens_deducted: i64, tokens_deducted: i64, balance_before: i64, balance_after: i64) -> Result<()> { self._record_deduction(student_id, session_id, model_name, input_multiplier, output_multiplier, input_tokens_used, output_tokens_used, input_tokens_deducted, output_tokens_deducted, tokens_deducted, balance_before, balance_after).await }
    async fn deduction_history(&self, student_id: &str) -> Result<Vec<TokenDeduction>> { self._deduction_history(student_id).await }

    // ── Token Codes (delegates to token_codes.rs) ──
    async fn generate_codes(&self, tokens: i64, count: i64) -> Result<Vec<String>> { self._generate_codes(tokens, count).await }
    async fn list_codes(&self, tokens: Option<i64>, used: Option<bool>) -> Result<Vec<TokenCode>> { self._list_codes(tokens, used).await }
    async fn delete_code(&self, id: &str) -> Result<()> { self._delete_code(id).await }
    async fn redeem_code(&self, code: &str, student_id: &str) -> Result<RedeemResult> { self._redeem_code(code, student_id).await }
    async fn export_codes(&self, tokens: i64) -> Result<Vec<TokenCode>> { self._export_codes(tokens).await }

    // ── API (delegates to api.rs) ──
    async fn get_me(&self, student_id: &str) -> Result<serde_json::Value> { self._get_me(student_id).await }
    async fn get_session_models(&self, session_id: &str) -> Result<serde_json::Value> { self._get_session_models(session_id).await }
    async fn students_with_active_sessions(&self) -> Result<serde_json::Value> { self._students_with_active_sessions().await }
    async fn create_session_api(&self, params: &serde_json::Value) -> Result<serde_json::Value> { self._create_session_api(params).await }
    async fn set_session_model_api(&self, session_id: &str, model: &str) -> Result<()> { self._set_session_model_api(session_id, model).await }
    async fn update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> Result<serde_json::Value> { self._update_me_api(student_id, updates).await }
}
