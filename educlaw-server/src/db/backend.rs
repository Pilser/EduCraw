// educlaw-server/src/db/backend.rs
//
// Unified backend trait that both SQLite and Helix implementations satisfy.
// API handlers call `state.backend.method()` regardless of the underlying store.

use async_trait::async_trait;
use sqlx::SqlitePool;

// ── Re-export types that API handlers need ─────────────────────────────────

pub use crate::db::cohorts::Cohort;
pub use crate::db::models::Model;
pub use crate::db::sessions::Session;
pub use crate::db::students::Student;
pub use crate::db::subjects::Subject;
pub use crate::db::token_codes::{RedeemResult, TokenCode};
pub use crate::db::token_usage::{SessionTokenTotals, StudentTokenTotals, TokenDeductionRecord, TurnTokens};

// ── Result type ────────────────────────────────────────────────────────────

pub type BackendResult<T> = std::result::Result<T, BackendError>;

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("internal: {0}")]
    Internal(#[from] anyhow::Error),
    #[cfg(feature = "helix")]
    #[error("helix error: {0}")]
    Helix(#[from] educlaw_helix::HelixError),
}

impl From<BackendError> for crate::error::AppError {
    fn from(err: BackendError) -> Self {
        match err {
            BackendError::Db(e) => crate::error::AppError::Db(e),
            BackendError::NotFound(msg) => crate::error::AppError::NotFound(msg),
            BackendError::Internal(e) => crate::error::AppError::Internal(e),
            #[cfg(feature = "helix")]
            BackendError::Helix(e) => crate::error::AppError::from_helix(e),
        }
    }
}

// ── DbBackend trait (always our own, with BackendResult) ───────────────────

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
    async fn record_turn(&self, session_id: &str, tokens: &TurnTokens) -> BackendResult<()>;
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

// ── SqliteBackend ──────────────────────────────────────────────────────────

pub struct SqliteBackend {
    pool: SqlitePool,
}

impl SqliteBackend {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DbBackend for SqliteBackend {
    async fn list_models(&self) -> BackendResult<Vec<Model>> {
        Ok(crate::db::models::list_models(&self.pool).await?)
    }

    async fn list_enabled_models(&self) -> BackendResult<Vec<Model>> {
        Ok(crate::db::models::list_enabled(&self.pool).await?)
    }

    async fn get_model_by_name(&self, name: &str) -> BackendResult<Option<Model>> {
        Ok(crate::db::models::get_model_by_name(&self.pool, name).await?)
    }

    async fn get_model_multipliers(&self, name: &str) -> BackendResult<(f64, f64)> {
        Ok(crate::db::models::get_model_multipliers(&self.pool, name).await?)
    }

    async fn models_for_student(&self, student_id: &str) -> BackendResult<Vec<String>> {
        Ok(crate::db::models::models_for_student(&self.pool, student_id).await?)
    }

    async fn raw_assignments_for_student(&self, student_id: &str) -> BackendResult<Vec<String>> {
        Ok(crate::db::models::raw_assignments_for_student(&self.pool, student_id).await?)
    }

    async fn insert_model(
        &self,
        id: &str,
        name: &str,
        display_name: &str,
        input_multiplier: f64,
        output_multiplier: f64,
    ) -> BackendResult<String> {
        Ok(crate::db::models::insert_model(&self.pool, id, name, display_name, input_multiplier, output_multiplier).await?)
    }

    async fn set_enabled(&self, id: &str, enabled: bool) -> BackendResult<()> {
        Ok(crate::db::models::set_enabled(&self.pool, id, enabled).await?)
    }

    async fn set_multipliers(
        &self,
        name: &str,
        input_multiplier: f64,
        output_multiplier: f64,
    ) -> BackendResult<()> {
        Ok(crate::db::models::set_multipliers(&self.pool, name, input_multiplier, output_multiplier).await?)
    }

    async fn delete_model(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::models::delete_model(&self.pool, id).await?)
    }

    async fn update_model_specs(
        &self,
        id: &str,
        provider: Option<&str>,
        think_mode: Option<i64>,
        visual_support: i64,
    ) -> BackendResult<()> {
        Ok(crate::db::models::update_model_specs(&self.pool, id, provider, think_mode, visual_support).await?)
    }

    async fn update_thinking_params(&self, id: &str, params: Option<&str>) -> BackendResult<()> {
        Ok(crate::db::models::update_thinking_params(&self.pool, id, params).await?)
    }

    async fn set_student_models(&self, student_id: &str, model_names: &[String]) -> BackendResult<()> {
        Ok(crate::db::models::set_student_models(&self.pool, student_id, model_names).await?)
    }

    async fn get_student(&self, id: &str) -> BackendResult<Option<Student>> {
        Ok(crate::db::students::get_student(&self.pool, id).await?)
    }

    async fn get_student_by_username(&self, username: &str) -> BackendResult<Option<Student>> {
        Ok(crate::db::students::get_student_by_username(&self.pool, username).await?)
    }

    async fn list_students(&self) -> BackendResult<Vec<Student>> {
        Ok(crate::db::students::list_students(&self.pool).await?)
    }

    async fn insert_student(&self, student: &Student) -> BackendResult<()> {
        Ok(crate::db::students::insert_student(&self.pool, student).await?)
    }

    async fn touch_last_seen(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::students::touch_last_seen(&self.pool, id).await?)
    }

    async fn update_display_name(&self, id: &str, display_name: &str) -> BackendResult<()> {
        Ok(crate::db::students::update_student(&self.pool, id, Some(display_name), None, None).await?)
    }

    async fn update_cohort(&self, id: &str, cohort_id: &str) -> BackendResult<()> {
        Ok(crate::db::students::update_student(&self.pool, id, None, Some(cohort_id), None).await?)
    }

    async fn update_password(&self, id: &str, password_hash: &str) -> BackendResult<()> {
        Ok(crate::db::students::update_student(&self.pool, id, None, None, Some(password_hash)).await?)
    }

    async fn delete_student(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::students::delete_student(&self.pool, id).await?)
    }

    async fn set_uid_slot(&self, id: &str, slot: Option<i64>) -> BackendResult<()> {
        Ok(crate::db::students::set_uid_slot(&self.pool, id, slot).await?)
    }

    async fn ban_student(&self, id: &str, message: Option<&str>) -> BackendResult<()> {
        Ok(crate::db::students::ban_student(&self.pool, id, message).await?)
    }

    async fn unban_student(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::students::unban_student(&self.pool, id).await?)
    }

    async fn set_last_model(&self, id: &str, model: &str) -> BackendResult<()> {
        Ok(crate::db::students::set_last_model(&self.pool, id, model).await?)
    }

    async fn get_token_balance(&self, id: &str) -> BackendResult<i64> {
        Ok(crate::db::students::get_token_balance(&self.pool, id).await?)
    }

    async fn deduct_tokens(&self, id: &str, amount: i64) -> BackendResult<i64> {
        Ok(crate::db::students::deduct_tokens(&self.pool, id, amount).await?)
    }

    async fn topup_tokens(&self, id: &str, amount: i64) -> BackendResult<i64> {
        Ok(crate::db::students::topup_tokens(&self.pool, id, amount).await?)
    }

    async fn get_session(&self, id: &str) -> BackendResult<Option<Session>> {
        Ok(crate::db::sessions::get_session(&self.pool, id).await?)
    }

    async fn list_active_sessions(&self) -> BackendResult<Vec<Session>> {
        Ok(crate::db::sessions::list_active_sessions(&self.pool).await?)
    }

    async fn insert_session(&self, session: &Session) -> BackendResult<()> {
        Ok(crate::db::sessions::insert_session(&self.pool, session).await?)
    }

    async fn set_session_model(&self, id: &str, model: &str) -> BackendResult<()> {
        Ok(crate::db::sessions::set_session_model(&self.pool, id, model).await?)
    }

    async fn set_session_state(&self, id: &str, state: &str) -> BackendResult<()> {
        Ok(crate::db::sessions::set_session_state(&self.pool, id, state).await?)
    }

    async fn set_namespace_pid(&self, id: &str, pid: i64) -> BackendResult<()> {
        Ok(crate::db::sessions::set_namespace_pid(&self.pool, id, pid).await?)
    }

    async fn touch_last_input(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::sessions::touch_last_input(&self.pool, id).await?)
    }

    async fn get_last_token_checkpoint(&self, id: &str) -> BackendResult<i64> {
        Ok(crate::db::sessions::get_last_token_checkpoint(&self.pool, id).await?)
    }

    async fn update_last_token_checkpoint(&self, id: &str, checkpoint: i64) -> BackendResult<()> {
        Ok(crate::db::sessions::update_last_token_checkpoint(&self.pool, id, checkpoint).await?)
    }

    async fn get_cohort(&self, id: &str) -> BackendResult<Option<Cohort>> {
        Ok(crate::db::cohorts::get_cohort(&self.pool, id).await?)
    }

    async fn list_cohorts(&self) -> BackendResult<Vec<Cohort>> {
        Ok(crate::db::cohorts::list_cohorts(&self.pool).await?)
    }

    async fn insert_cohort(&self, cohort: &Cohort) -> BackendResult<()> {
        Ok(crate::db::cohorts::insert_cohort(&self.pool, cohort).await?)
    }

    async fn rename_cohort(&self, old_id: &str, new_id: &str, new_title: &str) -> BackendResult<()> {
        Ok(crate::db::cohorts::rename_cohort(&self.pool, old_id, new_id, new_title).await?)
    }

    async fn update_cohort_title(&self, id: &str, new_title: &str) -> BackendResult<()> {
        Ok(crate::db::cohorts::update_cohort_title(&self.pool, id, new_title).await?)
    }

    async fn delete_cohort(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::cohorts::delete_cohort(&self.pool, id).await?)
    }

    async fn get_subject(&self, id: &str) -> BackendResult<Option<Subject>> {
        Ok(crate::db::subjects::get_subject(&self.pool, id).await?)
    }

    async fn get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> BackendResult<Option<Subject>> {
        Ok(crate::db::subjects::get_subject_by_slug(&self.pool, cohort_id, slug).await?)
    }

    async fn list_subjects(&self, cohort_id: &str) -> BackendResult<Vec<Subject>> {
        Ok(crate::db::subjects::list_subjects(&self.pool, cohort_id).await?)
    }

    async fn insert_subject(&self, subject: &Subject) -> BackendResult<()> {
        Ok(crate::db::subjects::insert_subject(&self.pool, subject).await?)
    }

    async fn update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> BackendResult<()> {
        Ok(crate::db::subjects::update_subject(&self.pool, id, new_slug, new_title).await?)
    }

    async fn delete_subject(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::subjects::delete_subject(&self.pool, id).await?)
    }

    async fn record_turn(&self, session_id: &str, tokens: &TurnTokens) -> BackendResult<()> {
        Ok(crate::db::token_usage::record_turn(&self.pool, session_id, tokens).await?)
    }

    async fn session_totals(&self, session_id: &str) -> BackendResult<SessionTokenTotals> {
        Ok(crate::db::token_usage::session_totals(&self.pool, session_id).await?)
    }

    async fn student_total_tokens(&self, student_id: &str) -> BackendResult<StudentTokenTotals> {
        Ok(crate::db::token_usage::student_total_tokens(&self.pool, student_id).await?)
    }

    async fn record_deduction(
        &self,
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
    ) -> BackendResult<()> {
        Ok(crate::db::token_usage::record_deduction(
            &self.pool, student_id, session_id, model_name,
            input_multiplier, output_multiplier,
            input_tokens_used, output_tokens_used,
            input_tokens_deducted, output_tokens_deducted,
            tokens_deducted, balance_before, balance_after,
        ).await?)
    }

    async fn generate_codes(&self, tokens: i64, count: i64) -> BackendResult<Vec<String>> {
        Ok(crate::db::token_codes::generate_codes(&self.pool, tokens, count).await?)
    }

    async fn list_codes(
        &self,
        tokens: Option<i64>,
        used: Option<bool>,
    ) -> BackendResult<Vec<TokenCode>> {
        Ok(crate::db::token_codes::list_codes(&self.pool, tokens, used).await?)
    }

    async fn delete_code(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::token_codes::delete_code(&self.pool, id).await?)
    }

    async fn redeem_code(&self, code: &str, student_id: &str) -> BackendResult<RedeemResult> {
        let result = crate::db::token_codes::redeem_code(&self.pool, code, student_id).await?;
        match result {
            crate::db::token_codes::RedeemResult::Success { tokens, new_balance } => {
                Ok(RedeemResult::Success { tokens, new_balance })
            }
            crate::db::token_codes::RedeemResult::NotFound => Ok(RedeemResult::NotFound),
            crate::db::token_codes::RedeemResult::AlreadyUsed => Ok(RedeemResult::AlreadyUsed),
        }
    }

    async fn export_codes(&self, tokens: i64) -> BackendResult<Vec<TokenCode>> {
        Ok(crate::db::token_codes::export_codes(&self.pool, tokens).await?)
    }

    async fn get_me(&self, student_id: &str) -> BackendResult<serde_json::Value> {
        let student = crate::db::students::get_student(&self.pool, student_id).await?
            .ok_or_else(|| BackendError::NotFound(format!("student {student_id}")))?;
        let cohort_title = if student.cohort_id.is_empty() {
            None
        } else {
            crate::db::cohorts::get_cohort(&self.pool, &student.cohort_id).await?.map(|c| c.title)
        };
        let available_cohorts = crate::db::cohorts::list_cohorts(&self.pool).await?;
        let subjects = if student.cohort_id.is_empty() {
            vec![]
        } else {
            crate::db::subjects::list_subjects(&self.pool, &student.cohort_id).await?
        };
        Ok(serde_json::json!({
            "student": student,
            "cohort_title": cohort_title,
            "available_cohorts": available_cohorts,
            "subjects": subjects,
        }))
    }

    async fn get_session_models(&self, session_id: &str) -> BackendResult<serde_json::Value> {
        let session = crate::db::sessions::get_session(&self.pool, session_id).await?
            .ok_or_else(|| BackendError::NotFound(format!("session {session_id}")))?;
        let models = crate::db::models::full_models_for_student(&self.pool, &session.student_id).await?;
        let student_last_model = crate::db::students::get_student(&self.pool, &session.student_id).await?
            .and_then(|s| s.last_model);
        let active = student_last_model
            .or(session.model)
            .unwrap_or_else(|| "grok-4-1-fast-reasoning".to_string());
        Ok(serde_json::json!({
            "models": models,
            "active": active,
        }))
    }

    async fn students_with_active_sessions(&self) -> BackendResult<serde_json::Value> {
        let sessions = crate::db::sessions::list_active_sessions(&self.pool).await?;
        let mut students = Vec::new();
        for s in &sessions {
            if let Some(student) = crate::db::students::get_student(&self.pool, &s.student_id).await? {
                students.push(serde_json::json!({
                    "id": student.id,
                    "username": student.username,
                    "display_name": student.display_name,
                    "session_id": s.id,
                }));
            }
        }
        Ok(serde_json::json!({ "students": students }))
    }

    async fn deduction_history(&self, student_id: &str) -> BackendResult<Vec<crate::db::token_usage::TokenDeductionRecord>> {
        use sqlx::Row;
        let rows = sqlx::query(
            "SELECT id, session_id, model_name,
                    input_multiplier, output_multiplier,
                    input_tokens_used, output_tokens_used,
                    input_tokens_deducted, output_tokens_deducted,
                    tokens_used, tokens_deducted,
                    balance_before, balance_after, recorded_at
             FROM token_deductions
             WHERE student_id = ?
             ORDER BY recorded_at DESC
             LIMIT 100",
        )
        .bind(student_id)
        .fetch_all(&self.pool)
        .await?;

        let records: Vec<crate::db::token_usage::TokenDeductionRecord> = rows
            .into_iter()
            .map(|row| crate::db::token_usage::TokenDeductionRecord {
                id: row.get("id"),
                student_id: student_id.to_string(),
                session_id: row.get("session_id"),
                model_name: row.get("model_name"),
                input_multiplier: row.get("input_multiplier"),
                output_multiplier: row.get("output_multiplier"),
                input_tokens_used: row.get("input_tokens_used"),
                output_tokens_used: row.get("output_tokens_used"),
                input_tokens_deducted: row.get("input_tokens_deducted"),
                output_tokens_deducted: row.get("output_tokens_deducted"),
                tokens_used: row.get("tokens_used"),
                tokens_deducted: row.get("tokens_deducted"),
                balance_before: row.get("balance_before"),
                balance_after: row.get("balance_after"),
                recorded_at: row.get("recorded_at"),
            })
            .collect();
        Ok(records)
    }

    async fn create_session_api(&self, _params: &serde_json::Value) -> BackendResult<serde_json::Value> {
        Err(BackendError::Internal(anyhow::anyhow!("create_session_api not implemented for SQLite backend — use the full session creation flow")))
    }

    async fn set_session_model_api(&self, session_id: &str, model: &str) -> BackendResult<()> {
        Ok(crate::db::sessions::set_session_model(&self.pool, session_id, model).await?)
    }

    async fn update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> BackendResult<serde_json::Value> {
        let display_name = updates.get("display_name").and_then(|v| v.as_str());
        let cohort_id = updates.get("cohort_id").and_then(|v| v.as_str());
        let password_hash = updates.get("password_hash").and_then(|v| v.as_str());
        crate::db::students::update_student(&self.pool, student_id, display_name, cohort_id, password_hash).await?;
        let updated = crate::db::students::get_student(&self.pool, student_id).await?
            .ok_or_else(|| BackendError::NotFound(format!("student {student_id}")))?;
        let subject_ids: Vec<String> = if updated.cohort_id.is_empty() {
            vec![]
        } else {
            crate::db::subjects::list_subjects(&self.pool, &updated.cohort_id).await?
                .into_iter()
                .map(|s| s.slug)
                .collect()
        };
        Ok(serde_json::json!({
            "student": updated,
            "subject_ids": subject_ids,
        }))
    }
}

