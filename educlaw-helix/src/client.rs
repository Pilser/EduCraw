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

    /// Test connectivity to HelixDB by sending a minimal query.
    /// Returns Ok(()) if the database responds, Err otherwise.
    /// Send a fully-formed JSON query body to HelixDB without template processing.
    pub(crate) async fn raw_query(&self, body: serde_json::Value) -> Result<serde_json::Value> {
        let resp = self
            .http
            .post(format!("{}/v1/query", self.config.base_url))
            .json(&body)
            .send()
            .await?;

        let status = resp.status().as_u16();
        let resp_body = resp.text().await?;

        tracing::debug!(
            request_body = %serde_json::to_string(&body).unwrap_or_default(),
            response_body = %resp_body,
            status = status,
            "HelixDB raw query"
        );

        if status >= 400 {
            return Err(HelixError::ApiError { status, body: resp_body });
        }
        let result: serde_json::Value = serde_json::from_str(&resp_body)?;
        Ok(result)
    }

    pub async fn test_connection(&self) -> Result<()> {
        let test_body = serde_json::json!({
            "read_batch": {
                "steps": [{
                    "traversal": {
                        "anchor": {
                            "nodes": {
                                "labels": ["_HelixProbe"]
                            }
                        }
                    }
                }]
            }
        });

        let resp = self
            .http
            .post(format!("{}/v1/query", self.config.base_url))
            .json(&test_body)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(
                    url = %self.config.base_url,
                    error = %e,
                    "HelixDB connection test FAILED — database is unreachable"
                );
                HelixError::ConnectionError(format!(
                    "Cannot reach HelixDB at {}: {}",
                    self.config.base_url, e
                ))
            })?;

        let status = resp.status().as_u16();

        // 200 = success, 404 = endpoint exists but no such query (still means DB is alive)
        // 5xx or connection refused = DB is down
        if status >= 500 {
            let body = resp.text().await.unwrap_or_default();
            tracing::error!(
                url = %self.config.base_url,
                status = status,
                body = %body,
                "HelixDB connection test FAILED — server returned 5xx"
            );
            return Err(HelixError::ConnectionError(format!(
                "HelixDB at {} returned HTTP {}",
                self.config.base_url, status
            )));
        }

        // Consume body to avoid leak
        let _ = resp.text().await;

        tracing::info!(
            url = %self.config.base_url,
            "HelixDB connection test PASSED"
        );
        Ok(())
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

        tracing::debug!(
            query_name = _name,
            request_body = %serde_json::to_string(&body).unwrap_or_default(),
            "HelixDB request sent"
        );

        let status = resp.status().as_u16();
        let resp_body = resp.text().await?;
        if status >= 400 {
            return Err(HelixError::ApiError {
                status,
                body: resp_body.clone(),
            });
        }
        tracing::debug!(
            query_name = _name,
            response_body = %resp_body,
            "HelixDB raw response"
        );
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
