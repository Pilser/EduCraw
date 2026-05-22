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
        let now = chrono::Utc::now().to_rfc3339();
        let qp = QueryParams::new()
            .add("id", params["id"].as_str().unwrap_or(""))
            .add("student_id", params["student_id"].as_str().unwrap_or(""))
            .add("cohort_id", params["cohort_id"].as_str().unwrap_or(""))
            .add("state", params["state"].as_str().unwrap_or("active"))
            .add("overlay_mount", params["overlay_mount"].as_str().unwrap_or(""))
            .add("model_name", params["model_name"].as_str().unwrap_or(""))
            .add("started_at", now.as_str())
            .add("last_seen", now);
        self.write("create_session", qp).await
    }

    pub async fn _set_session_model_api(&self, session_id: &str, model: &str) -> Result<()> {
        self.write("set_session_model_api", QueryParams::new().add("session_id", session_id).add("model", model)).await?;
        Ok(())
    }

    pub async fn _update_me_api(&self, student_id: &str, updates: &serde_json::Value) -> Result<serde_json::Value> {
        let mut queries: Vec<serde_json::Value> = vec![
            serde_json::json!({
                "Query": {
                    "name": "student",
                    "steps": [
                        {"NWhere": {"Eq": ["$label", {"String": "Student"}]}},
                        {"Where": {"Compare": {"left": {"Property": "id"}, "op": "Eq", "right": {"Param": "student_id"}}}},
                        {"ValueMap": null}
                    ],
                    "condition": null
                }
            }),
        ];

        let mut params = serde_json::Map::new();
        params.insert("student_id".to_string(), serde_json::Value::String(student_id.to_string()));

        if let Some(display_name) = updates.get("display_name").and_then(|v| v.as_str()) {
            if !display_name.is_empty() {
                params.insert("display_name".to_string(), serde_json::Value::String(display_name.to_string()));
                queries.push(serde_json::json!({
                    "Query": {
                        "name": "set_display_name",
                        "steps": [
                            {"N": {"Var": "student"}},
                            {"SetProperty": ["display_name", {"Expr": {"Param": "display_name"}}]}
                        ],
                        "condition": null
                    }
                }));
            }
        }

        if let Some(password_hash) = updates.get("password_hash").and_then(|v| v.as_str()) {
            if !password_hash.is_empty() {
                params.insert("password_hash".to_string(), serde_json::Value::String(password_hash.to_string()));
                queries.push(serde_json::json!({
                    "Query": {
                        "name": "set_password_hash",
                        "steps": [
                            {"N": {"Var": "student"}},
                            {"SetProperty": ["password_hash", {"Expr": {"Param": "password_hash"}}]}
                        ],
                        "condition": null
                    }
                }));
            }
        }

        if let Some(cohort_id) = updates.get("cohort_id").and_then(|v| v.as_str()) {
            if !cohort_id.is_empty() {
                params.insert("cohort_id".to_string(), serde_json::Value::String(cohort_id.to_string()));
                queries.push(serde_json::json!({
                    "Query": {
                        "name": "set_cohort_id",
                        "steps": [
                            {"N": {"Var": "student"}},
                            {"SetProperty": ["cohort_id", {"Expr": {"Param": "cohort_id"}}]}
                        ],
                        "condition": null
                    }
                }));
                queries.push(serde_json::json!({
                    "Query": {
                        "name": "old_cohort",
                        "steps": [
                            {"N": {"Var": "student"}},
                            {"Out": "IN_COHORT"}
                        ],
                        "condition": null
                    }
                }));
                queries.push(serde_json::json!({
                    "Query": {
                        "name": "drop_old",
                        "steps": [
                            {"N": {"Var": "student"}},
                            {"DropEdgeLabeled": {"to": {"Var": "old_cohort"}, "label": "IN_COHORT"}}
                        ],
                        "condition": {"VarNotEmpty": "old_cohort"}
                    }
                }));
                queries.push(serde_json::json!({
                    "Query": {
                        "name": "new_cohort",
                        "steps": [
                            {"NWhere": {"Eq": ["$label", {"String": "Cohort"}]}},
                            {"Where": {"Compare": {"left": {"Property": "id"}, "op": "Eq", "right": {"Param": "cohort_id"}}}}
                        ],
                        "condition": null
                    }
                }));
                queries.push(serde_json::json!({
                    "Query": {
                        "name": "link",
                        "steps": [
                            {"N": {"Var": "student"}},
                            {"AddE": {"label": "IN_COHORT", "to": {"Var": "new_cohort"}, "properties": []}}
                        ],
                        "condition": {"VarNotEmpty": "new_cohort"}
                    }
                }));
            }
        }

        let body = serde_json::json!({
            "request_type": "write",
            "query": {
                "queries": queries,
                "returns": ["student"]
            },
            "parameters": params,
            "parameter_types": {
                "student_id": "String",
                "display_name": "String",
                "password_hash": "String",
                "cohort_id": "String"
            }
        });

        self.raw_query(body).await
    }
}
