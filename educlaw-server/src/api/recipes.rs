// educlaw-server/src/api/recipes.rs
//
// REST endpoints for recipe management. All routes require a valid
// session-scoped bearer token; claims.session_id must match the path :id.
// Uses the shared `get_managed_session` lazy-init helper so a recipe
// call works even if goose has been dropped from the registry — same
// pattern as the thread endpoints.
//
// GET  /sessions/:id/recipes           — list recipes
// POST /sessions/:id/recipes           — create a recipe (body: content, filename?)
// POST /sessions/:id/recipes/read      — read recipe content (body: path)
// POST /sessions/:id/recipes/delete    — delete recipe (body: path) → 204
// POST /sessions/:id/recipes/export    — export as deeplink + JSON (body: path)
// POST /sessions/:id/recipes/import    — import from deeplink or JSON
// POST /sessions/:id/recipes/apply     — apply recipe to current goose thread
// POST /sessions/:id/recipes/generate  — generate recipe from current goose thread

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::acp_bridge::{
    handle_apply_recipe_to_session, handle_create_recipe, handle_delete_recipe,
    handle_export_recipe, handle_generate_from_session, handle_import_recipe,
    handle_list_recipes, handle_read_recipe,
};
use crate::auth::bearer_token;
use crate::error::{AppError, Result};

use super::common::{get_managed_session, resolve_recipe_project_dir};
use super::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sessions/:id/recipes", get(list_recipes).post(create_recipe))
        .route("/sessions/:id/recipes/read", post(read_recipe))
        .route("/sessions/:id/recipes/delete", post(delete_recipe))
        .route("/sessions/:id/recipes/export", post(export_recipe))
        .route("/sessions/:id/recipes/import", post(import_recipe))
        .route("/sessions/:id/recipes/apply", post(apply_recipe))
        .route("/sessions/:id/recipes/generate", post(generate_recipe))
}

fn require_session_claims(
    state: &AppState,
    headers: &HeaderMap,
    session_id: &str,
) -> Result<()> {
    let token = bearer_token(headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;
    if claims.session_id.as_deref() != Some(session_id) {
        return Err(AppError::Unauthorized);
    }
    Ok(())
}

// ── GET /sessions/:id/recipes ─────────────────────────────────────────────

async fn list_recipes(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_session_claims(&state, &headers, &session_id)?;
    let managed = get_managed_session(&state, &session_id).await?;
    let resp = handle_list_recipes(&managed.cx, None, None).await?;
    Ok(Json(serde_json::json!({ "recipes": resp.recipes })))
}

// ── POST /sessions/:id/recipes ────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateRecipeBody {
    content: String,
    #[serde(default)]
    filename: Option<String>,
    /// Optional override; defaults to the session's merged workspace.
    #[serde(default)]
    project_dir: Option<String>,
}

async fn create_recipe(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<CreateRecipeBody>,
) -> Result<impl IntoResponse> {
    require_session_claims(&state, &headers, &session_id)?;
    let managed = get_managed_session(&state, &session_id).await?;
    let project_dir = body
        .project_dir
        .unwrap_or_else(|| resolve_recipe_project_dir(&state, &session_id));
    let resp =
        handle_create_recipe(&managed.cx, body.content, project_dir, body.filename).await?;
    Ok((StatusCode::CREATED, Json(serde_json::json!(resp))))
}

// ── POST /sessions/:id/recipes/read ───────────────────────────────────────

#[derive(Deserialize)]
struct ReadRecipeBody {
    path: String,
}

async fn read_recipe(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ReadRecipeBody>,
) -> Result<impl IntoResponse> {
    require_session_claims(&state, &headers, &session_id)?;
    let managed = get_managed_session(&state, &session_id).await?;
    let resp = handle_read_recipe(&managed.cx, body.path, None).await?;
    Ok(Json(serde_json::json!(resp)))
}

// ── POST /sessions/:id/recipes/delete ─────────────────────────────────────

