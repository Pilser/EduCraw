use std::sync::LazyLock;

use crate::agents::mcp_client::{Error, McpClientTrait};
use crate::agents::tool_execution::ToolCallContext;
use async_trait::async_trait;
use indoc::indoc;
use rmcp::model::{
    CallToolResult, Content, Implementation, InitializeResult, JsonObject, ListToolsResult,
    ServerCapabilities, Tool, ToolAnnotations,
};
use schemars::{schema_for, JsonSchema};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

pub static EXTENSION_NAME: &str = "websearch";

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .user_agent("EduCraw/1.0 (AI Tutor; +https://educraw.ai)")
        .build()
        .expect("Failed to build reqwest Client")
});

const MAX_DIRECT_CHARS: usize = 4000;

#[derive(Debug, Deserialize, JsonSchema)]
struct WebSearchParams {
    query: String,
    #[serde(default = "default_num_results")]
    num_results: u32,
    #[serde(default = "default_search_type")]
    r#type: String,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    max_age_hours: Option<i32>,
    #[serde(default)]
    include_domains: Option<Vec<String>>,
    #[serde(default)]
    exclude_domains: Option<Vec<String>>,
}

fn default_num_results() -> u32 {
    8
}

fn default_search_type() -> String {
    "auto".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
struct ExaResult {
    title: Option<String>,
    url: String,
    highlights: Option<Vec<String>>,
    text: Option<String>,
    published_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ExaResponse {
    results: Vec<ExaResult>,
    #[serde(default)]
    autoprompt_string: Option<String>,
}

pub struct WebSearchClient {
    info: InitializeResult,
}

impl WebSearchClient {
    pub fn new() -> Self {
        let info = InitializeResult::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new(EXTENSION_NAME.to_string(), "1.0.0".to_string())
                    .with_title("Web Search"),
            );

        Self { info }
    }

    async fn handle_search(&self, params: WebSearchParams) -> Result<CallToolResult, String> {
        let api_key = std::env::var("EXA_API_KEY")
            .map_err(|_| "EXA_API_KEY environment variable is not set".to_string())?;

        let mut body = serde_json::Map::new();
        body.insert("query".to_string(), Value::String(params.query));
        body.insert("type".to_string(), Value::String(params.r#type));
        body.insert(
            "num_results".to_string(),
            Value::Number(serde_json::Number::from(params.num_results)),
        );

        let mut contents = serde_json::Map::new();
        contents.insert("highlights".to_string(), Value::Bool(true));
        contents.insert(
            "text".to_string(),
            serde_json::json!({"maxCharacters": 5000}),
        );
        body.insert("contents".to_string(), Value::Object(contents));

        if let Some(hours) = params.max_age_hours {
            body.insert("maxAgeHours".to_string(), Value::Number(hours.into()));
        }

        if let Some(ref cat) = params.category {
            if !cat.is_empty() {
                let has_exclude = params.exclude_domains.as_ref().map_or(false, |d| !d.is_empty());
                if has_exclude && (cat == "people" || cat == "company") {
                    return Err(format!(
                        "The 'category: {cat}' filter does not support exclude_domains. \
                         Remove exclude_domains or remove the category filter."
                    ));
                }
                body.insert("category".to_string(), Value::String(cat.clone()));
            }
        }

        if let Some(domains) = params.include_domains {
            if !domains.is_empty() {
                body.insert(
                    "includeDomains".to_string(),
                    Value::Array(domains.into_iter().map(Value::String).collect()),
                );
            }
        }

        if let Some(domains) = params.exclude_domains {
            if !domains.is_empty() {
                body.insert(
                    "excludeDomains".to_string(),
                    Value::Array(domains.into_iter().map(Value::String).collect()),
                );
            }
        }

        let resp = HTTP_CLIENT
            .post("https://api.exa.ai/search")
            .header("x-api-key", &api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Exa API request failed: {e}"))?;

        let status = resp.status();
        let raw = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {e}"))?;

        if !status.is_success() {
            return Err(format!("Exa API returned {status}: {raw}"));
        }

        let exa: ExaResponse = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse Exa response: {e}"))?;

        if exa.results.is_empty() {
            return Ok(CallToolResult::success(vec![Content::text(
                "No results found for the query.",
            )]));
        }

        let mut full = String::new();
        if let Some(ref ap) = exa.autoprompt_string {
            full.push_str(&format!("Search refinement: {ap}\n\n"));
        }

        for (i, result) in exa.results.iter().enumerate() {
            full.push_str(&format!(
                "{}. {}",
                i + 1,
                result.title.as_deref().unwrap_or("(no title)")
            ));
            if let Some(ref date) = result.published_date {
                full.push_str(&format!(" ({})", &date[..10.min(date.len())]));
            }
            full.push('\n');
            full.push_str(&format!("   URL: {}\n", result.url));

            if let Some(ref highlights) = result.highlights {
                for h in highlights.iter().take(3) {
                    full.push_str(&format!("   > {h}\n"));
                }
            }

            if let Some(ref text) = result.text {
                if result.highlights.as_ref().map_or(true, |h| h.is_empty()) {
                    let snippet: String = text.chars().take(500).collect();
                    full.push_str(&format!("   {snippet}...\n"));
                }
            }

            full.push('\n');
        }

        let char_count = full.chars().count();

        if char_count <= MAX_DIRECT_CHARS {
            return Ok(CallToolResult::success(vec![Content::text(full)]));
        }

        let hash = blake3::hash(full.as_bytes());
        let snippet: String = hash.to_hex()[..12].to_string();
        let tmp_path = format!("/tmp/websearch_{snippet}.txt");

        tokio::fs::write(&tmp_path, &full)
            .await
            .map_err(|e| format!("Failed to write search results to disk: {e}"))?;

        let line_count = full.lines().count();
        let summary = format!(
            "Search returned {count} results ({chars} chars, {lines} lines). \
             Full output saved to {path}. \
             Read the file with shell tool or summarize to process it. \
             Be careful — the file may be large and could bloat your context window.\n\n\
             === Summary ===\n{summary}",
            count = exa.results.len(),
            chars = char_count,
            lines = line_count,
            path = tmp_path,
            summary = truncate_summary(&full, 600),
        );

        Ok(CallToolResult::success(vec![Content::text(summary)]))
    }

    fn get_tools() -> Vec<Tool> {
        let schema = schema_for!(WebSearchParams);
        let schema_value =
            serde_json::to_value(schema).expect("Failed to serialize WebSearchParams schema");

        vec![Tool::new(
            "web_search".to_string(),
            indoc! {r#"
                Search the web for current information.

                Use this tool when you need up-to-date information, facts, news, or
                any topic that requires external knowledge beyond your training data.

                Parameters:
                - query: The search query (required)
                - num_results: Number of results to return (default: 8)
                - type: Search type — "auto" (balanced, default), "fast" (~450ms),
                        "instant" (~250ms), "deep" (4-15s, thorough),
                        "deep-lite" (cheaper synthesis), "deep-reasoning" (12-40s, max depth)
                - category: Optional — "people" or "company"
                - max_age_hours: Max age of cached content in hours.
                  0 = always livecrawl (slowest but freshest).
                  Omit = balanced default (cache + livecrawl fallback).
                - include_domains: Only include results from these domains
                - exclude_domains: Exclude results from these domains

                If results exceed ~1000 tokens they are saved to /tmp/ and
                a summary + file path is returned instead.
            "#}
            .to_string(),
            schema_value.as_object().unwrap().clone(),
        )
        .annotate(ToolAnnotations::from_raw(
            Some("Web Search".to_string()),
            Some(true),
            Some(true),
            Some(true),
            Some(false),
        ))]
    }
}

fn truncate_summary(text: &str, max: usize) -> &str {
    if text.len() <= max {
        text
    } else {
        let cutoff = text.char_indices()
            .take(max)
            .last()
            .map(|(i, _)| i)
            .unwrap_or(0);
        &text[..cutoff]
    }
}

#[async_trait]
impl McpClientTrait for WebSearchClient {
    async fn list_tools(
        &self,
        _session_id: &str,
        _next_cursor: Option<String>,
        _cancellation_token: CancellationToken,
    ) -> Result<ListToolsResult, Error> {
        Ok(ListToolsResult {
            tools: Self::get_tools(),
            next_cursor: None,
            meta: None,
        })
    }

    async fn call_tool(
        &self,
        _ctx: &ToolCallContext,
        name: &str,
        arguments: Option<JsonObject>,
        _cancellation_token: CancellationToken,
    ) -> Result<CallToolResult, Error> {
        match name {
            "web_search" => {
                let value = arguments.map(Value::Object).unwrap_or(Value::Null);

                let params: WebSearchParams = match serde_json::from_value(value) {
                    Ok(p) => p,
                    Err(e) => {
                        return Ok(CallToolResult::error(vec![Content::text(format!(
                            "Error: Invalid parameters: {e}"
                        ))]));
                    }
                };

                match self.handle_search(params).await {
                    Ok(result) => Ok(result),
                    Err(msg) => Ok(CallToolResult::error(vec![Content::text(format!(
                        "Error: {msg}"
                    ))])),
                }
            }
            _ => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: Unknown tool: {name}"
            ))])),
        }
    }

    fn get_info(&self) -> Option<&InitializeResult> {
        Some(&self.info)
    }
}
