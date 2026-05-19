// educlaw-server/src/api/admin.rs
//
// Admin REST API
//
// All routes require JWT role == "admin".
// Read-only routes additionally allow role == "teacher".
//
// Students
//   GET    /admin/students              — list all students + active-session flag
//   POST   /admin/students              — create student account
//   PUT    /admin/students/:id          — update display_name / cohort_id / password
// Sessions
//   GET    /admin/sessions              — live sessions with idle_secs
//   DELETE /admin/sessions/:id          — force-terminate a session
// Cohorts
//   GET    /admin/cohorts               — list all cohorts
//   POST   /admin/cohorts               — create a cohort
// Subjects
//   GET    /admin/subjects?cohort_id=   — list subjects (filter by cohort)
//   POST   /admin/subjects              — create a subject (cohort_id + slug required)
// Models

use std::path::Path;

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx;
use uuid::Uuid;

use crate::auth::{bearer_token, hash_password, Claims};
use crate::db::backend::{DbBackend, Student};
use crate::error::{AppError, Result};
use crate::session::broker::now_secs;

use super::{common, AppState};

fn student_home_path(students_root: &str, s: &Student) -> std::path::PathBuf {
    let component = s.home_dir.as_deref().unwrap_or(&s.username);
    std::path::PathBuf::from(students_root).join(component)
}

// ── Router ────────────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    tracing::debug!("[ADMIN-ROUTES] initializing admin routes");
    Router::new()
        // Students - base
        .route("/admin/students", get(list_students).post(create_student))
        // Students - specific sub-routes (MUST come before generic /:id)
        .route("/admin/students/:id/ban", post(ban_student_handler))
        .route("/admin/students/:id/unban", post(unban_student_handler))
        .route("/admin/students/:id/token-usage", get(student_token_usage))
        .route("/admin/students/:id/token-balance", get(get_token_balance))
        .route("/admin/students/:id/topup", post(topup_tokens_handler))
        .route("/admin/students/:id/deduct", post(deduct_tokens_handler))
        .route(
            "/admin/students/:id/token-deductions",
            get(get_token_deductions),
        )
        .route(
            "/admin/students/:id/models",
            get(get_student_models).put(set_student_models_handler),
        )
        .route(
            "/admin/students/:id",
            put(update_student).delete(delete_student),
        )
        // Sessions
        .route("/admin/sessions", get(list_sessions))
        .route("/admin/sessions/:id", delete(terminate_session))
        // Cohorts
        .route("/admin/cohorts", get(list_cohorts).post(create_cohort))
        .route(
            "/admin/cohorts/:id",
            put(update_cohort).delete(delete_cohort),
        )
        // Subjects
        .route(
            "/admin/subjects",
            get(list_subjects_handler).post(create_subject),
        )
        .route(
            "/admin/subjects/:id",
            put(update_subject_handler).delete(delete_subject_handler),
        )
        // Models
        .route("/admin/models", get(list_models).post(create_model))
        .route("/admin/models/:name/multipliers", put(set_model_multipliers))
        .route("/admin/models/:id/specs", put(update_model_specs_handler))
        .route(
            "/admin/models/:id/thinking",
            put(update_thinking_params_handler),
        )
        .route(
            "/admin/models/:id",
            put(update_model).delete(delete_model_handler),
        )
        // Provider schema discovery -- tells the frontend what thinking params
        // each provider supports so the UI can render dynamic controls.
        .route(
            "/admin/provider-schema/:provider",
            get(provider_schema_handler),
        )
        // Token codes
        .route("/admin/token-codes/export", get(export_token_codes))
        .route(
            "/admin/token-codes",
            get(list_token_codes).post(generate_token_codes),
        )
        .route("/admin/token-codes/:id", delete(delete_token_code_handler))
}

// ── Auth guard ────────────────────────────────────────────────────────────

fn claims(state: &AppState, headers: &HeaderMap) -> Result<Claims> {
    let token = bearer_token(headers).ok_or_else(|| {
        tracing::warn!("[AUTH] no bearer token found in headers");
        AppError::Unauthorized
    })?;
    tracing::debug!("[AUTH] extracting claims from bearer token");
    let claims = state.auth.verify(token)?;
    tracing::debug!(
        "[AUTH] claims extracted: sub={}, role={}",
        claims.sub,
        claims.role
    );
    Ok(claims)
}

fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<Claims> {
    let c = claims(state, headers)?;
    tracing::debug!("[AUTH-ADMIN] checking role: {} == admin?", c.role);
    if c.role != "admin" {
        tracing::warn!("[AUTH-ADMIN] forbidden: user role is {} not admin", c.role);
        return Err(AppError::Forbidden);
    }
    tracing::debug!("[AUTH-ADMIN] admin check passed");
    Ok(c)
}

fn require_staff(state: &AppState, headers: &HeaderMap) -> Result<Claims> {
    let c = claims(state, headers)?;
    tracing::debug!(
        "[AUTH-STAFF] checking role: {} in [admin, teacher]?",
        c.role
    );
    if c.role != "admin" && c.role != "teacher" {
        tracing::warn!(
            "[AUTH-STAFF] forbidden: user role is {} not admin/teacher",
            c.role
        );
        return Err(AppError::Forbidden);
    }
    tracing::debug!("[AUTH-STAFF] staff check passed");
    Ok(c)
}

// ── GET /admin/students ───────────────────────────────────────────────────

#[derive(Serialize)]
struct StudentView {
    id: String,
    username: String,
    display_name: String,
    role: String,
    cohort_id: String,
    last_seen: Option<String>,
    has_active_session: bool,
    token_limit: Option<i64>,
    token_balance: i64,
    restriction_status: Option<String>,
    restriction_message: Option<String>,
}

async fn list_students(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_staff(&state, &headers)?;

    let rows = state.backend.list_students().await?;

    let live: std::collections::HashSet<String> = state
        .broker
        .list_entries()
        .await
        .into_iter()
        .map(|(sid, _)| sid)
        .collect();

    let active_sessions = state.backend.list_active_sessions().await?;
    let active_student_ids: std::collections::HashSet<String> = active_sessions
        .iter()
        .filter(|s| live.contains(&s.id))
        .map(|s| s.student_id.clone())
        .collect();

    let views: Vec<StudentView> = rows
        .into_iter()
        .map(|s| StudentView {
            has_active_session: active_student_ids.contains(&s.id),
            id: s.id,
            username: s.username,
            display_name: s.display_name,
            role: s.role,
            cohort_id: s.cohort_id,
            last_seen: s.last_seen,
            token_limit: s.token_limit,
            token_balance: s.token_balance,
            restriction_status: s.restriction_status.clone(),
            restriction_message: s.restriction_message.clone(),
        })
        .collect();

    Ok(Json(views))
}

// ── POST /admin/students ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateStudentBody {
    username: String,
    password: String,
    display_name: String,
    role: Option<String>,
    cohort_id: Option<String>,
}

async fn create_student(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateStudentBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;

    let password_hash = hash_password(&body.password)?;

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
    };

    state.backend.insert_student(&student).await?;

    common::setup_goose_config(&student.id, &state.students_root);

    tracing::info!(student_id = %student.id, username = %student.username, "admin: student created");
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "id": student.id })),
    ))
}

// ── PUT /admin/students/:id ───────────────────────────────────────────────

#[derive(Deserialize)]
struct UpdateStudentBody {
    display_name: Option<String>,
    cohort_id: Option<String>,
    new_password: Option<String>,
}

