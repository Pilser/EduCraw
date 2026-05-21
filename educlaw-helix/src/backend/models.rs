use crate::client::QueryParams;
use crate::error::{HelixError, Result};
use crate::types::*;
use super::extract::{extract_array, extract_optional, try_extract_array};

impl crate::client::HelixClient {
    pub async fn _list_models(&self) -> Result<Vec<Model>> {
        let resp = self.read("list_models", QueryParams::new()).await?;
        extract_array(&resp, "models")
    }

    pub async fn _list_enabled_models(&self) -> Result<Vec<Model>> {
        let resp = self.read("list_enabled", QueryParams::new()).await?;
        extract_array(&resp, "models")
    }

    pub async fn _get_model_by_name(&self, name: &str) -> Result<Option<Model>> {
        let resp = self.read("get_model_by_name", QueryParams::new().add("name", name)).await?;
        extract_optional(&resp, "model")
    }

    pub async fn _get_model_multipliers(&self, name: &str) -> Result<(f64, f64)> {
        let resp = self.read("get_model_multipliers", QueryParams::new().add("name", name)).await?;
        let model = resp.get("model").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).and_then(|arr| arr.first());
        let input = model.and_then(|v| v.get("input_multiplier")).and_then(|v| v.as_f64()).unwrap_or(1.0);
        let output = model.and_then(|v| v.get("output_multiplier")).and_then(|v| v.as_f64()).unwrap_or(1.0);
        Ok((input, output))
    }

    pub async fn _models_for_student(&self, student_id: &str) -> Result<Vec<String>> {
        let resp = self.read("models_for_student", QueryParams::new().add("student_id", student_id)).await?;
        let mut models = try_extract_array::<Model>(&resp, "allowed");
        if models.is_empty() {
            models = try_extract_array::<Model>(&resp, "all_enabled");
        }
        Ok(models.into_iter().map(|m| m.name).collect())
    }

    pub async fn _raw_assignments_for_student(&self, student_id: &str) -> Result<Vec<String>> {
        let resp = self.read("raw_assignments_for_student", QueryParams::new().add("student_id", student_id)).await?;
        let names: Vec<String> = resp.get("student").and_then(|v| v.get("properties")).and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
        Ok(names)
    }

    pub async fn _insert_model(&self, id: &str, name: &str, display_name: &str, input_multiplier: f64, output_multiplier: f64) -> Result<String> {
        let now = chrono::Utc::now().to_rfc3339();
        let resp = self.write("insert_model", QueryParams::new()
            .add("id", id)
            .add("name", name)
            .add("display_name", display_name)
            .add("input_multiplier", input_multiplier)
            .add("output_multiplier", output_multiplier)
            .add("created_at", now)).await?;
        resp.get("model").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).and_then(|arr| arr.first()).and_then(|v| v.get("id")).and_then(|v| v.as_str()).map(String::from)
            .ok_or_else(|| HelixError::ParseError("missing model id in insert response".into()))
    }

    pub async fn _set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.write("set_enabled", QueryParams::new().add("id", id).add("enabled", if enabled { 1i64 } else { 0i64 })).await?;
        Ok(())
    }

    pub async fn _set_multipliers(&self, name: &str, input_multiplier: f64, output_multiplier: f64) -> Result<()> {
        self.write("set_multipliers", QueryParams::new().add("name", name).add("input_multiplier", input_multiplier).add("output_multiplier", output_multiplier)).await?;
        Ok(())
    }

    pub async fn _delete_model(&self, id: &str) -> Result<()> {
        self.write("delete_model", QueryParams::new().add("id", id)).await?;
        Ok(())
    }

    pub async fn _update_model_specs(&self, id: &str, provider: Option<&str>, think_mode: Option<i64>, visual_support: i64) -> Result<()> {
        self.write("update_model_specs", QueryParams::new()
            .add("id", id)
            .add("provider", provider.unwrap_or(""))
            .add("think_mode", think_mode.unwrap_or(-1))
            .add("visual_support", visual_support)).await?;
        Ok(())
    }

    pub async fn _update_thinking_params(&self, id: &str, params: Option<&str>) -> Result<()> {
        self.write("update_thinking_params", QueryParams::new().add("id", id).add("thinking_params", params.unwrap_or(""))).await?;
        Ok(())
    }

    pub async fn _set_student_models(&self, student_id: &str, model_names: &[String]) -> Result<()> {
        let models_json: serde_json::Value = model_names.iter().map(|m| serde_json::json!({ "name": m })).collect();
        self.write("set_student_models", QueryParams::new().add("student_id", student_id).add("models", models_json)).await?;
        Ok(())
    }
}