// ── HelixBackend wrapper ──────────────────────────────────────────────────
// Wraps educlaw_helix::HelixClient to implement our DbBackend trait.
// The helix crate's DbBackend returns educlaw_helix::Result<T>,
// we convert to BackendResult<T>.

#[cfg(feature = "helix")]
use educlaw_helix::DbBackend as HelixDb;

#[cfg(feature = "helix")]
pub struct HelixBackend {
    client: educlaw_helix::HelixClient,
}

#[cfg(feature = "helix")]
impl HelixBackend {
    pub fn new(client: educlaw_helix::HelixClient) -> Self {
        Self { client }
    }
}

#[cfg(feature = "helix")]
#[async_trait]
impl DbBackend for HelixBackend {
    async fn list_models(&self) -> BackendResult<Vec<Model>> {
        let models = HelixDb::list_models(&self.client).await?;
        Ok(models.into_iter().map(helix_model_to_local).collect())
    }

    async fn list_enabled_models(&self) -> BackendResult<Vec<Model>> {
        let models = HelixDb::list_enabled_models(&self.client).await?;
        Ok(models.into_iter().map(helix_model_to_local).collect())
    }

    async fn get_model_by_name(&self, name: &str) -> BackendResult<Option<Model>> {
        Ok(HelixDb::get_model_by_name(&self.client, name).await?.map(helix_model_to_local))
    }

