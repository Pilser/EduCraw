use async_trait::async_trait;

use crate::client::{HelixClient, QueryParams};
use crate::error::{HelixError, Result};
use crate::types::*;

fn extract_array<T: serde::de::DeserializeOwned>(
    body: &serde_json::Value,
    key: &str,
) -> Result<Vec<T>> {
    // HelixDB returns {"key": {"properties": [...]}} for reads
    // or {"key": [...]} for some queries
    let arr = body
        .get(key)
        .and_then(|v| {
            if let Some(obj) = v.as_object() {
                // Try "properties" first (read queries)
                obj.get("properties").and_then(|p| p.as_array())
                    // Fall back to "ids" (write queries)
                    .or_else(|| obj.get("ids").and_then(|p| p.as_array()))
                    // Fall back to direct array
                    .or_else(|| v.as_array())
            } else {
                v.as_array()
            }
        });
    let arr = match arr {
        Some(a) => a,
        None => {
            tracing::error!(
                key = key,
                response_keys = ?body.as_object().map(|o| o.keys().collect::<Vec<_>>()),
                full_response = %body,
                "extract_array: key not found in HelixDB response"
            );
            return Err(HelixError::ParseError(format!("missing '{}' array in response", key)));
        }
    };
    Ok(arr
        .iter()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect())
}

fn extract_optional<T: serde::de::DeserializeOwned>(
    body: &serde_json::Value,
    key: &str,
) -> Result<Option<T>> {
    // HelixDB returns {"key": {"properties": [...]}} for reads
    let arr = body
        .get(key)
        .and_then(|v| {
            if let Some(obj) = v.as_object() {
                obj.get("properties").and_then(|p| p.as_array())
                    .or_else(|| v.as_array())
            } else {
                v.as_array()
            }
        });
    let arr = match arr {
        Some(a) => a,
        None => {
            return Err(HelixError::ParseError(format!("missing '{}' array in response", key)));
        }
    };
    if arr.is_empty() {
        Ok(None)
    } else {
        Ok(serde_json::from_value(arr[0].clone()).ok())
    }
}

fn extract_i64(body: &serde_json::Value, key: &str) -> Result<i64> {
    body.get(key)
        .and_then(|v| v.as_i64())
        .ok_or_else(|| HelixError::ParseError(format!("missing '{}' i64 in response", key)))
}

fn extract_f64(body: &serde_json::Value, key: &str) -> Result<f64> {
    body.get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| HelixError::ParseError(format!("missing '{}' f64 in response", key)))
}

#[async_trait]
pub trait DbBackend: Send + Sync {
    // Models
    async fn list_models(&self) -> Result<Vec<Model>>;
    async fn list_enabled_models(&self) -> Result<Vec<Model>>;
    async fn get_model_by_name(&self, name: &str) -> Result<Option<Model>>;
    async fn get_model_multipliers(&self, name: &str) -> Result<(f64, f64)>;
    async fn models_for_student(&self, student_id: &str) -> Result<Vec<String>>;
    async fn raw_assignments_for_student(&self, student_id: &str) -> Result<Vec<String>>;
    async fn insert_model(
        &self,
        name: &str,
        display_name: &str,
        input_multiplier: f64,
        output_multiplier: f64,
    ) -> Result<String>;
    async fn set_enabled(&self, id: &str, enabled: bool) -> Result<()>;
    async fn set_multipliers(
        &self,
        name: &str,
        input_multiplier: f64,
        output_multiplier: f64,
    ) -> Result<()>;
    async fn delete_model(&self, id: &str) -> Result<()>;
    async fn update_model_specs(
        &self,
        id: &str,
        provider: Option<&str>,
        think_mode: Option<i64>,
        visual_support: i64,
    ) -> Result<()>;
    async fn update_thinking_params(&self, id: &str, params: Option<&str>) -> Result<()>;
    async fn set_student_models(&self, student_id: &str, model_names: &[String]) -> Result<()>;

    // Students
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
    async fn get_token_balance(&self, id: &str) -> Result<i64>;
    async fn deduct_tokens(&self, id: &str, amount: i64) -> Result<i64>;
    async fn topup_tokens(&self, id: &str, amount: i64) -> Result<i64>;

