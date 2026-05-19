use std::collections::HashMap;

use crate::config::HelixConfig;
use crate::error::{HelixError, Result};
use crate::queries;

pub struct HelixClient {
    http: reqwest::Client,
    config: HelixConfig,
}

impl HelixClient {
    pub fn new(config: HelixConfig) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .unwrap();
        Self { http, config }
    }

    pub async fn read(&self, query_name: &str, params: QueryParams) -> Result<serde_json::Value> {
        let template = queries::get_read(query_name)?;
        self.execute(query_name, template, params).await
    }

    pub async fn write(&self, query_name: &str, params: QueryParams) -> Result<serde_json::Value> {
        let template = queries::get_write(query_name)?;
        self.execute(query_name, template, params).await
    }

    async fn execute(
        &self,
        _name: &str,
        template: &str,
        params: QueryParams,
    ) -> Result<serde_json::Value> {
        let mut body: serde_json::Value = serde_json::from_str(template)?;

        if let Some(params_obj) = body.get_mut("parameters") {
            if let Some(obj) = params_obj.as_object_mut() {
                for (key, value) in params.0 {
                    obj.insert(key, value);
                }
            }
        }

        let resp = self
            .http
            .post(format!("{}/v1/query", self.config.base_url))
            .json(&body)
            .send()
            .await?;

        let status = resp.status().as_u16();
        let resp_body = resp.text().await?;
        if status >= 400 {
            return Err(HelixError::ApiError {
                status,
                body: resp_body,
            });
        }
        let result: serde_json::Value = serde_json::from_str(&resp_body)?;
        Ok(result)
    }
}

pub struct QueryParams(pub HashMap<String, serde_json::Value>);

impl QueryParams {
    pub fn new() -> Self {
        Self(HashMap::new())
    }

    pub fn add(mut self, key: &str, value: impl Into<serde_json::Value>) -> Self {
        self.0.insert(key.to_string(), value.into());
        self
    }

    pub fn insert(&mut self, key: &str, value: impl Into<serde_json::Value>) {
        self.0.insert(key.to_string(), value.into());
    }
}

impl Default for QueryParams {
    fn default() -> Self {
        Self::new()
    }
}
