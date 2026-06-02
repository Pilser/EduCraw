// acp_bridge/commands.rs
//
// ACP command handlers for session management.
// These forward ACP requests from the WebSocket to Goose and handle responses.

use sacp::schema::{ForkSessionRequest, ListSessionsRequest, LoadSessionRequest, SessionId};
use sacp::{Agent as SacpAgent, ConnectionTo};
use serde::Serialize;
use std::path::PathBuf;

use super::custom_requests::{
    DeleteSessionRequest, ExportSessionRequest, ImportSessionRequest, ImportSessionResponse,
};
use crate::error::{AppError, Result};

/// Response for list_sessions command
#[derive(Debug, Serialize)]
pub struct SessionListItem {
    pub id: String,
    pub title: Option<String>,
    pub updated_at: Option<String>,
    pub cwd: String,
    pub metadata: Option<serde_json::Value>,
}

/// Response for fork_session command
#[derive(Debug, Serialize)]
pub struct ForkSessionResult {
    pub new_session_id: String,
}

/// Handle ListSessionsRequest: fetch available threads from Goose
pub async fn handle_list_sessions(cx: &ConnectionTo<SacpAgent>) -> Result<Vec<SessionListItem>> {
    let req = ListSessionsRequest::new();
    let resp = cx
        .send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ListSessions ACP error: {e}")))?;

    let items = resp
        .sessions
        .into_iter()
        .map(|info| SessionListItem {
            id: info.session_id.0.to_string(),
            title: info.title,
            updated_at: info.updated_at,
            cwd: info.cwd.display().to_string(),
            metadata: Some(serde_json::to_value(info.meta).unwrap_or_default()),
        })
        .collect();

    Ok(items)
}

/// Handle LoadSessionRequest: load a specific thread and start replay
pub async fn handle_load_session(cx: &ConnectionTo<SacpAgent>, thread_id: String) -> Result<()> {
    let req = LoadSessionRequest::new(SessionId::new(thread_id.clone()), PathBuf::from("."));

    // block_task is safe here: called from the WebSocket receive loop (a plain
    // tokio task), NOT from inside the SACP dispatch loop.  The dispatch loop
    // stays free to deliver the replay SessionNotification events that Goose
    // sends BEFORE it sends the LoadSessionResponse.
    cx.send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("LoadSession ACP error: {e}")))
        .map(|_| ()) // Discard LoadSessionResponse, return ()
}

/// Handle ForkSessionRequest: copy source thread and create new session with forked history
pub async fn handle_fork_session(
    cx: &ConnectionTo<SacpAgent>,
    source_thread_id: String,
) -> Result<ForkSessionResult> {
    // ForkSession copies all messages + metadata from source thread into a new thread
    // Returns new SessionId which can then be loaded to continue conversation
    let req = ForkSessionRequest::new(SessionId::new(source_thread_id), PathBuf::from("."));

    let resp = cx
        .send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ForkSession ACP error: {e}")))?;

    Ok(ForkSessionResult {
        new_session_id: resp.session_id.0.to_string(),
    })
}

/// Handle ExportSessionRequest: export a session as JSON string
pub async fn handle_export_session(
    cx: &ConnectionTo<SacpAgent>,
    session_id: String,
) -> Result<String> {
    let req = ExportSessionRequest { session_id };
    let resp = cx
        .send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ExportSession ACP error: {e}")))?;
    Ok(resp.data)
}

/// Handle DeleteSessionRequest: permanently delete a thread and all its data
pub async fn handle_delete_session(
    cx: &ConnectionTo<SacpAgent>,
    session_id: String,
) -> Result<()> {
    let req = DeleteSessionRequest { session_id };
    cx.send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("DeleteSession ACP error: {e}")))?;
    Ok(())
}

/// Handle ImportSessionRequest: import a session from JSON string
pub async fn handle_import_session(
    cx: &ConnectionTo<SacpAgent>,
    data: String,
) -> Result<ImportSessionResponse> {
    let req = ImportSessionRequest { data };
    let resp = cx
        .send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ImportSession ACP error: {e}")))?;
    Ok(resp)
}

