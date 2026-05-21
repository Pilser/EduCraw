use crate::db::{BackendResult, SqliteBackend};

impl SqliteBackend {
    pub async fn _list_models(&self) -> BackendResult<Vec<crate::db::Model>> {
        Ok(crate::db::models::list_models(&self.pool).await?)
    }
    pub async fn _list_enabled_models(&self) -> BackendResult<Vec<crate::db::Model>> {
        Ok(crate::db::models::list_enabled(&self.pool).await?)
    }
    pub async fn _get_model_by_name(&self, name: &str) -> BackendResult<Option<crate::db::Model>> {
        Ok(crate::db::models::get_model_by_name(&self.pool, name).await?)
    }
    pub async fn _get_model_multipliers(&self, name: &str) -> BackendResult<(f64, f64)> {
        Ok(crate::db::models::get_model_multipliers(&self.pool, name).await?)
    }
    pub async fn _models_for_student(&self, student_id: &str) -> BackendResult<Vec<String>> {
        Ok(crate::db::models::models_for_student(&self.pool, student_id).await?)
    }
    pub async fn _raw_assignments_for_student(&self, student_id: &str) -> BackendResult<Vec<String>> {
        Ok(crate::db::models::raw_assignments_for_student(&self.pool, student_id).await?)
    }
    pub async fn _insert_model(&self, id: &str, name: &str, display_name: &str, input_multiplier: f64, output_multiplier: f64) -> BackendResult<String> {
        Ok(crate::db::models::insert_model(&self.pool, id, name, display_name, input_multiplier, output_multiplier).await?)
    }
    pub async fn _set_enabled(&self, id: &str, enabled: bool) -> BackendResult<()> {
        Ok(crate::db::models::set_enabled(&self.pool, id, enabled).await?)
    }
    pub async fn _set_multipliers(&self, name: &str, input_multiplier: f64, output_multiplier: f64) -> BackendResult<()> {
        Ok(crate::db::models::set_multipliers(&self.pool, name, input_multiplier, output_multiplier).await?)
    }
    pub async fn _delete_model(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::models::delete_model(&self.pool, id).await?)
    }
    pub async fn _update_model_specs(&self, id: &str, provider: Option<&str>, think_mode: Option<i64>, visual_support: i64) -> BackendResult<()> {
        Ok(crate::db::models::update_model_specs(&self.pool, id, provider, think_mode, visual_support).await?)
    }
    pub async fn _update_thinking_params(&self, id: &str, params: Option<&str>) -> BackendResult<()> {
        Ok(crate::db::models::update_thinking_params(&self.pool, id, params).await?)
    }
    pub async fn _set_student_models(&self, student_id: &str, model_names: &[String]) -> BackendResult<()> {
        Ok(crate::db::models::set_student_models(&self.pool, student_id, model_names).await?)
    }
}