    async fn get_model_multipliers(&self, name: &str) -> BackendResult<(f64, f64)> {
        Ok(HelixDb::get_model_multipliers(&self.client, name).await?)
    }

    async fn models_for_student(&self, student_id: &str) -> BackendResult<Vec<String>> {
        Ok(HelixDb::models_for_student(&self.client, student_id).await?)
    }

    async fn raw_assignments_for_student(&self, student_id: &str) -> BackendResult<Vec<String>> {
        Ok(HelixDb::raw_assignments_for_student(&self.client, student_id).await?)
    }

    async fn insert_model(&self, id: &str, name: &str, display_name: &str, input_multiplier: f64, output_multiplier: f64) -> BackendResult<String> {
        Ok(HelixDb::insert_model(&self.client, id, name, display_name, input_multiplier, output_multiplier).await?)
    }

    async fn set_enabled(&self, id: &str, enabled: bool) -> BackendResult<()> {
        Ok(HelixDb::set_enabled(&self.client, id, enabled).await?)
    }

    async fn set_multipliers(&self, name: &str, input_multiplier: f64, output_multiplier: f64) -> BackendResult<()> {
        Ok(HelixDb::set_multipliers(&self.client, name, input_multiplier, output_multiplier).await?)
    }

    async fn delete_model(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_model(&self.client, id).await?)
    }

    async fn update_model_specs(&self, id: &str, provider: Option<&str>, think_mode: Option<i64>, visual_support: i64) -> BackendResult<()> {
        Ok(HelixDb::update_model_specs(&self.client, id, provider, think_mode, visual_support).await?)
    }

    async fn update_thinking_params(&self, id: &str, params: Option<&str>) -> BackendResult<()> {
        Ok(HelixDb::update_thinking_params(&self.client, id, params).await?)
    }

    async fn set_student_models(&self, student_id: &str, model_names: &[String]) -> BackendResult<()> {
        Ok(HelixDb::set_student_models(&self.client, student_id, model_names).await?)
    }

    async fn get_student(&self, id: &str) -> BackendResult<Option<Student>> {
        Ok(HelixDb::get_student(&self.client, id).await?.map(helix_student_to_local))
    }

    async fn get_student_by_username(&self, username: &str) -> BackendResult<Option<Student>> {
        Ok(HelixDb::get_student_by_username(&self.client, username).await?.map(helix_student_to_local))
    }

    async fn list_students(&self) -> BackendResult<Vec<Student>> {
        let students = HelixDb::list_students(&self.client).await?;
        Ok(students.into_iter().map(helix_student_to_local).collect())
    }

    async fn insert_student(&self, student: &Student) -> BackendResult<()> {
        let h = local_student_to_helix(student);
        Ok(HelixDb::insert_student(&self.client, &h).await?)
    }

    async fn touch_last_seen(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::touch_last_seen(&self.client, id).await?)
    }

    async fn update_display_name(&self, id: &str, display_name: &str) -> BackendResult<()> {
        Ok(HelixDb::update_display_name(&self.client, id, display_name).await?)
    }

    async fn update_cohort(&self, id: &str, cohort_id: &str) -> BackendResult<()> {
        Ok(HelixDb::update_cohort(&self.client, id, cohort_id).await?)
    }

    async fn update_password(&self, id: &str, password_hash: &str) -> BackendResult<()> {
        Ok(HelixDb::update_password(&self.client, id, password_hash).await?)
    }

    async fn delete_student(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_student(&self.client, id).await?)
    }

    async fn set_uid_slot(&self, id: &str, slot: Option<i64>) -> BackendResult<()> {
        Ok(HelixDb::set_uid_slot(&self.client, id, slot).await?)
    }

    async fn ban_student(&self, id: &str, message: Option<&str>) -> BackendResult<()> {
        Ok(HelixDb::ban_student(&self.client, id, message).await?)
    }

    async fn unban_student(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::unban_student(&self.client, id).await?)
    }

    async fn set_last_model(&self, id: &str, model: &str) -> BackendResult<()> {
        Ok(HelixDb::set_last_model(&self.client, id, model).await?)
    }

    async fn get_token_balance(&self, id: &str) -> BackendResult<i64> {
        Ok(HelixDb::get_token_balance(&self.client, id).await?)
    }

    async fn deduct_tokens(&self, id: &str, amount: i64) -> BackendResult<i64> {
        Ok(HelixDb::deduct_tokens(&self.client, id, amount).await?)
    }

    async fn topup_tokens(&self, id: &str, amount: i64) -> BackendResult<i64> {
        Ok(HelixDb::topup_tokens(&self.client, id, amount).await?)
    }

    async fn get_session(&self, id: &str) -> BackendResult<Option<Session>> {
        Ok(HelixDb::get_session(&self.client, id).await?.map(helix_session_to_local))
    }

    async fn list_active_sessions(&self) -> BackendResult<Vec<Session>> {
        let sessions = HelixDb::list_active_sessions(&self.client).await?;
        Ok(sessions.into_iter().map(helix_session_to_local).collect())
    }

    async fn insert_session(&self, session: &Session) -> BackendResult<()> {
        let h = local_session_to_helix(session);
        Ok(HelixDb::insert_session(&self.client, &h).await?)
    }

    async fn set_session_model(&self, id: &str, model: &str) -> BackendResult<()> {
        Ok(HelixDb::set_session_model(&self.client, id, model).await?)
    }

    async fn set_session_state(&self, id: &str, state: &str) -> BackendResult<()> {
        Ok(HelixDb::set_session_state(&self.client, id, state).await?)
    }

    async fn set_namespace_pid(&self, id: &str, pid: i64) -> BackendResult<()> {
        Ok(HelixDb::set_namespace_pid(&self.client, id, pid).await?)
    }

    async fn touch_last_input(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::touch_last_input(&self.client, id).await?)
    }

    async fn get_last_token_checkpoint(&self, id: &str) -> BackendResult<i64> {
        Ok(HelixDb::get_last_token_checkpoint(&self.client, id).await?)
    }

    async fn update_last_token_checkpoint(&self, id: &str, checkpoint: i64) -> BackendResult<()> {
        Ok(HelixDb::update_last_token_checkpoint(&self.client, id, checkpoint).await?)
    }

    async fn get_cohort(&self, id: &str) -> BackendResult<Option<Cohort>> {
        Ok(HelixDb::get_cohort(&self.client, id).await?.map(helix_cohort_to_local))
    }

    async fn list_cohorts(&self) -> BackendResult<Vec<Cohort>> {
        let cohorts = HelixDb::list_cohorts(&self.client).await?;
        Ok(cohorts.into_iter().map(helix_cohort_to_local).collect())
    }

    async fn insert_cohort(&self, cohort: &Cohort) -> BackendResult<()> {
        let h = local_cohort_to_helix(cohort);
        Ok(HelixDb::insert_cohort(&self.client, &h).await?)
    }

    async fn rename_cohort(&self, old_id: &str, new_id: &str, new_title: &str) -> BackendResult<()> {
        Ok(HelixDb::rename_cohort(&self.client, old_id, new_id, new_title).await?)
    }

    async fn update_cohort_title(&self, id: &str, new_title: &str) -> BackendResult<()> {
        Ok(HelixDb::update_cohort_title(&self.client, id, new_title).await?)
    }

    async fn delete_cohort(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_cohort(&self.client, id).await?)
    }

    async fn get_subject(&self, id: &str) -> BackendResult<Option<Subject>> {
        Ok(HelixDb::get_subject(&self.client, id).await?.map(helix_subject_to_local))
    }

    async fn get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> BackendResult<Option<Subject>> {
        Ok(HelixDb::get_subject_by_slug(&self.client, cohort_id, slug).await?.map(helix_subject_to_local))
    }

    async fn list_subjects(&self, cohort_id: &str) -> BackendResult<Vec<Subject>> {
        let subjects = HelixDb::list_subjects(&self.client, cohort_id).await?;
        Ok(subjects.into_iter().map(helix_subject_to_local).collect())
    }

    async fn insert_subject(&self, subject: &Subject) -> BackendResult<()> {
        let h = local_subject_to_helix(subject);
        Ok(HelixDb::insert_subject(&self.client, &h).await?)
    }

    async fn update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> BackendResult<()> {
        Ok(HelixDb::update_subject(&self.client, id, new_slug, new_title).await?)
    }

    async fn delete_subject(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_subject(&self.client, id).await?)
    }

    async fn record_turn(&self, session_id: &str, tokens: &TurnTokens) -> BackendResult<()> {
        let h = educlaw_helix::TurnTokens {
            model: tokens.model.clone(),
            input_tokens: tokens.input_tokens,
            output_tokens: tokens.output_tokens,
            cache_creation_input_tokens: tokens.cache_creation_input_tokens,
            cache_read_input_tokens: tokens.cache_read_input_tokens,
        };
        Ok(HelixDb::record_turn(&self.client, session_id, &h).await?)
    }

    async fn session_totals(&self, session_id: &str) -> BackendResult<SessionTokenTotals> {
        let t = HelixDb::session_totals(&self.client, session_id).await?;
        Ok(SessionTokenTotals {
            total_input_tokens: t.total_input_tokens,
            total_output_tokens: t.total_output_tokens,
            total_cache_creation_tokens: t.total_cache_creation_tokens,
            total_cache_read_tokens: t.total_cache_read_tokens,
            turn_count: t.turn_count,
        })
    }

    async fn student_total_tokens(&self, student_id: &str) -> BackendResult<StudentTokenTotals> {
        let t = HelixDb::student_total_tokens(&self.client, student_id).await?;
        Ok(StudentTokenTotals {
            total_input_tokens: t.total_input_tokens,
            total_output_tokens: t.total_output_tokens,
            total_cache_creation_tokens: t.total_cache_creation_tokens,
            total_cache_read_tokens: t.total_cache_read_tokens,
            turn_count: t.turn_count,
        })
    }

    async fn record_deduction(&self, student_id: &str, session_id: &str, model_name: &str, input_multiplier: f64, output_multiplier: f64, input_tokens_used: i64, output_tokens_used: i64, input_tokens_deducted: i64, output_tokens_deducted: i64, tokens_deducted: i64, balance_before: i64, balance_after: i64) -> BackendResult<()> {
        Ok(HelixDb::record_deduction(&self.client, student_id, session_id, model_name, input_multiplier, output_multiplier, input_tokens_used, output_tokens_used, input_tokens_deducted, output_tokens_deducted, tokens_deducted, balance_before, balance_after).await?)
    }

    async fn generate_codes(&self, tokens: i64, count: i64) -> BackendResult<Vec<String>> {
        Ok(HelixDb::generate_codes(&self.client, tokens, count).await?)
    }

    async fn list_codes(&self, tokens: Option<i64>, used: Option<bool>) -> BackendResult<Vec<TokenCode>> {
        let codes = HelixDb::list_codes(&self.client, tokens, used).await?;
        Ok(codes.into_iter().map(helix_token_code_to_local).collect())
    }

    async fn delete_code(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_code(&self.client, id).await?)
    }

    async fn redeem_code(&self, code: &str, student_id: &str) -> BackendResult<RedeemResult> {
        let r = HelixDb::redeem_code(&self.client, code, student_id).await?;
        match r {
            educlaw_helix::RedeemResult::Success { tokens, new_balance } => Ok(RedeemResult::Success { tokens, new_balance }),
            educlaw_helix::RedeemResult::NotFound => Ok(RedeemResult::NotFound),
            educlaw_helix::RedeemResult::AlreadyUsed => Ok(RedeemResult::AlreadyUsed),
        }
    }

    async fn export_codes(&self, tokens: i64) -> BackendResult<Vec<TokenCode>> {
        let codes = HelixDb::export_codes(&self.client, tokens).await?;
        Ok(codes.into_iter().map(helix_token_code_to_local).collect())
    }

    async fn get_me(&self, student_id: &str) -> BackendResult<serde_json::Value> {
        Ok(HelixDb::get_me(&self.client, student_id).await?)
    }

    async fn get_session_models(&self, session_id: &str) -> BackendResult<serde_json::Value> {
        Ok(HelixDb::get_session_models(&self.client, session_id).await?)
    }

    async fn students_with_active_sessions(&self) -> BackendResult<serde_json::Value> {
        Ok(HelixDb::students_with_active_sessions(&self.client).await?)
    }

    async fn deduction_history(&self, student_id: &str) -> BackendResult<Vec<TokenDeductionRecord>> {
        let deductions = HelixDb::deduction_history(&self.client, student_id).await?;
        Ok(deductions.into_iter().map(helix_deduction_to_local).collect())
    }

    async fn create_session_api(&self, params: &serde_json::Value) -> BackendResult<serde_json::Value> {
        Ok(HelixDb::create_session_api(&self.client, params).await?)
    }

    async fn set_session_model_api(&self, session_id: &str, model: &str) -> BackendResult<()> {
        Ok(HelixDb::set_session_model_api(&self.client, session_id, model).await?)
    }

    async fn update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> BackendResult<serde_json::Value> {
        Ok(HelixDb::update_me_api(&self.client, student_id, updates).await?)
    }
}