async fn update_student(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<UpdateStudentBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;

    state.backend.get_student(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {id}")))?;

    let new_hash = body
        .new_password
        .as_deref()
        .map(hash_password)
        .transpose()?;

    let updates = serde_json::json!({
        "display_name": body.display_name,
        "cohort_id": body.cohort_id,
        "password_hash": new_hash,
    });
    state.backend.update_me_api(&id, &updates).await?;

    tracing::info!(student_id = %id, "admin: student updated");
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_student(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;
    let student = state.backend.get_student(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {id}")))?;

    let home_path = student_home_path(&state.students_root, &student);
    if home_path.exists() {
        if let Err(e) = std::fs::remove_dir_all(&home_path) {
            tracing::warn!(student_id = %id, path = %home_path.display(), error = %e, "failed to remove student home directory");
        }
    }

    let uuid_path = std::path::PathBuf::from(&state.students_root).join(&student.id);
    if uuid_path.exists() {
        if let Err(e) = std::fs::remove_dir_all(&uuid_path) {
            tracing::warn!(student_id = %id, path = %uuid_path.display(), error = %e, "failed to remove student UUID directory");
        }
    }

    state.backend.delete_student(&id).await?;
    tracing::info!(student_id = %id, "admin: student deleted");
    Ok(StatusCode::NO_CONTENT)
}

// ── GET /admin/sessions ───────────────────────────────────────────────────

#[derive(Serialize)]
struct SessionView {
    id: String,
    student_id: String,
    state: String,
    namespace_pid: Option<i64>,
    idle_secs: Option<u64>,
    started_at: String,
}

async fn list_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_staff(&state, &headers)?;

    let db_sessions = state.backend.list_active_sessions().await?;
    let live: std::collections::HashMap<String, u64> =
        state.broker.list_entries().await.into_iter().collect();

    let now = now_secs();
    let views: Vec<SessionView> = db_sessions
        .into_iter()
        .filter(|s| live.contains_key(&s.id))
        .map(|s| {
            let idle_secs = live.get(&s.id).map(|&last| now.saturating_sub(last));
            SessionView {
                idle_secs,
                id: s.id,
                student_id: s.student_id,
                state: s.state,
                namespace_pid: s.namespace_pid,
                started_at: s.started_at,
            }
        })
        .collect();

    Ok(Json(views))
}

async fn terminate_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;

    let session = state.backend.get_session(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {id}")))?;

    if let Some(pid) = session.namespace_pid {
        crate::session::namespace::kill_process_tree(pid, 5).await;
    }

    if !crate::session::namespace::umount_overlay(std::path::Path::new(&session.overlay_mount)).await {
        tracing::warn!(session_id = %id, "admin: overlay umount failed — cleanup may fail");
    }
    state.backend.set_session_state(&id, "ended").await?;
    state.broker.remove_entry(&id).await;
    crate::session::dirs::cleanup_session_dir(&state.workspace_root, &id);
    crate::security::cgroups::teardown_session_cgroup(&id).await;

    tracing::info!(session_id = %id, "admin: session force-terminated");
    Ok(StatusCode::NO_CONTENT)
}

// ── GET /admin/cohorts ────────────────────────────────────────────────────

async fn list_cohorts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_staff(&state, &headers)?;
    let rows = state.backend.list_cohorts().await?;
    Ok(Json(rows))
}

// ── POST /admin/cohorts ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateCohortBody {
    /// Human-readable slug used as the cohort ID, e.g. "primary-2b", "year-5a".
    /// Alphanumeric, dashes, underscores only.
    slug: String,
    title: String,
}

async fn create_cohort(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateCohortBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;

    if body.slug.is_empty()
        || !body
            .slug
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::BadRequest(
            "cohort slug must be non-empty alphanumeric/dash/underscore".into(),
        ));
    }

    let cohort = crate::db::backend::Cohort {
        id: body.slug.clone(),
        title: body.title,
        created_at: String::new(),
    };
    state.backend.insert_cohort(&cohort).await?;

    tracing::info!(cohort_id = %cohort.id, "admin: cohort created");
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "id": cohort.id })),
    ))
}

// ── PUT /admin/cohorts/:id ────────────────────────────────────────────────

#[derive(Deserialize)]
struct UpdateCohortBody {
    /// New slug (becomes the new PK / directory name). Optional — omit to keep current.
    new_slug: Option<String>,
    title: String,
}

async fn update_cohort(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<UpdateCohortBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;

    state.backend.get_cohort(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("cohort {id}")))?;

    let new_slug = body.new_slug.as_deref().unwrap_or(&id);

    if new_slug.is_empty()
        || !new_slug
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::BadRequest(
            "slug must be alphanumeric/dash/underscore".into(),
        ));
    }

    let subjects_root = std::env::var("EDUCLAW_SUBJECTS_ROOT")
        .unwrap_or_else(|_| "/srv/educlaw/data/subjects".to_string());

    if new_slug != id {
        let old_dir = Path::new(&subjects_root).join(&id);
        let new_dir = Path::new(&subjects_root).join(new_slug);
        if old_dir.exists() {
            tokio::fs::rename(&old_dir, &new_dir)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("rename cohort dir: {e}")))?;
        }
        state.backend.rename_cohort(&id, new_slug, &body.title).await?;
    } else {
        state.backend.update_cohort_title(&id, &body.title).await?;
    }

    tracing::info!(old_id = %id, new_id = %new_slug, "admin: cohort updated");
    Ok(Json(serde_json::json!({ "id": new_slug })))
}

