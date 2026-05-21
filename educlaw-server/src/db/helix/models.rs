use crate::db::{BackendResult, HelixBackend, Model};
use educlaw_helix::DbBackend as HelixDb;
use super::conv::*;

impl HelixBackend {
    pub async fn _list_models(&self) -> BackendResult<Vec<Model>> {
        let m = HelixDb::list_models(&self.client).await?;
        Ok(m.into_iter().map(helix_model_to_local).collect())
    }
    pub async fn _list_enabled_models(&self) -> BackendResult<Vec<Model>> {
        let m = HelixDb::list_enabled_models(&self.client).await?;
        Ok(m.into_iter().map(helix_model_to_local).collect())
    }
    pub async fn _get_model_by_name(&self, name: &str) -> BackendResult<Option<Model>> {
        Ok(HelixDb::get_model_by_name(&self.client, name).await?.map(helix_model_to_local))
    }
    pub async fn _get_model_multipliers(&self, name: &str) -> BackendResult<(f64, f64)> {
        Ok(HelixDb::get_model_multipliers(&self.client, name).await?)
    }
    pub async fn _models_for_student(&self, student_id: &str) -> BackendResult<Vec<String>> {
        Ok(HelixDb::models_for_student(&self.client, student_id).await?)
    }
    pub async fn _raw_assignments_for_student(&self, student_id: &str) -> BackendResult<Vec<String>> {
        Ok(HelixDb::raw_assignments_for_student(&self.client, student_id).await?)
    }
    pub async fn _insert_model(&self, id: &str, name: &str, display_name: &str, input_multiplier: f64, output_multiplier: f64) -> BackendResult<String> {
        Ok(HelixDb::insert_model(&self.client, id, name, display_name, input_multiplier, output_multiplier).await?)
    }
    pub async fn _set_enabled(&self, id: &str, enabled: bool) -> BackendResult<()> {
        Ok(HelixDb::set_enabled(&self.client, id, enabled).await?)
    }
    pub async fn _set_multipliers(&self, name: &str, input_multiplier: f64, output_multiplier: f64) -> BackendResult<()> {
        Ok(HelixDb::set_multipliers(&self.client, name, input_multiplier, output_multiplier).await?)
    }
    pub async fn _delete_model(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_model(&self.client, id).await?)
    }
    pub async fn _update_model_specs(&self, id: &str, provider: Option<&str>, think_mode: Option<i64>, visual_support: i64) -> BackendResult<()> {
        Ok(HelixDb::update_model_specs(&self.client, id, provider, think_mode, visual_support).await?)
    }
    pub async fn _update_thinking_params(&self, id: &str, params: Option<&str>) -> BackendResult<()> {
        Ok(HelixDb::update_thinking_params(&self.client, id, params).await?)
    }
    pub async fn _set_student_models(&self, student_id: &str, model_names: &[String]) -> BackendResult<()> {
        Ok(HelixDb::set_student_models(&self.client, student_id, model_names).await?)
    }
}