#[cfg(feature = "helix")]
fn helix_model_to_local(h: educlaw_helix::Model) -> Model {
    Model {
        id: h.id, name: h.name, display_name: h.display_name, enabled: h.enabled,
        input_multiplier: h.input_multiplier, output_multiplier: h.output_multiplier,
        provider: h.provider, think_mode: h.think_mode, visual_support: h.visual_support,
        thinking_params: h.thinking_params, created_at: h.created_at,
    }
}

#[cfg(feature = "helix")]
fn helix_student_to_local(h: educlaw_helix::Student) -> Student {
    Student {
        id: h.id, username: h.username, password_hash: h.password_hash,
        display_name: h.display_name, role: h.role, cohort_id: h.cohort_id,
        home_dir: h.home_dir, uid_slot: h.uid_slot, token_limit: h.token_limit,
        token_balance: h.token_balance, restriction_status: h.restriction_status,
        restriction_message: h.restriction_message, last_model: h.last_model,
        created_at: h.created_at, last_seen: h.last_seen,
    }
}

#[cfg(feature = "helix")]
fn local_student_to_helix(l: &Student) -> educlaw_helix::Student {
    educlaw_helix::Student {
        id: l.id.clone(), username: l.username.clone(), password_hash: l.password_hash.clone(),
        display_name: l.display_name.clone(), role: l.role.clone(), cohort_id: l.cohort_id.clone(),
        home_dir: l.home_dir.clone(), uid_slot: l.uid_slot, token_limit: l.token_limit,
        token_balance: l.token_balance, restriction_status: l.restriction_status.clone(),
        restriction_message: l.restriction_message.clone(), last_model: l.last_model.clone(),
        created_at: l.created_at.clone(), last_seen: l.last_seen.clone(),
    }
}