    // Sessions
    async fn get_session(&self, id: &str) -> Result<Option<Session>>;
    async fn list_active_sessions(&self) -> Result<Vec<Session>>;
    async fn insert_session(&self, session: &Session) -> Result<()>;
    async fn set_session_model(&self, id: &str, model: &str) -> Result<()>;
    async fn set_session_state(&self, id: &str, state: &str) -> Result<()>;
    async fn set_namespace_pid(&self, id: &str, pid: i64) -> Result<()>;
    async fn touch_last_input(&self, id: &str) -> Result<()>;
    async fn get_last_token_checkpoint(&self, id: &str) -> Result<i64>;
    async fn update_last_token_checkpoint(&self, id: &str, checkpoint: i64) -> Result<()>;

    // Cohorts
    async fn get_cohort(&self, id: &str) -> Result<Option<Cohort>>;
    async fn list_cohorts(&self) -> Result<Vec<Cohort>>;
    async fn insert_cohort(&self, cohort: &Cohort) -> Result<()>;
    async fn rename_cohort(&self, old_id: &str, new_id: &str, new_title: &str) -> Result<()>;
    async fn update_cohort_title(&self, id: &str, new_title: &str) -> Result<()>;
    async fn delete_cohort(&self, id: &str) -> Result<()>;

    // Subjects
    async fn get_subject(&self, id: &str) -> Result<Option<Subject>>;
    async fn get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> Result<Option<Subject>>;
    async fn list_subjects(&self, cohort_id: &str) -> Result<Vec<Subject>>;
    async fn insert_subject(&self, subject: &Subject) -> Result<()>;
    async fn update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> Result<()>;
    async fn delete_subject(&self, id: &str) -> Result<()>;

    // Token usage
    async fn record_turn(&self, session_id: &str, tokens: &TurnTokens) -> Result<()>;
    async fn session_totals(&self, session_id: &str) -> Result<SessionTotals>;
    async fn student_total_tokens(&self, student_id: &str) -> Result<StudentTotals>;
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
    ) -> Result<()>;

    // Token codes
    async fn generate_codes(&self, tokens: i64, count: i64) -> Result<Vec<String>>;
    async fn list_codes(
        &self,
        tokens: Option<i64>,
        used: Option<bool>,
    ) -> Result<Vec<TokenCode>>;
    async fn delete_code(&self, id: &str) -> Result<()>;
    async fn redeem_code(&self, code: &str, student_id: &str) -> Result<RedeemResult>;
    async fn export_codes(&self, tokens: i64) -> Result<Vec<TokenCode>>;

    // API consolidated
    async fn get_me(&self, student_id: &str) -> Result<serde_json::Value>;
    async fn get_session_models(&self, session_id: &str) -> Result<serde_json::Value>;
    async fn students_with_active_sessions(&self) -> Result<serde_json::Value>;
    async fn deduction_history(&self, student_id: &str) -> Result<Vec<TokenDeduction>>;
    async fn create_session_api(&self, params: &serde_json::Value) -> Result<serde_json::Value>;
    async fn set_session_model_api(&self, session_id: &str, model: &str) -> Result<()>;
    async fn update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> Result<serde_json::Value>;
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TurnTokens {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
}

#[async_trait]
impl DbBackend for HelixClient {
    async fn list_models(&self) -> Result<Vec<Model>> {
        let resp = self.read("list_models", QueryParams::new()).await?;
        extract_array(&resp, "models")
    }

    async fn list_enabled_models(&self) -> Result<Vec<Model>> {
        let resp = self.read("list_enabled", QueryParams::new()).await?;
        extract_array(&resp, "models")
    }

    async fn get_model_by_name(&self, name: &str) -> Result<Option<Model>> {
        let resp = self
            .read("get_model_by_name", QueryParams::new().add("name", name))
            .await?;
        extract_optional(&resp, "model")
    }

