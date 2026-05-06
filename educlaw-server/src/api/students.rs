// educlaw-server/src/api/students.rs
//
// POST /students        — create student (admin)
// GET  /students        — list all students (admin)
// GET  /students/:id    — get one student by id (admin)
// GET  /me/token-balance — get current student's token balance (auth required)

use std::path::PathBuf;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{self, bearer_token};
use crate::db::students::{self, Student};
use crate::error::{AppError, Result};

use super::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/students", post(create_student))
        .route("/students", get(list_students))
        .route("/students/:id", get(get_student))
        .route("/me/token-balance", get(get_my_token_balance))
}

// Recursively copy directory and all contents
fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let file_name = entry.file_name();
        let dst_path = dst.join(&file_name);
        
        if ty.is_dir() {
            copy_dir_all(&src_path.into(), &dst_path.into())?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
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

    let student = Student {
        id: Uuid::new_v4().to_string(),
        username: body.username,
        password_hash,
        display_name: body.display_name,
        role: body.role.unwrap_or_else(|| "student".to_string()),
        cohort_id: body.cohort_id.unwrap_or_default(),
        uid_slot: None,
        created_at: String::new(), // set by DB DEFAULT
        last_seen: None,
        token_limit: None,
        token_balance: 0,
        token_block_banner: None,
        token_blocked_at: None,
        last_model: None,
    };

    students::insert_student(&state.pool, &student).await?;

    // Copy goose config template to student's persistent directory
    let student_dir = PathBuf::from(&state.students_root).join(&student.username);
    let goose_template = PathBuf::from("/srv/educraw/templates/goose-config/config");
    let goose_dst = student_dir.join("config");

    if goose_template.exists() {
        if let Err(e) = copy_dir_all(&goose_template, &goose_dst) {
            tracing::warn!(
                student_id = %student.id,
                error = %e,
                "failed to copy goose config template"
            );
        } else {
            // Set file permissions: config.yaml 644, secrets.yaml 600
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(goose_dst.join("config.yaml"), std::fs::Permissions::from_mode(0o644));
                let _ = std::fs::set_permissions(goose_dst.join("secrets.yaml"), std::fs::Permissions::from_mode(0o600));
            }
        }
    } else {
        tracing::warn!(
            path = %goose_template.display(),
            "goose config template not found at /srv/educraw/templates/goose-config/config"
        );
    }

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