async fn delete_cohort(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;

    state.backend.get_cohort(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("cohort {id}")))?;

    let subjects_root = std::env::var("EDUCLAW_SUBJECTS_ROOT")
        .unwrap_or_else(|_| "/srv/educlaw/data/subjects".to_string());
    let cohort_dir = Path::new(&subjects_root).join(&id);
    if cohort_dir.exists() {
        tokio::fs::remove_dir_all(&cohort_dir)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("remove cohort dir: {e}")))?;
    }

    state.backend.delete_cohort(&id).await?;
    tracing::info!(cohort_id = %id, "admin: cohort deleted");
    Ok(StatusCode::NO_CONTENT)
}

// ── GET /admin/subjects?cohort_id= ───────────────────────────────────────

#[derive(Deserialize)]
struct ListSubjectsQuery {
    cohort_id: Option<String>,
}

async fn list_subjects_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ListSubjectsQuery>,
) -> Result<impl IntoResponse> {
    require_staff(&state, &headers)?;
    let cohort_id = q.cohort_id.as_deref().unwrap_or("");
    let rows = state.backend.list_subjects(cohort_id).await?;
    Ok(Json(rows))
}

// ── POST /admin/subjects ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateSubjectBody {
    cohort_id: String,
    slug: String,
    title: String,
}

async fn create_subject(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateSubjectBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;

    if body.slug.is_empty()
        || !body
            .slug
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::BadRequest(
            "slug must be non-empty alphanumeric/dash/underscore".into(),
        ));
    }

    let subject = crate::db::backend::Subject {
        id: Uuid::new_v4().to_string(),
        cohort_id: body.cohort_id.clone(),
        slug: body.slug.clone(),
        title: body.title,
        created_at: String::new(),
    };
    state.backend.insert_subject(&subject).await?;

    let subjects_root = std::env::var("EDUCLAW_SUBJECTS_ROOT")
        .unwrap_or_else(|_| "/srv/educlaw/data/subjects".to_string());
    let subject_dir = Path::new(&subjects_root)
        .join(&subject.cohort_id)
        .join(&subject.slug);
    tokio::fs::create_dir_all(&subject_dir)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("create subject dir: {e}")))?;

    let meta = serde_json::json!({
        "id": subject.id,
        "cohort_id": subject.cohort_id,
        "slug": subject.slug,
        "title": subject.title,
    });
    tokio::fs::write(subject_dir.join("subject.json"), meta.to_string())
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("write subject.json: {e}")))?;

    tracing::info!(
        subject_id = %subject.id,
        cohort_id = %subject.cohort_id,
        slug = %subject.slug,
        title = %subject.title,
        "admin: subject created"
    );
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "id": subject.id, "slug": subject.slug })),
    ))
}

// ── PUT /admin/subjects/:id ───────────────────────────────────────────────

#[derive(Deserialize)]
struct UpdateSubjectBody {
    /// New slug. Optional — omit to keep current slug.
    new_slug: Option<String>,
    title: String,
}

async fn update_subject_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<UpdateSubjectBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;

    let subject = state.backend.get_subject(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("subject {id}")))?;

    let new_slug = body.new_slug.as_deref().unwrap_or(&subject.slug);

    if new_slug.is_empty()
        || !new_slug
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::BadRequest(
            "slug must be alphanumeric/dash/underscore".into(),
        ));
    }

    let subjects_root = std::env::var("EDUCLAW_SUBJECTS_ROOT")
        .unwrap_or_else(|_| "/srv/educlaw/data/subjects".to_string());

    if new_slug != subject.slug {
        let old_dir = Path::new(&subjects_root)
            .join(&subject.cohort_id)
            .join(&subject.slug);
        let new_dir = Path::new(&subjects_root)
            .join(&subject.cohort_id)
            .join(new_slug);
        if old_dir.exists() {
            tokio::fs::rename(&old_dir, &new_dir)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("rename subject dir: {e}")))?;
        }
    }

    let subject_dir = Path::new(&subjects_root)
        .join(&subject.cohort_id)
        .join(new_slug);
    if subject_dir.exists() {
        let meta = serde_json::json!({
            "id": id,
            "cohort_id": subject.cohort_id,
            "slug": new_slug,
            "title": body.title,
        });
        let _ = tokio::fs::write(subject_dir.join("subject.json"), meta.to_string()).await;
    }

    state.backend.update_subject(&id, new_slug, &body.title).await?;

    tracing::info!(subject_id = %id, new_slug = %new_slug, "admin: subject updated");
    Ok(Json(serde_json::json!({ "id": id, "slug": new_slug })))
}

