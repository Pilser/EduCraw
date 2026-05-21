use crate::db::{BackendResult, BackendError, SqliteBackend};

impl SqliteBackend {
    pub async fn _get_me(&self, student_id: &str) -> BackendResult<serde_json::Value> {
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

    pub async fn _get_session_models(&self, session_id: &str) -> BackendResult<serde_json::Value> {
        let session = crate::db::sessions::get_session(&self.pool, session_id).await?
            .ok_or_else(|| BackendError::NotFound(format!("session {session_id}")))?;
        let models = crate::db::models::full_models_for_student(&self.pool, &session.student_id).await?;
        let student_last_model = crate::db::students::get_student(&self.pool, &session.student_id).await?
            .and_then(|s| s.last_model);
        let active = student_last_model.or(session.model).unwrap_or_else(|| "grok-4-1-fast-reasoning".to_string());
        Ok(serde_json::json!({ "models": models, "active": active }))
    }

    pub async fn _students_with_active_sessions(&self) -> BackendResult<serde_json::Value> {
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

    pub async fn _create_session_api(&self, _params: &serde_json::Value) -> BackendResult<serde_json::Value> {
        Err(BackendError::Internal(anyhow::anyhow!("create_session_api not implemented for SQLite backend")))
    }

    pub async fn _set_session_model_api(&self, session_id: &str, model: &str) -> BackendResult<()> {
        Ok(crate::db::sessions::set_session_model(&self.pool, session_id, model).await?)
    }

    pub async fn _update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> BackendResult<serde_json::Value> {
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
                .into_iter().map(|s| s.slug).collect()
        };
        Ok(serde_json::json!({ "student": updated, "subject_ids": subject_ids }))
    }
}
