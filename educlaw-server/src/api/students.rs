// educlaw-server/src/api/students.rs
//
// POST /students        — create student (admin)
// GET  /students        — list all students (admin)
// GET  /students/:id    — get one student by id (admin)
// GET  /me              — get current student's profile
// PATCH /me             — update current student's profile (cohort, password, etc.)
// GET  /me/token-balance — get current student's token balance

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{self, bearer_token};
use crate::db::Student;
use crate::error::{AppError, Result};

use super::{common, AppState};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/students", post(create_student))
        .route("/students", get(list_students))
        .route("/students/:id", get(get_student))
        .route("/me", get(get_me))
        .route("/me", patch(update_me))
        .route("/me/token-balance", get(get_my_token_balance))
        .route("/me/redeem-code", post(redeem_code_handler))
}

// ── Create student ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateStudentRequest {
    username: String,
    password: String,
    display_name: String,
    /// "student" | "teacher" | "admin" — defaults to "student"
    role: Option<String>,
    /// Cohort this student belongs to
    cohort_id: Option<String>,
}

async fn create_student(
    State(state): State<AppState>,
    Json(body): Json<CreateStudentRequest>,
) -> Result<impl IntoResponse> {
    let password_hash = auth::hash_password(&body.password)?;

    let id = Uuid::new_v4().to_string();
    let home_dir = format!("{}_{}", body.username, &id[..8]);

    let student = Student {
        id,
        username: body.username,
        password_hash,
        display_name: body.display_name,
        role: body.role.unwrap_or_else(|| "student".to_string()),
        cohort_id: body.cohort_id.unwrap_or_default(),
        home_dir: Some(home_dir),
        uid_slot: None,
        created_at: String::new(),
        last_seen: None,
        token_limit: None,
        token_balance: 0,
        restriction_message: None,
        restriction_status: None,
        last_model: None,
        last_request_id: None,
        last_request_state: None,
        last_request_started_at: None,
    };

    state.backend.insert_student(&student).await?;

    // Copy goose config template to student's persistent directory
    common::setup_goose_config(&student.id, &state.students_root);

    tracing::info!(
        student_id = %student.id,
        username   = %student.username,
        "student created"
    );

    // password_hash is skipped via #[serde(skip_serializing)]
    Ok((StatusCode::CREATED, Json(student)))
}

// ── List students ─────────────────────────────────────────────────────────

async fn list_students(State(state): State<AppState>) -> Result<impl IntoResponse> {
    let all = state.backend.list_students().await?;
    Ok(Json(all))
}

// ── Get student ───────────────────────────────────────────────────────────

async fn get_student(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse> {
    let student = state.backend.get_student(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {id} not found")))?;
    Ok(Json(student))
}

// ── GET /me/token-balance ────────────────────────────────────────────────

#[derive(Serialize)]
pub struct TokenBalanceResponse {
    pub balance: i64,
}

async fn get_my_token_balance(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;

    let balance = state.backend.get_token_balance(&claims.sub).await?;

    Ok(Json(TokenBalanceResponse { balance }))
}

// ── GET /me ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct MeResponse {
    id: String,
    username: String,
    display_name: String,
    role: String,
    cohort_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cohort_title: Option<String>,
    token_balance: i64,
    available_cohorts: Vec<crate::db::Cohort>,
}

async fn get_me(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse> {
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;

    let me = state.backend.get_me(&claims.sub).await?;

    Ok(Json(me))
}

// ── PATCH /me ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct UpdateMeBody {
    display_name: Option<String>,
    cohort_id: Option<String>,
    current_password: Option<String>,
    new_password: Option<String>,
}

async fn update_me(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpdateMeBody>,
) -> Result<impl IntoResponse> {
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;

    let student = state.backend.get_student(&claims.sub)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {}", claims.sub)))?;

    let new_hash = if let Some(ref new_pw) = body.new_password {
        if new_pw.len() < 6 {
            return Err(AppError::BadRequest(
                "New password must be at least 6 characters".into(),
            ));
        }
        let current_pw = body.current_password.ok_or_else(|| {
            AppError::BadRequest("Current password is required to change password".into())
        })?;
        if !auth::verify_password(&current_pw, &student.password_hash)? {
            return Err(AppError::BadRequest("Current password is incorrect".into()));
        }
        Some(auth::hash_password(new_pw)?)
    } else {
        None
    };

    if let Some(ref cid) = body.cohort_id {
        if !cid.is_empty() {
            if state.backend.get_cohort(cid).await?.is_none() {
                return Err(AppError::BadRequest(format!("Cohort '{}' not found", cid)));
            }
        }
    }

    let updates = serde_json::json!({
        "display_name": body.display_name,
        "cohort_id": body.cohort_id,
        "password_hash": new_hash,
    });
    let result = state.backend.update_me_api(&claims.sub, &updates).await?;

    let student_props = result.get("student")
        .and_then(|v| v.get("properties"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    let updated_cohort_id = student_props.get("cohort_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let subject_ids: Vec<String> = if updated_cohort_id.is_empty() {
        vec![]
    } else {
        state.backend.list_subjects(&updated_cohort_id).await?
            .into_iter()
            .map(|s| s.slug)
            .collect()
    };

    let updated_display_name = student_props.get("display_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let updated_role = student_props.get("role").and_then(|v| v.as_str()).unwrap_or("student");

    let token = state.auth.sign_student_token(
        &claims.sub,
        &updated_role,
        &updated_cohort_id,
        subject_ids.clone(),
    )?;

    tracing::info!(student_id = %claims.sub, "student updated own profile");

    Ok(Json(serde_json::json!({
        "token":        token,
        "display_name": updated_display_name,
        "cohort_id":    updated_cohort_id,
        "subject_ids":  subject_ids,
    })))
}

// ── POST /me/redeem-code ──────────────────────────────────────────────

#[derive(Deserialize)]
struct RedeemCodeBody {
    code: String,
}

async fn redeem_code_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RedeemCodeBody>,
) -> Result<impl IntoResponse> {
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;

    let code = body.code.trim().to_uppercase();
    if code.is_empty() {
        return Err(AppError::BadRequest("code is required".into()));
    }

    let result = state.backend.redeem_code(&code, &claims.sub).await?;
    match result {
        crate::db::RedeemResult::NotFound => {
            return Err(AppError::NotFound(
                "token code not found".into(),
            ));
        }
        crate::db::RedeemResult::AlreadyUsed => {
            return Err(AppError::Conflict(
                "token code already used".into(),
            ));
        }
        crate::db::RedeemResult::Success {
            tokens,
            new_balance,
        } => {
            tracing::info!(student_id = %claims.sub, code = %code, tokens, "student redeemed token code");
            Ok(Json(serde_json::json!({
                "tokens_added": tokens,
                "new_balance": new_balance,
            })))
        }
    }
}