async fn delete_subject_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;

    let subject = state.backend.get_subject(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("subject {id}")))?;

    let subjects_root = std::env::var("EDUCLAW_SUBJECTS_ROOT")
        .unwrap_or_else(|_| "/srv/educlaw/data/subjects".to_string());
    let subject_dir = Path::new(&subjects_root)
        .join(&subject.cohort_id)
        .join(&subject.slug);
    if subject_dir.exists() {
        tokio::fs::remove_dir_all(&subject_dir)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("remove subject dir: {e}")))?;
    }

    state.backend.delete_subject(&id).await?;
    tracing::info!(subject_id = %id, "admin: subject deleted");
    Ok(StatusCode::NO_CONTENT)
}

// ── GET /admin/models ─────────────────────────────────────────────────────

async fn list_models(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_staff(&state, &headers)?;
    let rows = state.backend.list_models().await?;
    Ok(Json(rows))
}

// ── POST /admin/models ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateModelBody {
    /// API model identifier, e.g. "claude-opus-4-6" or "grok-3".
    name: String,
    /// Human-readable label shown in the UI, e.g. "Claude Opus 4.6".
    display_name: String,
    /// Input token deduction multiplier (e.g., 1.0, 2.5, 3.33). Defaults to 1.0 if absent.
    #[serde(default = "default_multiplier")]
    input_multiplier: f64,
    /// Output token deduction multiplier (e.g., 1.0, 2.5, 3.33). Defaults to 1.0 if absent.
    #[serde(default = "default_multiplier")]
    output_multiplier: f64,
}

fn default_multiplier() -> f64 {
    1.0
}

async fn create_model(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateModelBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;
    if body.name.is_empty() {
        return Err(AppError::BadRequest("model name must not be empty".into()));
    }
    if body.input_multiplier < 0.0 || body.output_multiplier < 0.0 {
        return Err(AppError::BadRequest(
            "multipliers must be non-negative".into(),
        ));
    }
    let id = state.backend.insert_model(
        &body.name,
        &body.display_name,
        body.input_multiplier,
        body.output_multiplier,
    )
    .await?;
    tracing::info!(
        model_name = %body.name,
        input_multiplier = body.input_multiplier,
        output_multiplier = body.output_multiplier,
        "admin: model created"
    );
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "name": body.name,
            "display_name": body.display_name,
            "input_multiplier": body.input_multiplier,
            "output_multiplier": body.output_multiplier,
            "enabled": 1,
        })),
    ))
}

// ── PUT /admin/models/:id ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct UpdateModelBody {
    enabled: bool,
}

#[derive(Deserialize)]
struct UpdateModelSpecsBody {
    provider: Option<String>,
    think_mode: Option<i64>,
    visual_support: i64,
}

#[derive(Deserialize)]
struct UpdateThinkingBody {
    thinking_params: Option<serde_json::Value>,
}