#[cfg(feature = "helix")]
fn helix_session_to_local(h: educlaw_helix::Session) -> Session {
    Session {
        id: h.id, student_id: h.student_id, state: h.state,
        namespace_pid: h.namespace_pid, overlay_mount: h.overlay_mount,
        model: h.model, last_input_at: h.last_input_at,
        last_token_checkpoint: h.last_token_checkpoint,
        started_at: h.started_at, ended_at: h.ended_at,
    }
}

#[cfg(feature = "helix")]
fn local_session_to_helix(l: &Session) -> educlaw_helix::Session {
    educlaw_helix::Session {
        id: l.id.clone(), student_id: l.student_id.clone(), state: l.state.clone(),
        namespace_pid: l.namespace_pid, overlay_mount: l.overlay_mount.clone(),
        model: l.model.clone(), last_input_at: l.last_input_at.clone(),
        last_token_checkpoint: l.last_token_checkpoint,
        started_at: l.started_at.clone(), ended_at: l.ended_at.clone(),
    }
}

#[cfg(feature = "helix")]
fn helix_cohort_to_local(h: educlaw_helix::Cohort) -> Cohort {
    Cohort { id: h.id, title: h.title, created_at: h.created_at }
}

#[cfg(feature = "helix")]
fn local_cohort_to_helix(l: &Cohort) -> educlaw_helix::Cohort {
    educlaw_helix::Cohort { id: l.id.clone(), title: l.title.clone(), created_at: l.created_at.clone() }
}

