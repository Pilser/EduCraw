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
use crate::db::{
    cohorts,
    students::{self, Student},
    subjects, token_codes,
};
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
        created_at: String::new(), // set by DB DEFAULT
        last_seen: None,
        token_limit: None,
        token_balance: 0,
        restriction_message: None,
        restriction_status: None,
        last_model: None,
    };

    students::insert_student(&state.pool, &student).await?;

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
    let all = students::list_students(&state.pool).await?;
    Ok(Json(all))
}

// ── Get student ───────────────────────────────────────────────────────────

async fn get_student(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse> {
    let student = students::get_student(&state.pool, &id)
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
    // Extract student ID from JWT
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;

    // Get current student's balance
    let student = students::get_student(&state.pool, &claims.sub)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {}", claims.sub)))?;

    Ok(Json(TokenBalanceResponse {
        balance: student.token_balance,
    }))
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
    available_cohorts: Vec<cohorts::Cohort>,
}

async fn get_me(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse> {
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;

    let student = students::get_student(&state.pool, &claims.sub)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {}", claims.sub)))?;

    let cohort_title = if student.cohort_id.is_empty() {
        None
    } else {
        cohorts::get_cohort(&state.pool, &student.cohort_id)
            .await?
            .map(|c| c.title)
    };

    let available_cohorts = cohorts::list_cohorts(&state.pool).await?;

    Ok(Json(MeResponse {
        id: student.id,
        username: student.username,
        display_name: student.display_name,
        role: student.role,
        cohort_id: student.cohort_id,
        cohort_title,
        token_balance: student.token_balance,
        available_cohorts,
    }))
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

    let student = students::get_student(&state.pool, &claims.sub)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {}", claims.sub)))?;

    // Password change: verify current first
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

    // Validate cohort if changing
    if let Some(ref cid) = body.cohort_id {
        if !cid.is_empty() {
            if cohorts::get_cohort(&state.pool, cid).await?.is_none() {
                return Err(AppError::BadRequest(format!("Cohort '{}' not found", cid)));
            }
        }
    }

    students::update_student(
        &state.pool,
        &claims.sub,
        body.display_name.as_deref(),
        body.cohort_id.as_deref(),
        new_hash.as_deref(),
    )
    .await?;

    // Re-read updated student
    let updated = students::get_student(&state.pool, &claims.sub)
        .await?
        .unwrap();

    // Resolve fresh subject_ids
    let subject_ids: Vec<String> = if updated.cohort_id.is_empty() {
        vec![]
    } else {
        subjects::list_subjects(&state.pool, &updated.cohort_id)
            .await?
            .into_iter()
            .map(|s| s.slug)
            .collect()
    };

    // Issue fresh JWT with new cohort/subject_ids
    let token = state.auth.sign_student_token(
        &updated.id,
        &updated.role,
        &updated.cohort_id,
        subject_ids.clone(),
    )?;

    tracing::info!(student_id = %updated.id, "student updated own profile");

    Ok(Json(serde_json::json!({
        "token":        token,
        "display_name": updated.display_name,
        "cohort_id":    updated.cohort_id,
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

    let result = token_codes::redeem_code(&state.pool, &code, &claims.sub).await?;
    match result {
        token_codes::RedeemResult::NotFound => {
            return Err(AppError::BadRequest(
                "Code not found. Please check and try again.".into(),
            ));
        }
        token_codes::RedeemResult::AlreadyUsed => {
            return Err(AppError::BadRequest(
                "This code has already been used.".into(),
            ));
        }
        token_codes::RedeemResult::Success {
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