async fn update_model(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<UpdateModelBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;
    state.backend.set_enabled(&id, body.enabled).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn update_model_specs_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<UpdateModelSpecsBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;
    state.backend.update_model_specs(
        &id,
        body.provider.as_deref(),
        body.think_mode,
        body.visual_support,
    )
    .await?;
    tracing::info!(model_id = %id, provider = ?body.provider, "admin: model specs updated");
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_model_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;
    state.backend.delete_model(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn update_thinking_params_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<UpdateThinkingBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;

    let params_str = match &body.thinking_params {
        Some(v) if v.is_null() => None,
        Some(v) => {
            if !v.is_object() {
                return Err(AppError::BadRequest(
                    "thinking_params must be a JSON object".into(),
                ));
            }
            Some(
                serde_json::to_string(v)
                    .map_err(|e| AppError::BadRequest(format!("invalid JSON: {e}")))?,
            )
        }
        None => None,
    };

    state.backend.update_thinking_params(&id, params_str.as_deref()).await?;
    tracing::info!(model_id = %id, has_params = params_str.is_some(), "admin: thinking params updated");
    Ok(StatusCode::NO_CONTENT)
}

// ── GET /admin/provider-schema/:provider ──────────────────────────────────
//
// Returns the configurable thinking parameters for a given provider.
// This is the single source of truth that the frontend uses to render
// dynamic controls. When a new provider or param is added, update this
// function — no frontend changes needed.

#[derive(Serialize)]
struct ConfigParamDef {
    key: String,
    #[serde(rename = "type")]
    param_type: String, // "select" | "integer"
    #[serde(skip_serializing_if = "Option::is_none")]
    values: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

#[derive(Serialize)]
struct ProviderSchema {
    provider: String,
    params: Vec<ConfigParamDef>,
}

async fn provider_schema_handler(
    AxumPath(provider): AxumPath<String>,
) -> Result<impl IntoResponse> {
    let provider_lower = provider.to_lowercase();

    let params = match provider_lower.as_str() {
        // Anthropic / Databricks share the same thinking config parameters
        "anthropic" | "databricks" => vec![
            ConfigParamDef {
                key: "thinking_type".into(),
                param_type: "select".into(),
                values: Some(vec![
                    "disabled".into(),
                    "enabled".into(),
                    "adaptive".into(),
                ]),
                default: Some(serde_json::json!("adaptive")),
                min: None,
                max: None,
                description: Some(
                    "Controls extended thinking mode. 'adaptive' only on Claude 4.6+ models."
                        .into(),
                ),
            },
            ConfigParamDef {
                key: "budget_tokens".into(),
                param_type: "integer".into(),
                values: None,
                default: Some(serde_json::json!(16000)),
                min: Some(1024),
                max: Some(64000),
                description: Some(
                    "Token budget for thinking. Only used when thinking_type='enabled'.".into(),
                ),
            },
            ConfigParamDef {
                key: "effort".into(),
                param_type: "select".into(),
                values: Some(vec![
                    "low".into(),
                    "medium".into(),
                    "high".into(),
                    "max".into(),
                ]),
                default: Some(serde_json::json!("high")),
                min: None,
                max: None,
                description: Some(
                    "Thinking effort level. Only used when thinking_type='adaptive'.".into(),
                ),
            },
        ],

        // Google Gemini has two different config paths depending on model version
        "google" => vec![
            ConfigParamDef {
                key: "thinking_level".into(),
                param_type: "select".into(),
                values: Some(vec!["low".into(), "high".into()]),
                default: Some(serde_json::json!("low")),
                min: None,
                max: None,
                description: Some(
                    "Thinking level for Gemini 3 models. 'low' or 'high'.".into(),
                ),
            },
            ConfigParamDef {
                key: "thinking_budget".into(),
                param_type: "integer".into(),
                values: None,
                default: Some(serde_json::json!(8192)),
                min: Some(0),
                max: Some(65536),
                description: Some(
                    "Thinking token budget for Gemini 2.5 models.".into(),
                ),
            },
        ],

        // OpenAI uses model name suffix, but we expose reasoning_effort
        // as a param in case future Goose enhancement reads it from request_params
        "openai" => vec![
            ConfigParamDef {
                key: "reasoning_effort".into(),
                param_type: "select".into(),
                values: Some(vec![
                    "none".into(),
                    "low".into(),
                    "medium".into(),
                    "high".into(),
                    "xhigh".into(),
                ]),
                default: Some(serde_json::json!("none")),
                min: None,
                max: None,
                description: Some(
                    "Reasoning effort for OpenAI models. Currently read from model name suffix; request_params support planned.".into(),
                ),
            },
        ],

        // Providers that currently don't support configurable thinking params
        _ => vec![],
    };

    Ok(Json(ProviderSchema {
        provider: provider_lower,
        params,
    }))
}

// ── POST /admin/students/:id/ban ────────────────────────────────────────

#[derive(Deserialize)]
struct BanStudentBody {
    /// Optional message shown to the student when they are restricted.
    message: Option<String>,
}

async fn ban_student_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<BanStudentBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;
    state.backend.get_student(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {id}")))?;
    state.backend.ban_student(&id, body.message.as_deref()).await?;
    tracing::info!(student_id = %id, has_message = body.message.is_some(), "admin: student banned");
    Ok(StatusCode::NO_CONTENT)
}

async fn unban_student_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;
    state.backend.unban_student(&id).await?;
    tracing::info!(student_id = %id, "admin: student unbanned");
    Ok(StatusCode::NO_CONTENT)
}

async fn get_student_models(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    tracing::debug!("[GET-MODELS] received request for student_id={}", id);
    require_staff(&state, &headers)?;
    let models = state.backend.raw_assignments_for_student(&id).await?;
    tracing::debug!(
        "[GET-MODELS] returning {} models for student_id={}",
        models.len(),
        id
    );
    Ok(Json(serde_json::json!({ "models": models })))
}

#[derive(Deserialize)]
struct SetStudentModelsBody {
    models: Vec<String>,
}

async fn set_student_models_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<SetStudentModelsBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;
    state.backend.set_student_models(&id, &body.models).await?;
    tracing::info!(student_id = %id, count = body.models.len(), "admin: student models updated");
    Ok(StatusCode::NO_CONTENT)
}