#[cfg(feature = "helix")]
fn helix_subject_to_local(h: educlaw_helix::Subject) -> Subject {
    Subject { id: h.id, cohort_id: h.cohort_id, slug: h.slug, title: h.title, created_at: h.created_at }
}

#[cfg(feature = "helix")]
fn local_subject_to_helix(l: &Subject) -> educlaw_helix::Subject {
    educlaw_helix::Subject { id: l.id.clone(), cohort_id: l.cohort_id.clone(), slug: l.slug.clone(), title: l.title.clone(), created_at: l.created_at.clone() }
}

#[cfg(feature = "helix")]
fn helix_token_code_to_local(h: educlaw_helix::TokenCode) -> TokenCode {
    TokenCode { id: h.id, code: h.code, tokens: h.tokens, used_by: h.used_by, used_at: h.used_at, created_at: h.created_at }
}

#[cfg(feature = "helix")]
fn helix_deduction_to_local(h: educlaw_helix::TokenDeduction) -> TokenDeductionRecord {
    TokenDeductionRecord {
        id: h.id, student_id: h.student_id, session_id: h.session_id,
        model_name: h.model_name, input_multiplier: h.input_multiplier,
        output_multiplier: h.output_multiplier, input_tokens_used: h.input_tokens_used,
        output_tokens_used: h.output_tokens_used, input_tokens_deducted: h.input_tokens_deducted,
        output_tokens_deducted: h.output_tokens_deducted, tokens_used: h.tokens_used,
        tokens_deducted: h.tokens_deducted, balance_before: h.balance_before,
        balance_after: h.balance_after, recorded_at: h.recorded_at,
    }
}
