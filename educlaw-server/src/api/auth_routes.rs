// educlaw-server/src/api/auth_routes.rs
//
// POST /auth/login    — student login with username + password → JWT
// POST /auth/register — student self-registration
// POST /auth/token    — dev admin token (guarded by ADMIN_SECRET env var)
// GET  /cohorts       — list all available cohorts (public)

use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::{get, post}, Json, Router};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth;
use crate::db::{cohorts, students, subjects};
use crate::error::{AppError, Result};

use super::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(student_login))
        .route("/auth/register", post(student_register))
        .route("/auth/token", post(dev_admin_token))
        .route("/cohorts", get(list_cohorts_public))
}

// ── Student login ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

async fn student_login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<impl IntoResponse> {
    let student = students::get_student_by_username(&state.pool, &body.username)
        .await?
        .ok_or_else(|| {
            tracing::warn!(username = %body.username, "login: unknown username");
            AppError::Unauthorized
        })?;

    // Constant-time Argon2id verification
    if !auth::verify_password(&body.password, &student.password_hash)? {
        tracing::warn!(username = %body.username, student_id = %student.id, "login: incorrect password");
        return Err(AppError::Unauthorized);
    }

    // Resolve subject slugs for this cohort so they go into the JWT.
    let subject_ids: Vec<String> = if student.cohort_id.is_empty() {
        vec![]
    } else {
        subjects::list_subjects(&state.pool, &student.cohort_id)
            .await?
            .into_iter()
            .map(|s| s.slug)
            .collect()
    };

    let token = state.auth.sign_student_token(
        &student.id,
        &student.role,
        &student.cohort_id,
        subject_ids.clone(),
    )?;

    // Update last_seen (non-fatal)
    let _ = students::touch_last_seen(&state.pool, &student.id).await;

    tracing::info!(username = %body.username, student_id = %student.id, "student logged in");

    Ok(Json(serde_json::json!({
        "token":        token,
        "student_id":   student.id,
        "display_name": student.display_name,
        "role":         student.role,
        "cohort_id":    student.cohort_id,
        "subject_ids":  subject_ids,
    })))
}

// ── Dev admin token ───────────────────────────────────────────────────────

#[derive(Deserialize)]
struct DevTokenRequest {
    secret: String,
}

async fn dev_admin_token(
    State(state): State<AppState>,
    Json(body): Json<DevTokenRequest>,
) -> Result<impl IntoResponse> {
    let expected =
        std::env::var("ADMIN_SECRET").unwrap_or_else(|_| "dev-secret".to_string());
    if body.secret != expected {
        return Err(AppError::Unauthorized);
    }
    let token = state.auth.sign_admin_token()?;
    Ok((StatusCode::OK, Json(serde_json::json!({ "token": token }))))
}

// ── Self-registration ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RegisterRequest {
    display_name: String,
    username: String,
    password: String,
    confirm_password: String,
    cohort_id: Option<String>,
}

async fn student_register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<impl IntoResponse> {
    let username = body.username.trim();
    let display_name = body.display_name.trim();

    // Validation
    if display_name.is_empty() {
        return Err(AppError::BadRequest("Display name is required".into()));
    }
    if username.len() < 3 || username.len() > 64 {
        return Err(AppError::BadRequest("Username must be 3-64 characters".into()));
    }
    if !username.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::BadRequest(
            "Username can only contain letters, numbers, underscores and dashes".into(),
        ));
    }
    if body.password.len() < 6 {
        return Err(AppError::BadRequest("Password must be at least 6 characters".into()));
    }
    if body.password != body.confirm_password {
        return Err(AppError::BadRequest("Passwords do not match".into()));
    }

    // Check username uniqueness
    if students::get_student_by_username(&state.pool, username)
        .await?
        .is_some()
    {
        return Err(AppError::Conflict("Username already taken".into()));
    }

    // Verify cohort_id if provided
    let cohort_id = body.cohort_id.unwrap_or_default();
    if !cohort_id.is_empty() {
        if cohorts::get_cohort(&state.pool, &cohort_id).await?.is_none() {
            return Err(AppError::BadRequest(format!("Cohort '{}' not found", cohort_id)));
        }
    }

    let password_hash = auth::hash_password(&body.password)?;

    let id = Uuid::new_v4().to_string();
    let home_dir = format!("{}_{}", username, &id[..8]);

    let student = students::Student {
        id,
        username: username.to_string(),
        password_hash,
        display_name: display_name.to_string(),
        role: "student".to_string(),
        cohort_id: cohort_id.clone(),
        home_dir: Some(home_dir),
        uid_slot: None,
        created_at: String::new(),
        last_seen: None,
        token_limit: None,
        token_balance: 0,
        token_block_banner: None,
        token_blocked_at: None,
        last_model: None,
    };

    students::insert_student(&state.pool, &student).await?;

    // Resolve subject_ids for the cohort
    let subject_ids: Vec<String> = if cohort_id.is_empty() {
        vec![]
    } else {
        subjects::list_subjects(&state.pool, &cohort_id)
            .await?
            .into_iter()
            .map(|s| s.slug)
            .collect()
    };

    let token = state.auth.sign_student_token(
        &student.id,
        &student.role,
        &student.cohort_id,
        subject_ids.clone(),
    )?;

    tracing::info!(username = %username, student_id = %student.id, "student self-registered");

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "token":        token,
        "student_id":   student.id,
        "display_name": student.display_name,
        "role":         student.role,
        "cohort_id":    student.cohort_id,
        "subject_ids":  subject_ids,
    }))))
}

// ── Public cohort list ─────────────────────────────────────────────────────

async fn list_cohorts_public(
    State(state): State<AppState>,
) -> Result<impl IntoResponse> {
    let rows = cohorts::list_cohorts(&state.pool).await?;
    Ok(Json(rows))
}