async fn student_token_usage(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_staff(&state, &headers)?;
    let student = state.backend.get_student(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {id}")))?;
    let totals = state.backend.student_total_tokens(&id).await?;
    Ok(Json(serde_json::json!({
        "student_id": id,
        "total_input_tokens": totals.total_input_tokens,
        "total_output_tokens": totals.total_output_tokens,
        "total_cache_creation_tokens": totals.total_cache_creation_tokens,
        "total_cache_read_tokens": totals.total_cache_read_tokens,
        "turn_count": totals.turn_count,
        "token_limit": student.token_limit,
        "restriction_status": student.restriction_status,
        "restriction_message": student.restriction_message,
    })))
}

// ── PUT /admin/models/:name/multipliers ────────────────────────────────

#[derive(Deserialize)]
struct SetMultipliersBody {
    /// Input token deduction multiplier (e.g., 1.0, 2.5, 3.33)
    input_multiplier: f64,
    /// Output token deduction multiplier (e.g., 1.0, 2.5, 3.33)
    output_multiplier: f64,
}

async fn set_model_multipliers(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<SetMultipliersBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;

    if body.input_multiplier < 0.0 || body.output_multiplier < 0.0 {
        return Err(AppError::BadRequest(
            "multipliers must be non-negative".into(),
        ));
    }

    let _ = state.backend.get_model_by_name(&name)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("model {name}")))?;

    state.backend.set_multipliers(
        &name,
        body.input_multiplier,
        body.output_multiplier,
    )
    .await?;
    tracing::info!(
        model = %name,
        input_multiplier = body.input_multiplier,
        output_multiplier = body.output_multiplier,
        "admin: model multipliers updated"
    );
    Ok(Json(serde_json::json!({
        "name": name,
        "input_multiplier": body.input_multiplier,
        "output_multiplier": body.output_multiplier
    })))
}

// ── GET /admin/students/:id/token-balance ──────────────────────────────

#[derive(Serialize)]
struct TokenBalanceResponse {
    student_id: String,
    token_balance: i64,
    token_limit: Option<i64>,
}