// ═══════════════════════════════════════════════════════════════════════
// Recipe ACP handlers
// ═══════════════════════════════════════════════════════════════════════

use super::custom_requests::{
    ApplyRecipeToSessionRequest, ApplyRecipeToSessionResponse, CreateRecipeRequest,
    CreateRecipeResponse, DeleteRecipeRequest, ExportRecipeRequest, ExportRecipeResponse,
    GenerateFromSessionRequest, GenerateFromSessionResponse, ImportRecipeRequest,
    ImportRecipeResponse, ListRecipesRequest, ListRecipesResponse, ReadRecipeRequest,
    ReadRecipeResponse, RecipeEntry,
};

/// Create a recipe from YAML/JSON content — saved to {projectDir}/.agents/recipes/
pub async fn handle_create_recipe(
    cx: &ConnectionTo<SacpAgent>,
    content: String,
    project_dir: String,
    filename: Option<String>,
) -> Result<CreateRecipeResponse> {
    let req = CreateRecipeRequest { content, filename, project_dir };
    cx.send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("CreateRecipe ACP error: {e}")))
}

/// List discoverable recipes
pub async fn handle_list_recipes(
    cx: &ConnectionTo<SacpAgent>,
    global: Option<bool>,
    project_dir: Option<String>,
) -> Result<ListRecipesResponse> {
    let req = ListRecipesRequest { global, project_dir };
    cx.send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ListRecipes ACP error: {e}")))
}

/// Read a recipe file by path or name
pub async fn handle_read_recipe(
    cx: &ConnectionTo<SacpAgent>,
    path: String,
    project_dir: Option<String>,
) -> Result<ReadRecipeResponse> {
    let req = ReadRecipeRequest { path, project_dir };
    cx.send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ReadRecipe ACP error: {e}")))
}

/// Delete a recipe file
pub async fn handle_delete_recipe(
    cx: &ConnectionTo<SacpAgent>,
    path: String,
) -> Result<()> {
    let req = DeleteRecipeRequest { path };
    cx.send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("DeleteRecipe ACP error: {e}")))?;
    Ok(())
}

/// Export a recipe as deeplink + JSON
pub async fn handle_export_recipe(
    cx: &ConnectionTo<SacpAgent>,
    path: String,
    project_dir: Option<String>,
) -> Result<ExportRecipeResponse> {
    let req = ExportRecipeRequest { path, project_dir };
    cx.send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ExportRecipe ACP error: {e}")))
}

/// Import a recipe from deeplink or JSON — saved to {projectDir}/.agents/recipes/
pub async fn handle_import_recipe(
    cx: &ConnectionTo<SacpAgent>,
    deeplink: Option<String>,
    recipe_json: Option<String>,
    filename: Option<String>,
    project_dir: String,
) -> Result<ImportRecipeResponse> {
    let req = ImportRecipeRequest { deeplink, recipe_json, filename, project_dir };
    cx.send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ImportRecipe ACP error: {e}")))
}

/// Generate a recipe from a session's conversation history via sub-agent spawning
pub async fn handle_generate_from_session(
    cx: &ConnectionTo<SacpAgent>,
    session_id: String,
    project_dir: String,
    instructions: Option<String>,
) -> Result<GenerateFromSessionResponse> {
    let req = GenerateFromSessionRequest { session_id, project_dir, instructions };
    cx.send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("GenerateFromSession ACP error: {e}")))
}

/// Apply a recipe to an active session, persisting recipe metadata + resolved params
pub async fn handle_apply_recipe_to_session(
    cx: &ConnectionTo<SacpAgent>,
    session_id: String,
    recipe_path: String,
    parameter_values: Option<std::collections::HashMap<String, String>>,
    project_dir: Option<String>,
) -> Result<ApplyRecipeToSessionResponse> {
    let req = ApplyRecipeToSessionRequest { session_id, recipe_path, parameter_values, project_dir };
    cx.send_request(req)
        .block_task()
        .await
        .map_err(|e| AppError::Session(format!("ApplyRecipeToSession ACP error: {e}")))
}
