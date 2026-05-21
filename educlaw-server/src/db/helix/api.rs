use crate::db::{BackendResult, HelixBackend};
use educlaw_helix::DbBackend as HelixDb;

impl HelixBackend {
    pub async fn _get_me(&self, student_id: &str) -> BackendResult<serde_json::Value> {
        Ok(HelixDb::get_me(&self.client, student_id).await?)
    }
    pub async fn _get_session_models(&self, session_id: &str) -> BackendResult<serde_json::Value> {
        Ok(HelixDb::get_session_models(&self.client, session_id).await?)
    }
    pub async fn _students_with_active_sessions(&self) -> BackendResult<serde_json::Value> {
        Ok(HelixDb::students_with_active_sessions(&self.client).await?)
    }
    pub async fn _create_session_api(&self, params: &serde_json::Value) -> BackendResult<serde_json::Value> {
        Ok(HelixDb::create_session_api(&self.client, params).await?)
    }
    pub async fn _set_session_model_api(&self, session_id: &str, model: &str) -> BackendResult<()> {
        Ok(HelixDb::set_session_model_api(&self.client, session_id, model).await?)
    }
    pub async fn _update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> BackendResult<serde_json::Value> {
        Ok(HelixDb::update_me_api(&self.client, student_id, updates).await?)
    }
}
