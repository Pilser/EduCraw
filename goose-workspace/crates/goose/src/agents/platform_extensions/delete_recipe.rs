use crate::agents::extension::PlatformExtensionContext;
use crate::agents::mcp_client::{Error, McpClientTrait};
use crate::agents::tool_execution::ToolCallContext;
use async_trait::async_trait;
use rmcp::model::{
    CallToolResult, Content, Implementation, InitializeResult, JsonObject, ListToolsResult,
    ServerCapabilities, Tool, ToolAnnotations,
};
use schemars::{schema_for, JsonSchema};
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub static EXTENSION_NAME: &str = "delete_recipe";

#[derive(Debug, Deserialize, JsonSchema)]
struct DeleteRecipeToolParams {
    /// Recipe filename stem without extension.
    name: String,
}

pub struct DeleteRecipeClient {
    info: InitializeResult,
    context: Arc<PlatformExtensionContext>,
}

impl DeleteRecipeClient {
    pub fn new(context: PlatformExtensionContext) -> Result<Self, String> {
        let info = InitializeResult::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new(EXTENSION_NAME.to_string(), "1.0.0".to_string())
                    .with_title("Delete Recipe"),
            );

        Ok(Self {
            info,
            context: Arc::new(context),
        })
    }

    fn get_tools() -> Vec<Tool> {
        let schema = schema_for!(DeleteRecipeToolParams);
        let schema_value =
            serde_json::to_value(schema).expect("Failed to serialize DeleteRecipeToolParams schema");

        vec![Tool::new(
            "delete_recipe".to_string(),
            "Delete a recipe from the current project's .agents/recipes/ directory. Only deletes files at root level, not nested subdirectories.",
            schema_value.as_object().unwrap().clone(),
        )
        .annotate(ToolAnnotations::from_raw(
            Some("Delete Recipe".to_string()),
            Some(true),
            Some(true),
            Some(true),
            Some(false),
        ))]
    }

    async fn get_working_dir(&self, session_id: &str) -> Result<std::path::PathBuf, String> {
        self.context
            .session_manager
            .get_session(session_id, false)
            .await
            .map(|s| s.working_dir)
            .map_err(|e| format!("Failed to get session: {e}"))
    }

    async fn handle_delete(
        &self,
        session_id: &str,
        arguments: Option<JsonObject>,
    ) -> Result<CallToolResult, String> {
        let value = arguments.map(serde_json::Value::Object).unwrap_or(serde_json::Value::Null);
        let params: DeleteRecipeToolParams =
            serde_json::from_value(value).map_err(|e| format!("Invalid parameters: {e}"))?;

        if params.name.contains('/') || params.name.contains('\\') || params.name.contains("..") {
            return Err("name must be a simple filename stem, not a path".to_string());
        }

        let working_dir = self.get_working_dir(session_id).await?;
        let base = working_dir.join(".agents").join("recipes");

        if !base.exists() {
            return Err(".agents/recipes/ does not exist".to_string());
        }

        for ext in ["yaml", "json"] {
            let p = base.join(format!("{}.{}", params.name, ext));
            if p.exists() {
                std::fs::remove_file(&p)
                    .map_err(|e| format!("Failed to delete recipe: {e}"))?;
                return Ok(CallToolResult::success(vec![Content::text(format!(
                    "Deleted recipe: {}",
                    p.display()
                ))]));
            }
        }

        Err(format!("Recipe '{}' not found in .agents/recipes/", params.name))
    }
}

#[async_trait]
impl McpClientTrait for DeleteRecipeClient {
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
        ctx: &ToolCallContext,
        name: &str,
        arguments: Option<JsonObject>,
        _cancellation_token: CancellationToken,
    ) -> Result<CallToolResult, Error> {
        match name {
            "delete_recipe" => {
                self.handle_delete(&ctx.session_id, arguments)
                    .await
                    .or_else(|msg| Ok(CallToolResult::error(vec![Content::text(format!("Error: {msg}"))])))
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
