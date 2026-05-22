// educlaw-server/src/db/mod.rs
//
// Unified backend trait that the Helix implementation satisfies.
// API handlers call `state.backend.method()` regardless of the underlying store.

use async_trait::async_trait;

// ── Domain impl modules ────────────────────────────────────────────────────

pub mod helix;

// ── Re-export types from educlaw-helix ─────────────────────────────────────

pub use educlaw_helix::{Cohort, Model, Session, Student, Subject, TokenCode, TurnTokens, RedeemResult};
pub use educlaw_helix::{SessionTotals as SessionTokenTotals, StudentTotals as StudentTokenTotals, TokenDeduction as TokenDeductionRecord};

// ── Result type ────────────────────────────────────────────────────────────

pub type BackendResult<T> = std::result::Result<T, BackendError>;

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("internal: {0}")]
    Internal(#[from] anyhow::Error),
    #[error("helix error: {0}")]
    Helix(#[from] educlaw_helix::HelixError),
}

impl From<BackendError> for crate::error::AppError {
    fn from(err: BackendError) -> Self {
        match err {
            BackendError::NotFound(msg) => crate::error::AppError::NotFound(msg),
            BackendError::Internal(e) => crate::error::AppError::Internal(e),
            BackendError::Helix(e) => crate::error::AppError::Helix(e),
        }
    }
}

// ── DbBackend trait ────────────────────────────────────────────────────────

#[async_trait]
pub trait DbBackend: Send + Sync {
    async fn list_models(&self) -> BackendResult<Vec<Model>>;
    async fn list_enabled_models(&self) -> BackendResult<Vec<Model>>;
    async fn get_model_by_name(&self, name: &str) -> BackendResult<Option<Model>>;
    async fn get_model_multipliers(&self, name: &str) -> BackendResult<(f64, f64)>;
    async fn models_for_student(&self, student_id: &str) -> BackendResult<Vec<String>>;
    async fn raw_assignments_for_student(&self, student_id: &str) -> BackendResult<Vec<String>>;
    async fn insert_model(&self, id: &str, name: &str, display_name: &str, input_multiplier: f64, output_multiplier: f64) -> BackendResult<String>;
    async fn set_enabled(&self, id: &str, enabled: bool) -> BackendResult<()>;
    async fn set_multipliers(&self, name: &str, input_multiplier: f64, output_multiplier: f64) -> BackendResult<()>;
    async fn delete_model(&self, id: &str) -> BackendResult<()>;
    async fn update_model_specs(&self, id: &str, provider: Option<&str>, think_mode: Option<i64>, visual_support: i64) -> BackendResult<()>;
    async fn update_thinking_params(&self, id: &str, params: Option<&str>) -> BackendResult<()>;
    async fn set_student_models(&self, student_id: &str, model_names: &[String]) -> BackendResult<()>;
    async fn get_student(&self, id: &str) -> BackendResult<Option<Student>>;
    async fn get_student_by_username(&self, username: &str) -> BackendResult<Option<Student>>;
    async fn list_students(&self) -> BackendResult<Vec<Student>>;
    async fn insert_student(&self, student: &Student) -> BackendResult<()>;
    async fn touch_last_seen(&self, id: &str) -> BackendResult<()>;
    async fn update_display_name(&self, id: &str, display_name: &str) -> BackendResult<()>;
    async fn update_cohort(&self, id: &str, cohort_id: &str) -> BackendResult<()>;
    async fn update_password(&self, id: &str, password_hash: &str) -> BackendResult<()>;
    async fn delete_student(&self, id: &str) -> BackendResult<()>;
    async fn set_uid_slot(&self, id: &str, slot: Option<i64>) -> BackendResult<()>;
    async fn ban_student(&self, id: &str, message: Option<&str>) -> BackendResult<()>;
    async fn unban_student(&self, id: &str) -> BackendResult<()>;
    async fn set_last_model(&self, id: &str, model: &str) -> BackendResult<()>;
    async fn get_token_balance(&self, id: &str) -> BackendResult<i64>;
    async fn deduct_tokens(&self, id: &str, amount: i64) -> BackendResult<i64>;
    async fn topup_tokens(&self, id: &str, amount: i64) -> BackendResult<i64>;
    async fn get_session(&self, id: &str) -> BackendResult<Option<Session>>;
    async fn list_active_sessions(&self) -> BackendResult<Vec<Session>>;
    async fn insert_session(&self, session: &Session) -> BackendResult<()>;
    async fn set_session_model(&self, id: &str, model: &str) -> BackendResult<()>;
    async fn set_session_state(&self, id: &str, state: &str) -> BackendResult<()>;
    async fn set_namespace_pid(&self, id: &str, pid: i64) -> BackendResult<()>;
    async fn touch_last_input(&self, id: &str) -> BackendResult<()>;
    async fn get_last_token_checkpoint(&self, id: &str) -> BackendResult<i64>;
    async fn update_last_token_checkpoint(&self, id: &str, checkpoint: i64) -> BackendResult<()>;
    async fn get_cohort(&self, id: &str) -> BackendResult<Option<Cohort>>;
    async fn list_cohorts(&self) -> BackendResult<Vec<Cohort>>;
    async fn insert_cohort(&self, cohort: &Cohort) -> BackendResult<()>;
    async fn rename_cohort(&self, old_id: &str, new_id: &str, new_title: &str) -> BackendResult<()>;
    async fn update_cohort_title(&self, id: &str, new_title: &str) -> BackendResult<()>;
    async fn delete_cohort(&self, id: &str) -> BackendResult<()>;
    async fn get_subject(&self, id: &str) -> BackendResult<Option<Subject>>;
    async fn get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> BackendResult<Option<Subject>>;
    async fn list_subjects(&self, cohort_id: &str) -> BackendResult<Vec<Subject>>;
    async fn insert_subject(&self, subject: &Subject) -> BackendResult<()>;
    async fn update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> BackendResult<()>;
    async fn delete_subject(&self, id: &str) -> BackendResult<()>;
    async fn record_turn(&self, student_id: &str, session_id: &str, tokens: &TurnTokens) -> BackendResult<()>;
    async fn session_totals(&self, session_id: &str) -> BackendResult<SessionTokenTotals>;
    async fn student_total_tokens(&self, student_id: &str) -> BackendResult<StudentTokenTotals>;
    async fn record_deduction(&self, student_id: &str, session_id: &str, model_name: &str, input_multiplier: f64, output_multiplier: f64, input_tokens_used: i64, output_tokens_used: i64, input_tokens_deducted: i64, output_tokens_deducted: i64, tokens_deducted: i64, balance_before: i64, balance_after: i64) -> BackendResult<()>;
    async fn generate_codes(&self, tokens: i64, count: i64) -> BackendResult<Vec<String>>;
    async fn list_codes(&self, tokens: Option<i64>, used: Option<bool>) -> BackendResult<Vec<TokenCode>>;
    async fn delete_code(&self, id: &str) -> BackendResult<()>;
    async fn redeem_code(&self, code: &str, student_id: &str) -> BackendResult<RedeemResult>;
    async fn export_codes(&self, tokens: i64) -> BackendResult<Vec<TokenCode>>;
    async fn get_me(&self, student_id: &str) -> BackendResult<serde_json::Value>;
    async fn get_session_models(&self, session_id: &str) -> BackendResult<serde_json::Value>;
    async fn students_with_active_sessions(&self) -> BackendResult<serde_json::Value>;
    async fn deduction_history(&self, student_id: &str) -> BackendResult<Vec<TokenDeductionRecord>>;
    async fn create_session_api(&self, params: &serde_json::Value) -> BackendResult<serde_json::Value>;
    async fn set_session_model_api(&self, session_id: &str, model: &str) -> BackendResult<()>;
    async fn update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> BackendResult<serde_json::Value>;
}

// ── HelixBackend ──────────────────────────────────────────────────────────

pub struct HelixBackend { client: educlaw_helix::HelixClient }

impl HelixBackend { pub fn new(client: educlaw_helix::HelixClient) -> Self { Self { client } } }

#[async_trait]
impl DbBackend for HelixBackend {
    // ── Models ──
    async fn list_models(&self) -> BackendResult<Vec<Model>> { self._list_models().await }
    async fn list_enabled_models(&self) -> BackendResult<Vec<Model>> { self._list_enabled_models().await }
    async fn get_model_by_name(&self, name: &str) -> BackendResult<Option<Model>> { self._get_model_by_name(name).await }
    async fn get_model_multipliers(&self, name: &str) -> BackendResult<(f64, f64)> { self._get_model_multipliers(name).await }
    async fn models_for_student(&self, student_id: &str) -> BackendResult<Vec<String>> { self._models_for_student(student_id).await }
    async fn raw_assignments_for_student(&self, student_id: &str) -> BackendResult<Vec<String>> { self._raw_assignments_for_student(student_id).await }
    async fn insert_model(&self, id: &str, name: &str, display_name: &str, input_multiplier: f64, output_multiplier: f64) -> BackendResult<String> { self._insert_model(id, name, display_name, input_multiplier, output_multiplier).await }
    async fn set_enabled(&self, id: &str, enabled: bool) -> BackendResult<()> { self._set_enabled(id, enabled).await }
    async fn set_multipliers(&self, name: &str, input_multiplier: f64, output_multiplier: f64) -> BackendResult<()> { self._set_multipliers(name, input_multiplier, output_multiplier).await }
    async fn delete_model(&self, id: &str) -> BackendResult<()> { self._delete_model(id).await }
    async fn update_model_specs(&self, id: &str, provider: Option<&str>, think_mode: Option<i64>, visual_support: i64) -> BackendResult<()> { self._update_model_specs(id, provider, think_mode, visual_support).await }
    async fn update_thinking_params(&self, id: &str, params: Option<&str>) -> BackendResult<()> { self._update_thinking_params(id, params).await }
    async fn set_student_models(&self, student_id: &str, model_names: &[String]) -> BackendResult<()> { self._set_student_models(student_id, model_names).await }
    // ── Students ──
    async fn get_student(&self, id: &str) -> BackendResult<Option<Student>> { self._get_student(id).await }
    async fn get_student_by_username(&self, username: &str) -> BackendResult<Option<Student>> { self._get_student_by_username(username).await }
    async fn list_students(&self) -> BackendResult<Vec<Student>> { self._list_students().await }
    async fn insert_student(&self, student: &Student) -> BackendResult<()> { self._insert_student(student).await }
    async fn touch_last_seen(&self, id: &str) -> BackendResult<()> { self._touch_last_seen(id).await }
    async fn update_display_name(&self, id: &str, display_name: &str) -> BackendResult<()> { self._update_display_name(id, display_name).await }
    async fn update_cohort(&self, id: &str, cohort_id: &str) -> BackendResult<()> { self._update_cohort(id, cohort_id).await }
    async fn update_password(&self, id: &str, password_hash: &str) -> BackendResult<()> { self._update_password(id, password_hash).await }
    async fn delete_student(&self, id: &str) -> BackendResult<()> { self._delete_student(id).await }
    async fn set_uid_slot(&self, id: &str, slot: Option<i64>) -> BackendResult<()> { self._set_uid_slot(id, slot).await }
    async fn ban_student(&self, id: &str, message: Option<&str>) -> BackendResult<()> { self._ban_student(id, message).await }
    async fn unban_student(&self, id: &str) -> BackendResult<()> { self._unban_student(id).await }
    async fn set_last_model(&self, id: &str, model: &str) -> BackendResult<()> { self._set_last_model(id, model).await }
    async fn get_token_balance(&self, id: &str) -> BackendResult<i64> { self._get_token_balance(id).await }
    async fn deduct_tokens(&self, id: &str, amount: i64) -> BackendResult<i64> { self._deduct_tokens(id, amount).await }
    async fn topup_tokens(&self, id: &str, amount: i64) -> BackendResult<i64> { self._topup_tokens(id, amount).await }
    // ── Sessions ──
    async fn get_session(&self, id: &str) -> BackendResult<Option<Session>> { self._get_session(id).await }
    async fn list_active_sessions(&self) -> BackendResult<Vec<Session>> { self._list_active_sessions().await }
    async fn insert_session(&self, session: &Session) -> BackendResult<()> { self._insert_session(session).await }
    async fn set_session_model(&self, id: &str, model: &str) -> BackendResult<()> { self._set_session_model(id, model).await }
    async fn set_session_state(&self, id: &str, state: &str) -> BackendResult<()> { self._set_session_state(id, state).await }
    async fn set_namespace_pid(&self, id: &str, pid: i64) -> BackendResult<()> { self._set_namespace_pid(id, pid).await }
    async fn touch_last_input(&self, id: &str) -> BackendResult<()> { self._touch_last_input(id).await }
    async fn get_last_token_checkpoint(&self, id: &str) -> BackendResult<i64> { self._get_last_token_checkpoint(id).await }
    async fn update_last_token_checkpoint(&self, id: &str, checkpoint: i64) -> BackendResult<()> { self._update_last_token_checkpoint(id, checkpoint).await }
    // ── Cohorts ──
    async fn get_cohort(&self, id: &str) -> BackendResult<Option<Cohort>> { self._get_cohort(id).await }
    async fn list_cohorts(&self) -> BackendResult<Vec<Cohort>> { self._list_cohorts().await }
    async fn insert_cohort(&self, cohort: &Cohort) -> BackendResult<()> { self._insert_cohort(cohort).await }
    async fn rename_cohort(&self, old_id: &str, new_id: &str, new_title: &str) -> BackendResult<()> { self._rename_cohort(old_id, new_id, new_title).await }
    async fn update_cohort_title(&self, id: &str, new_title: &str) -> BackendResult<()> { self._update_cohort_title(id, new_title).await }
    async fn delete_cohort(&self, id: &str) -> BackendResult<()> { self._delete_cohort(id).await }
    // ── Subjects ──
    async fn get_subject(&self, id: &str) -> BackendResult<Option<Subject>> { self._get_subject(id).await }
    async fn get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> BackendResult<Option<Subject>> { self._get_subject_by_slug(cohort_id, slug).await }
    async fn list_subjects(&self, cohort_id: &str) -> BackendResult<Vec<Subject>> { self._list_subjects(cohort_id).await }
    async fn insert_subject(&self, subject: &Subject) -> BackendResult<()> { self._insert_subject(subject).await }
    async fn update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> BackendResult<()> { self._update_subject(id, new_slug, new_title).await }
    async fn delete_subject(&self, id: &str) -> BackendResult<()> { self._delete_subject(id).await }
    // ── Tokens ──
    async fn record_turn(&self, student_id: &str, session_id: &str, tokens: &TurnTokens) -> BackendResult<()> { self._record_turn(student_id, session_id, tokens).await }
    async fn session_totals(&self, session_id: &str) -> BackendResult<SessionTokenTotals> { self._session_totals(session_id).await }
    async fn student_total_tokens(&self, student_id: &str) -> BackendResult<StudentTokenTotals> { self._student_total_tokens(student_id).await }
    async fn record_deduction(&self, student_id: &str, session_id: &str, model_name: &str, input_multiplier: f64, output_multiplier: f64, input_tokens_used: i64, output_tokens_used: i64, input_tokens_deducted: i64, output_tokens_deducted: i64, tokens_deducted: i64, balance_before: i64, balance_after: i64) -> BackendResult<()> { self._record_deduction(student_id, session_id, model_name, input_multiplier, output_multiplier, input_tokens_used, output_tokens_used, input_tokens_deducted, output_tokens_deducted, tokens_deducted, balance_before, balance_after).await }
    async fn deduction_history(&self, student_id: &str) -> BackendResult<Vec<TokenDeductionRecord>> { self._deduction_history(student_id).await }
    // ── Token Codes ──
    async fn generate_codes(&self, tokens: i64, count: i64) -> BackendResult<Vec<String>> { self._generate_codes(tokens, count).await }
    async fn list_codes(&self, tokens: Option<i64>, used: Option<bool>) -> BackendResult<Vec<TokenCode>> { self._list_codes(tokens, used).await }
    async fn delete_code(&self, id: &str) -> BackendResult<()> { self._delete_code(id).await }
    async fn redeem_code(&self, code: &str, student_id: &str) -> BackendResult<RedeemResult> { self._redeem_code(code, student_id).await }
    async fn export_codes(&self, tokens: i64) -> BackendResult<Vec<TokenCode>> { self._export_codes(tokens).await }
    // ── API ──
    async fn get_me(&self, student_id: &str) -> BackendResult<serde_json::Value> { self._get_me(student_id).await }
    async fn get_session_models(&self, session_id: &str) -> BackendResult<serde_json::Value> { self._get_session_models(session_id).await }
    async fn students_with_active_sessions(&self) -> BackendResult<serde_json::Value> { self._students_with_active_sessions().await }
    async fn create_session_api(&self, params: &serde_json::Value) -> BackendResult<serde_json::Value> { self._create_session_api(params).await }
    async fn set_session_model_api(&self, session_id: &str, model: &str) -> BackendResult<()> { self._set_session_model_api(session_id, model).await }
    async fn update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> BackendResult<serde_json::Value> { self._update_me_api(student_id, updates).await }
}