    async fn get_model_multipliers(&self, name: &str) -> Result<(f64, f64)> {
        let resp = self
            .read("get_model_multipliers", QueryParams::new().add("name", name))
            .await?;
        let input = extract_f64(&resp, "input_multiplier")?;
        let output = extract_f64(&resp, "output_multiplier")?;
        Ok((input, output))
    }

    async fn models_for_student(&self, _student_id: &str) -> Result<Vec<String>> {
        let resp = self.read("models_for_student", QueryParams::new()).await?;
        extract_array(&resp, "models")
    }

    async fn raw_assignments_for_student(&self, student_id: &str) -> Result<Vec<String>> {
        let resp = self
            .read(
                "raw_assignments_for_student",
                QueryParams::new().add("student_id", student_id),
            )
            .await?;
        extract_array(&resp, "models")
    }

    async fn insert_model(
        &self,
        name: &str,
        display_name: &str,
        input_multiplier: f64,
        output_multiplier: f64,
    ) -> Result<String> {
        let resp = self
            .write(
                "insert_model",
                QueryParams::new()
                    .add("name", name)
                    .add("display_name", display_name)
                    .add("input_multiplier", input_multiplier)
                    .add("output_multiplier", output_multiplier),
            )
            .await?;
        resp.get("model")
            .and_then(|v| v.get("id"))
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| HelixError::ParseError("missing model id in insert response".into()))
    }

    async fn set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.write(
            "set_enabled",
            QueryParams::new()
                .add("id", id)
                .add("enabled", if enabled { 1i64 } else { 0i64 }),
        )
        .await?;
        Ok(())
    }

    async fn set_multipliers(
        &self,
        name: &str,
        input_multiplier: f64,
        output_multiplier: f64,
    ) -> Result<()> {
        self.write(
            "set_multipliers",
            QueryParams::new()
                .add("name", name)
                .add("input_multiplier", input_multiplier)
                .add("output_multiplier", output_multiplier),
        )
        .await?;
        Ok(())
    }

    async fn delete_model(&self, id: &str) -> Result<()> {
        self.write(
            "delete_model",
            QueryParams::new().add("id", id),
        )
        .await?;
        Ok(())
    }

    async fn update_model_specs(
        &self,
        id: &str,
        provider: Option<&str>,
        think_mode: Option<i64>,
        visual_support: i64,
    ) -> Result<()> {
        self.write(
            "update_model_specs",
            QueryParams::new()
                .add("id", id)
                .add("provider", provider.unwrap_or(""))
                .add("think_mode", think_mode.unwrap_or(-1))
                .add("visual_support", visual_support),
        )
        .await?;
        Ok(())
    }

    async fn update_thinking_params(&self, id: &str, params: Option<&str>) -> Result<()> {
        self.write(
            "update_thinking_params",
            QueryParams::new()
                .add("id", id)
                .add("thinking_params", params.unwrap_or("")),
        )
        .await?;
        Ok(())
    }

    async fn set_student_models(&self, student_id: &str, model_names: &[String]) -> Result<()> {
        let models_json: serde_json::Value = model_names
            .iter()
            .map(|m| serde_json::json!({ "name": m }))
            .collect();
        self.write(
            "set_student_models",
            QueryParams::new()
                .add("student_id", student_id)
                .add("models", models_json),
        )
        .await?;
        Ok(())
    }

    async fn get_student(&self, id: &str) -> Result<Option<Student>> {
        let resp = self
            .read(
                "get_student",
                QueryParams::new().add("student_id", id),
            )
            .await?;
        extract_optional(&resp, "student")
    }

    async fn get_student_by_username(&self, username: &str) -> Result<Option<Student>> {
        let resp = self
            .read(
                "get_student_by_username",
                QueryParams::new().add("username", username),
            )
            .await?;
        extract_optional(&resp, "student")
    }

    async fn list_students(&self) -> Result<Vec<Student>> {
        let resp = self.read("list_students", QueryParams::new()).await?;
        extract_array(&resp, "students")
    }

    async fn insert_student(&self, student: &Student) -> Result<()> {
        self.write(
            "insert_student",
            QueryParams::new()
                .add("id", student.id.as_str())
                .add("username", student.username.as_str())
                .add("password_hash", student.password_hash.as_str())
                .add("display_name", student.display_name.as_str())
                .add("role", student.role.as_str())
                .add("cohort_id", student.cohort_id.as_str())
                .add("uid_slot", student.uid_slot.unwrap_or(0))
                .add("home_dir", student.home_dir.as_deref().unwrap_or(""))
                .add("token_limit", student.token_limit.unwrap_or(0)),
        )
        .await?;
        Ok(())
    }

    async fn touch_last_seen(&self, id: &str) -> Result<()> {
        self.write(
            "touch_last_seen",
            QueryParams::new().add("student_id", id),
        )
        .await?;
        Ok(())
    }

    async fn update_display_name(&self, id: &str, display_name: &str) -> Result<()> {
        self.write(
            "update_display_name",
            QueryParams::new()
                .add("student_id", id)
                .add("display_name", display_name),
        )
        .await?;
        Ok(())
    }

    async fn update_cohort(&self, id: &str, cohort_id: &str) -> Result<()> {
        self.write(
            "update_cohort",
            QueryParams::new()
                .add("student_id", id)
                .add("cohort_id", cohort_id),
        )
        .await?;
        Ok(())
    }

    async fn update_password(&self, id: &str, password_hash: &str) -> Result<()> {
        self.write(
            "update_password",
            QueryParams::new()
                .add("student_id", id)
                .add("password_hash", password_hash),
        )
        .await?;
        Ok(())
    }

    async fn delete_student(&self, id: &str) -> Result<()> {
        self.write(
            "delete_student",
            QueryParams::new().add("student_id", id),
        )
        .await?;
        Ok(())
    }

    async fn set_uid_slot(&self, id: &str, slot: Option<i64>) -> Result<()> {
        self.write(
            "set_uid_slot",
            QueryParams::new()
                .add("student_id", id)
                .add("uid_slot", slot.unwrap_or(0)),
        )
        .await?;
        Ok(())
    }

    async fn ban_student(&self, id: &str, message: Option<&str>) -> Result<()> {
        self.write(
            "ban_student",
            QueryParams::new()
                .add("student_id", id)
                .add("message", message.unwrap_or("")),
        )
        .await?;
        Ok(())
    }

    async fn unban_student(&self, id: &str) -> Result<()> {
        self.write(
            "unban_student",
            QueryParams::new().add("student_id", id),
        )
        .await?;
        Ok(())
    }

    async fn set_last_model(&self, id: &str, model: &str) -> Result<()> {
        self.write(
            "set_last_model",
            QueryParams::new()
                .add("student_id", id)
                .add("model", model),
        )
        .await?;
        Ok(())
    }

    async fn get_token_balance(&self, id: &str) -> Result<i64> {
        let resp = self
            .read(
                "get_token_balance",
                QueryParams::new().add("student_id", id),
            )
            .await?;
        extract_i64(&resp, "token_balance")
    }

    async fn deduct_tokens(&self, id: &str, amount: i64) -> Result<i64> {
        let resp = self
            .write(
                "deduct_tokens",
                QueryParams::new()
                    .add("student_id", id)
                    .add("amount", amount),
            )
            .await?;
        extract_i64(&resp, "new_balance")
    }

    async fn topup_tokens(&self, id: &str, amount: i64) -> Result<i64> {
        let resp = self
            .write(
                "topup_tokens",
                QueryParams::new()
                    .add("student_id", id)
                    .add("amount", amount),
            )
            .await?;
        extract_i64(&resp, "new_balance")
    }

    async fn get_session(&self, id: &str) -> Result<Option<Session>> {
        let resp = self
            .read(
                "get_session",
                QueryParams::new().add("session_id", id),
            )
            .await?;
        extract_optional(&resp, "session")
    }

    async fn list_active_sessions(&self) -> Result<Vec<Session>> {
        let resp = self.read("list_active_sessions", QueryParams::new()).await?;
        extract_array(&resp, "sessions")
    }

    async fn insert_session(&self, session: &Session) -> Result<()> {
        self.write(
            "insert_session",
            QueryParams::new()
                .add("id", session.id.as_str())
                .add("student_id", session.student_id.as_str())
                .add("state", session.state.as_str())
                .add("overlay_mount", session.overlay_mount.as_str())
                .add("model", session.model.as_deref().unwrap_or("")),
        )
        .await?;
        Ok(())
    }

    async fn set_session_model(&self, id: &str, model: &str) -> Result<()> {
        self.write(
            "set_session_model",
            QueryParams::new()
                .add("session_id", id)
                .add("model", model),
        )
        .await?;
        Ok(())
    }

    async fn set_session_state(&self, id: &str, state: &str) -> Result<()> {
        self.write(
            "set_session_state",
            QueryParams::new()
                .add("session_id", id)
                .add("state", state),
        )
        .await?;
        Ok(())
    }

    async fn set_namespace_pid(&self, id: &str, pid: i64) -> Result<()> {
        self.write(
            "set_namespace_pid",
            QueryParams::new()
                .add("session_id", id)
                .add("pid", pid),
        )
        .await?;
        Ok(())
    }

    async fn touch_last_input(&self, id: &str) -> Result<()> {
        self.write(
            "touch_last_input",
            QueryParams::new().add("session_id", id),
        )
        .await?;
        Ok(())
    }

    async fn get_last_token_checkpoint(&self, id: &str) -> Result<i64> {
        let resp = self
            .read(
                "get_last_token_checkpoint",
                QueryParams::new().add("session_id", id),
            )
            .await?;
        extract_i64(&resp, "checkpoint")
    }

    async fn update_last_token_checkpoint(&self, id: &str, checkpoint: i64) -> Result<()> {
        self.write(
            "update_last_token_checkpoint",
            QueryParams::new()
                .add("session_id", id)
                .add("checkpoint", checkpoint),
        )
        .await?;
        Ok(())
    }

    async fn get_cohort(&self, id: &str) -> Result<Option<Cohort>> {
        let resp = self
            .read("get_cohort", QueryParams::new().add("id", id))
            .await?;
        extract_optional(&resp, "cohort")
    }

    async fn list_cohorts(&self) -> Result<Vec<Cohort>> {
        let resp = self.read("list_cohorts", QueryParams::new()).await?;
        extract_array(&resp, "cohorts")
    }

    async fn insert_cohort(&self, cohort: &Cohort) -> Result<()> {
        self.write(
            "insert_cohort",
            QueryParams::new()
                .add("id", cohort.id.as_str())
                .add("title", cohort.title.as_str()),
        )
        .await?;
        Ok(())
    }

    async fn rename_cohort(&self, old_id: &str, new_id: &str, new_title: &str) -> Result<()> {
        self.write(
            "rename_cohort",
            QueryParams::new()
                .add("old_id", old_id)
                .add("new_id", new_id)
                .add("new_title", new_title),
        )
        .await?;
        Ok(())
    }

    async fn update_cohort_title(&self, id: &str, new_title: &str) -> Result<()> {
        self.write(
            "update_cohort_title",
            QueryParams::new()
                .add("id", id)
                .add("new_title", new_title),
        )
        .await?;
        Ok(())
    }

    async fn delete_cohort(&self, id: &str) -> Result<()> {
        self.write(
            "delete_cohort",
            QueryParams::new().add("id", id),
        )
        .await?;
        Ok(())
    }

    async fn get_subject(&self, id: &str) -> Result<Option<Subject>> {
        let resp = self
            .read("get_subject", QueryParams::new().add("id", id))
            .await?;
        extract_optional(&resp, "subject")
    }

    async fn get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> Result<Option<Subject>> {
        let resp = self
            .read(
                "get_subject_by_slug",
                QueryParams::new()
                    .add("cohort_id", cohort_id)
                    .add("slug", slug),
            )
            .await?;
        extract_optional(&resp, "subject")
    }

    async fn list_subjects(&self, cohort_id: &str) -> Result<Vec<Subject>> {
        let resp = self
            .read(
                "list_subjects",
                QueryParams::new().add("cohort_id", cohort_id),
            )
            .await?;
        extract_array(&resp, "subjects")
    }

    async fn insert_subject(&self, subject: &Subject) -> Result<()> {
        self.write(
            "insert_subject",
            QueryParams::new()
                .add("id", subject.id.as_str())
                .add("cohort_id", subject.cohort_id.as_str())
                .add("slug", subject.slug.as_str())
                .add("title", subject.title.as_str()),
        )
        .await?;
        Ok(())
    }

    async fn update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> Result<()> {
        self.write(
            "update_subject",
            QueryParams::new()
                .add("id", id)
                .add("new_slug", new_slug)
                .add("new_title", new_title),
        )
        .await?;
        Ok(())
    }

    async fn delete_subject(&self, id: &str) -> Result<()> {
        self.write(
            "delete_subject",
            QueryParams::new().add("id", id),
        )
        .await?;
        Ok(())
    }

    async fn record_turn(&self, session_id: &str, tokens: &TurnTokens) -> Result<()> {
        self.write(
            "record_turn",
            QueryParams::new()
                .add("session_id", session_id)
                .add("model", tokens.model.as_str())
                .add("input_tokens", tokens.input_tokens)
                .add("output_tokens", tokens.output_tokens)
                .add("cache_creation_tokens", tokens.cache_creation_input_tokens)
                .add("cache_read_tokens", tokens.cache_read_input_tokens),
        )
        .await?;
        Ok(())
    }

    async fn session_totals(&self, session_id: &str) -> Result<SessionTotals> {
        let resp = self
            .read(
                "session_totals",
                QueryParams::new().add("session_id", session_id),
            )
            .await?;
        Ok(SessionTotals {
            total_input_tokens: extract_i64(&resp, "total_input_tokens")?,
            total_output_tokens: extract_i64(&resp, "total_output_tokens")?,
            total_cache_creation_tokens: extract_i64(&resp, "total_cache_creation_tokens")?,
            total_cache_read_tokens: extract_i64(&resp, "total_cache_read_tokens")?,
            turn_count: extract_i64(&resp, "turn_count")?,
        })
    }

    async fn student_total_tokens(&self, student_id: &str) -> Result<StudentTotals> {
        let resp = self
            .read(
                "student_total_tokens",
                QueryParams::new().add("student_id", student_id),
            )
            .await?;
        Ok(StudentTotals {
            total_input_tokens: extract_i64(&resp, "input_total")?,
            total_output_tokens: extract_i64(&resp, "output_total")?,
            total_cache_creation_tokens: extract_i64(&resp, "cache_creation_total")?,
            total_cache_read_tokens: extract_i64(&resp, "cache_read_total")?,
            turn_count: extract_i64(&resp, "turn_count")?,
        })
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
    ) -> Result<()> {
        self.write(
            "record_deduction",
            QueryParams::new()
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
                .add("balance_after", balance_after),
        )
        .await?;
        Ok(())
    }

    async fn generate_codes(&self, tokens: i64, count: i64) -> Result<Vec<String>> {
        let resp = self
            .write(
                "generate_codes",
                QueryParams::new()
                    .add("tokens", tokens)
                    .add("count", count),
            )
            .await?;
        extract_array(&resp, "codes")
    }

    async fn list_codes(
        &self,
        tokens: Option<i64>,
        used: Option<bool>,
    ) -> Result<Vec<TokenCode>> {
        let mut params = QueryParams::new()
            .add("tokens", tokens.unwrap_or(0));
        if let Some(u) = used {
            if u {
                params.insert("show_used", "true");
            } else {
                params.insert("show_unused", "true");
            }
        }
        let resp = self.read("list_codes", params).await?;
        let mut codes: Vec<TokenCode> = Vec::new();
        if let Ok(mut c) = extract_array::<TokenCode>(&resp, "codes") {
            codes.append(&mut c);
        }
        if let Ok(mut c) = extract_array::<TokenCode>(&resp, "codes_used") {
            codes.append(&mut c);
        }
        if let Ok(mut c) = extract_array::<TokenCode>(&resp, "codes_unused") {
            codes.append(&mut c);
        }
        Ok(codes)
    }

    async fn delete_code(&self, id: &str) -> Result<()> {
        self.write(
            "delete_code",
            QueryParams::new().add("id", id),
        )
        .await?;
        Ok(())
    }

    async fn redeem_code(&self, code: &str, student_id: &str) -> Result<RedeemResult> {
        let resp = self
            .write(
                "redeem_code",
                QueryParams::new()
                    .add("code", code)
                    .add("student_id", student_id),
            )
            .await?;
        let status = resp
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        match status {
            "success" => Ok(RedeemResult::Success {
                tokens: extract_i64(&resp, "tokens")?,
                new_balance: extract_i64(&resp, "new_balance")?,
            }),
            "not_found" => Ok(RedeemResult::NotFound),
            "already_used" => Ok(RedeemResult::AlreadyUsed),
            _ => Err(HelixError::ParseError(format!(
                "unknown redeem status: {}",
                status
            ))),
        }
    }

    async fn export_codes(&self, tokens: i64) -> Result<Vec<TokenCode>> {
        let resp = self
            .read(
                "export_codes",
                QueryParams::new().add("tokens", tokens),
            )
            .await?;
        extract_array(&resp, "codes")
    }

    async fn get_me(&self, student_id: &str) -> Result<serde_json::Value> {
        self.read(
            "get_me",
            QueryParams::new().add("student_id", student_id),
        )
        .await
    }

    async fn get_session_models(&self, session_id: &str) -> Result<serde_json::Value> {
        let resp = self
            .read(
                "get_session_models",
                QueryParams::new().add("session_id", session_id),
            )
            .await?;
        // HelixDB returns {"all_enabled": {"properties": [...]}, "allowed": {"properties": [...]}}
        // Merge into a single "models" key for API compatibility
        let mut merged = serde_json::Map::new();
        if let Some(all) = resp.get("all_enabled").and_then(|v| v.get("properties")) {
            merged.insert("all_enabled".to_string(), all.clone());
        }
        if let Some(allowed) = resp.get("allowed").and_then(|v| v.get("properties")) {
            merged.insert("allowed".to_string(), allowed.clone());
        }
        Ok(serde_json::Value::Object(merged))
    }

    async fn students_with_active_sessions(&self) -> Result<serde_json::Value> {
        self.read("students_with_active_sessions", QueryParams::new())
            .await
    }

    async fn deduction_history(&self, student_id: &str) -> Result<Vec<TokenDeduction>> {
        let resp = self
            .read(
                "deduction_history",
                QueryParams::new().add("student_id", student_id),
            )
            .await?;
        extract_array(&resp, "deductions")
    }

    async fn create_session_api(&self, params: &serde_json::Value) -> Result<serde_json::Value> {
        let qp = QueryParams::new()
            .add("id", params["id"].as_str().unwrap_or(""))
            .add("student_id", params["student_id"].as_str().unwrap_or(""))
            .add("cohort_id", params["cohort_id"].as_str().unwrap_or(""))
            .add("state", params["state"].as_str().unwrap_or("active"))
            .add("overlay_mount", params["overlay_mount"].as_str().unwrap_or(""))
            .add("model_name", params["model_name"].as_str().unwrap_or(""));
        self.write("create_session", qp).await
    }

    async fn set_session_model_api(&self, session_id: &str, model: &str) -> Result<()> {
        self.write(
            "set_session_model_api",
            QueryParams::new()
                .add("session_id", session_id)
                .add("model", model),
        )
        .await?;
        Ok(())
    }

    async fn update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> Result<serde_json::Value> {
        let mut params = QueryParams::new()
            .add("student_id", student_id);
        if let Some(display_name) = updates.get("display_name").and_then(|v| v.as_str()) {
            params.insert("display_name", display_name);
        }
        if let Some(cohort_id) = updates.get("cohort_id").and_then(|v| v.as_str()) {
            params.insert("cohort_id", cohort_id);
        }
        if let Some(password_hash) = updates.get("password_hash").and_then(|v| v.as_str()) {
            params.insert("password_hash", password_hash);
        }
        self.write("update_me", params).await
    }
}
