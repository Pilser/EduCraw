use crate::client::QueryParams;
use crate::error::Result;

impl crate::client::HelixClient {
    pub async fn _get_me(&self, student_id: &str) -> Result<serde_json::Value> {
        let resp = self.read("get_me", QueryParams::new().add("student_id", student_id)).await?;
        let student = resp.get("student").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).and_then(|arr| arr.first()).and_then(|v| v.as_object()).cloned().unwrap_or(serde_json::Map::new());
        let cohort_title = resp.get("cohort").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).and_then(|arr| arr.first()).and_then(|v| v.get("title")).and_then(|v| v.as_str()).map(String::from);
        let available_cohorts = resp.get("all_cohorts").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).map(|arr| serde_json::Value::Array(arr.clone())).unwrap_or(serde_json::Value::Array(vec![]));
        let mut result = serde_json::Value::Object(student);
        if let Some(obj) = result.as_object_mut() {
            obj.insert("cohort_title".to_string(), cohort_title.into());
            obj.insert("available_cohorts".to_string(), available_cohorts);
        }
        Ok(result)
    }

    pub async fn _get_session_models(&self, session_id: &str) -> Result<serde_json::Value> {
        let session_resp = self.read("get_session", QueryParams::new().add("session_id", session_id)).await?;
        let student_id = session_resp.get("session").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).and_then(|arr| arr.first()).and_then(|v| v.get("student_id")).and_then(|v| v.as_str()).unwrap_or("");
        let resp = self.read("get_session_models", QueryParams::new().add("session_id", session_id).add("student_id", student_id)).await?;
        let mut models = Vec::new();
        if let Some(all) = resp.get("all_enabled").and_then(|v| v.get("properties")).and_then(|v| v.as_array()) { models.extend_from_slice(all); }
        models.dedup();
        let last_model_name = resp.get("last_model").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).and_then(|arr| arr.first()).and_then(|v| v.get("name")).and_then(|v| v.as_str()).map(String::from);
        let session_model = resp.get("session").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).and_then(|arr| arr.first()).and_then(|v| v.get("model")).and_then(|v| v.as_str()).map(String::from);
        let active = last_model_name.or(session_model).unwrap_or_else(|| "grok-4-1-fast-reasoning".to_string());
        Ok(serde_json::json!({"models": models, "active": active}))
    }

    pub async fn _students_with_active_sessions(&self) -> Result<serde_json::Value> {
        self.read("students_with_active_sessions", QueryParams::new()).await
    }

    pub async fn _create_session_api(&self, params: &serde_json::Value) -> Result<serde_json::Value> {
        let qp = QueryParams::new()
            .add("id", params["id"].as_str().unwrap_or(""))
            .add("student_id", params["student_id"].as_str().unwrap_or(""))
            .add("cohort_id", params["cohort_id"].as_str().unwrap_or(""))
            .add("state", params["state"].as_str().unwrap_or("active"))
            .add("overlay_mount", params["overlay_mount"].as_str().unwrap_or(""))
            .add("model_name", params["model_name"].as_str().unwrap_or(""));
        self.write("create_session", qp).await
    }

    pub async fn _set_session_model_api(&self, session_id: &str, model: &str) -> Result<()> {
        self.write("set_session_model_api", QueryParams::new().add("session_id", session_id).add("model", model)).await?;
        Ok(())
    }

    pub async fn _update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> Result<serde_json::Value> {
        let mut params = QueryParams::new().add("student_id", student_id);
        if let Some(display_name) = updates.get("display_name").and_then(|v| v.as_str()) { params.insert("display_name", display_name); }
        if let Some(cohort_id) = updates.get("cohort_id").and_then(|v| v.as_str()) { params.insert("cohort_id", cohort_id); }
        if let Some(password_hash) = updates.get("password_hash").and_then(|v| v.as_str()) { params.insert("password_hash", password_hash); }
        self.write("update_me", params).await
    }
}