#[derive(Deserialize)]
struct DeleteRecipeBody {
    path: String,
}

async fn delete_recipe(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<DeleteRecipeBody>,
) -> Result<impl IntoResponse> {
    require_session_claims(&state, &headers, &session_id)?;
    let managed = get_managed_session(&state, &session_id).await?;
    handle_delete_recipe(&managed.cx, body.path).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── POST /sessions/:id/recipes/export ─────────────────────────────────────

#[derive(Deserialize)]
struct ExportRecipeBody {
    path: String,
}

async fn export_recipe(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ExportRecipeBody>,
) -> Result<impl IntoResponse> {
    require_session_claims(&state, &headers, &session_id)?;
    let managed = get_managed_session(&state, &session_id).await?;
    let resp = handle_export_recipe(&managed.cx, body.path, None).await?;
    Ok(Json(serde_json::json!({
        "deeplink": resp.deeplink,
        "recipe_json": resp.recipe_json,
        "filename": resp.filename,
    })))
}

// ── POST /sessions/:id/recipes/import ─────────────────────────────────────

#[derive(Deserialize)]
struct ImportRecipeBody {
    #[serde(default)]
    deeplink: Option<String>,
    #[serde(default)]
    recipe_json: Option<String>,
    #[serde(default)]
    filename: Option<String>,
    #[serde(default)]
    project_dir: Option<String>,
}

async fn import_recipe(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ImportRecipeBody>,
) -> Result<impl IntoResponse> {
    require_session_claims(&state, &headers, &session_id)?;
    let managed = get_managed_session(&state, &session_id).await?;
    let project_dir = body
        .project_dir
        .unwrap_or_else(|| resolve_recipe_project_dir(&state, &session_id));
    let resp = handle_import_recipe(
        &managed.cx,
        body.deeplink,
        body.recipe_json,
        body.filename,
        project_dir,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(serde_json::json!(resp))))
}

// ── POST /sessions/:id/recipes/apply ──────────────────────────────────────

#[derive(Deserialize)]
struct ApplyRecipeBody {
    recipe_path: String,
    #[serde(default)]
    parameter_values: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    project_dir: Option<String>,
}

async fn apply_recipe(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ApplyRecipeBody>,
) -> Result<impl IntoResponse> {
    require_session_claims(&state, &headers, &session_id)?;
    let managed = get_managed_session(&state, &session_id).await?;
    let thread_id = {
        let guard = managed.acp_session_id.lock().await;
        guard
            .as_ref()
            .ok_or_else(|| AppError::BadRequest("no active goose thread".into()))?
            .0
            .to_string()
    };
    let resp = handle_apply_recipe_to_session(
        &managed.cx,
        thread_id,
        body.recipe_path,
        body.parameter_values,
        body.project_dir,
    )
    .await?;
    Ok(Json(serde_json::json!(resp)))
}

// ── POST /sessions/:id/recipes/generate ───────────────────────────────────

#[derive(Deserialize)]
struct GenerateRecipeBody {
    #[serde(default)]
    instructions: Option<String>,
    #[serde(default)]
    project_dir: Option<String>,
}

async fn generate_recipe(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<GenerateRecipeBody>,
) -> Result<impl IntoResponse> {
    require_session_claims(&state, &headers, &session_id)?;
    let managed = get_managed_session(&state, &session_id).await?;
    let thread_id = {
        let guard = managed.acp_session_id.lock().await;
        guard
            .as_ref()
            .ok_or_else(|| AppError::BadRequest("no active goose thread".into()))?
            .0
            .to_string()
    };
    let project_dir = body
        .project_dir
        .unwrap_or_else(|| resolve_recipe_project_dir(&state, &session_id));
    let resp =
        handle_generate_from_session(&managed.cx, thread_id, project_dir, body.instructions)
            .await?;
    Ok((StatusCode::CREATED, Json(serde_json::json!(resp))))
}