async fn get_token_balance(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_staff(&state, &headers)?;

    let student = state.backend.get_student(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {id}")))?;

    Ok(Json(TokenBalanceResponse {
        student_id: id,
        token_balance: student.token_balance,
        token_limit: student.token_limit,
    }))
}

async fn topup_tokens_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<TopupTokensBody>,
) -> Result<impl IntoResponse> {
    tracing::debug!(
        "[TOPUP] received request for student_id={}, amount={}",
        id,
        body.amount
    );

    require_admin(&state, &headers)?;

    if body.amount <= 0 {
        return Err(AppError::BadRequest("amount must be positive".into()));
    }

    let _ = state.backend.get_student(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {id}")))?;

    let new_balance = state.backend.topup_tokens(&id, body.amount).await?;

    tracing::info!(
        student_id = %id,
        amount = body.amount,
        new_balance,
        "admin: tokens topped up"
    );

    Ok(Json(serde_json::json!({
        "student_id": id,
        "tokens_added": body.amount,
        "new_balance": new_balance,
    })))
}

async fn deduct_tokens_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<DeductTokensBody>,
) -> Result<impl IntoResponse> {
    tracing::debug!(
        "[DEDUCT] received request for student_id={}, amount={}",
        id,
        body.amount
    );
    require_admin(&state, &headers)?;

    if body.amount <= 0 {
        return Err(AppError::BadRequest("amount must be positive".into()));
    }

    let _ = state.backend.get_student(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {id}")))?;

    let new_balance = state.backend.deduct_tokens(&id, body.amount).await?;

    tracing::info!(
        student_id = %id,
        amount = body.amount,
        new_balance,
        "admin: tokens deducted"
    );

    Ok(Json(serde_json::json!({
        "student_id": id,
        "tokens_deducted": body.amount,
        "new_balance": new_balance,
    })))
}

// ── GET /admin/students/:id/token-deductions ───────────────────────────

#[derive(Serialize, sqlx::FromRow)]
struct TokenDeductionRecord {
    id: String,
    session_id: String,
    model_name: String,
    input_multiplier: f64,
    output_multiplier: f64,
    input_tokens_used: i64,
    output_tokens_used: i64,
    input_tokens_deducted: i64,
    output_tokens_deducted: i64,
    tokens_used: i64,
    tokens_deducted: i64,
    balance_before: i64,
    balance_after: i64,
    recorded_at: String,
}

async fn get_token_deductions(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_staff(&state, &headers)?;

    let _ = state.backend.get_student(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {id}")))?;

    let rows = state.backend.deduction_history(&id).await?;

    Ok(Json(serde_json::json!({
        "student_id": id,
        "deductions": rows,
        "count": rows.len(),
    })))
}

// ── POST /admin/token-codes ─────────────────────────────────────────────

#[derive(Deserialize)]
struct TopupTokensBody {
    amount: i64,
}

#[derive(Deserialize)]
struct DeductTokensBody {
    amount: i64,
}

#[derive(Deserialize)]
struct GenerateTokenCodesBody {
    tokens: i64,
    count: i64,
}

async fn generate_token_codes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<GenerateTokenCodesBody>,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;
    if body.tokens <= 0 {
        return Err(AppError::BadRequest("tokens must be positive".into()));
    }
    if body.count <= 0 || body.count > 500 {
        return Err(AppError::BadRequest("count must be 1-500".into()));
    }
    let codes = state.backend.generate_codes(body.tokens, body.count).await?;
    tracing::info!(
        tokens = body.tokens,
        count = body.count,
        "admin: generated token codes"
    );
    Ok(Json(serde_json::json!({ "codes": codes })))
}

async fn list_token_codes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse> {
    require_staff(&state, &headers)?;
    let tokens = params.get("tokens").and_then(|v| v.parse::<i64>().ok());
    let used = params.get("used").and_then(|v| match v.as_str() {
        "true" | "1" => Some(true),
        "false" | "0" => Some(false),
        _ => None,
    });
    let codes = state.backend.list_codes(tokens, used).await?;
    Ok(Json(codes))
}

async fn delete_token_code_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    require_admin(&state, &headers)?;
    state.backend.delete_code(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn export_token_codes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse> {
    require_staff(&state, &headers)?;
    let tokens = params
        .get("tokens")
        .and_then(|v| v.parse::<i64>().ok())
        .ok_or_else(|| AppError::BadRequest("tokens query param required".into()))?;
    let codes = state.backend.export_codes(tokens).await?;
    let output = codes
        .into_iter()
        .map(|c| {
            format!(
                "{},{},{},{}",
                c.code,
                c.tokens,
                c.used_by.as_deref().unwrap_or("unused"),
                c.used_at.as_deref().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    Ok((
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/csv; charset=utf-8")],
        format!("code,tokens,used_by,used_at\n{output}"),
    ))
}
