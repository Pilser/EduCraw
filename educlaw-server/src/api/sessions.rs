// educlaw-server/src/api/sessions.rs
//
// POST   /sessions        — create and initialise a student session
// GET    /sessions/:id    — get session status
// DELETE /sessions/:id    — terminate session (SIGTERM + umount)
// POST   /sessions/:id/broadcast — push a message to a session's PTY
// GET    /sessions/:id/models    — list models allowed for this session's student
// PUT    /sessions/:id/model     — switch active model mid-session
// GET    /sessions/:id/token-usage

use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use sacp::schema::NewSessionRequest;

use crate::acp_bridge::init_acp_session;
use crate::auth::bearer_token;
use crate::db::{DbBackend, Session, Student};
use crate::error::{AppError, Result};
use crate::session::{
    broker::now_secs,
    container::{self, collect_subject_dirs},
    dirs::SessionDirs,
    namespace::{cleanup_veth, kill_process_tree, session_ip_block},
    watchdog::{run_watchdog, WatchdogConfig},
};

use super::AppState;

fn student_home_path(students_root: &str, s: &Student) -> std::path::PathBuf {
    let component = s.home_dir.as_deref().unwrap_or(&s.username);
    std::path::PathBuf::from(students_root).join(component)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sessions", post(create_session))
        .route("/sessions/:id", get(get_session))
        .route("/sessions/:id", delete(terminate_session))
        .route("/sessions/:id/spawn", post(spawn_session))
        .route("/sessions/:id/broadcast", post(broadcast_message))
        .route("/sessions/:id/models", get(get_session_models))
        .route("/sessions/:id/model", axum::routing::put(set_model))
        .route("/sessions/:id/token-usage", get(get_token_usage))
}

// ── Create session ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CreateSessionRequest {
    student_id: String,
    model: Option<String>,
    /// Optional: frontend can generate its own session_id (UUID).
    /// Backend validates it's a proper UUID; falls back to random if invalid/missing.
    #[serde(default)]
    session_id: Option<String>,
    /// Does the frontend send a thread_id when creating a new session after session death?
    thread_id: Option<String>,
}

#[derive(Serialize)]
struct CreateSessionResponse {
    session_id: String,
    token: String,
}

async fn create_session(
    State(state): State<AppState>,
    Json(body): Json<CreateSessionRequest>,
) -> Result<impl IntoResponse> {
    tracing::info!(?body, "create_session called");
    let student = state.backend.get_student(&body.student_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {} not found", body.student_id)))?;

    let session_id = body
        .session_id
        .filter(|id| Uuid::parse_str(id).is_ok())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let lower = if student.cohort_id.is_empty() {
        let fallback = std::path::PathBuf::from(&state.subjects_root).join("_empty");
        std::fs::create_dir_all(&fallback)
            .map_err(|e| AppError::Session(format!("failed to create fallback lower dir: {e}")))?;
        fallback
    } else {
        std::path::PathBuf::from(&state.subjects_root).join(&student.cohort_id)
    };
    let upper = student_home_path(&state.students_root, &student);

    let dirs = SessionDirs::new(&state.workspace_root, &session_id, lower, upper);

    dirs.create_all()
        .map_err(|e| AppError::Session(format!("failed to create session dirs: {e}")))?;

    let system_prompt_b64 = {
        let display_name = if student.display_name.trim().is_empty() {
            student.username.clone()
        } else {
            student.display_name.clone()
        };

        let intro = format!(
            "You are a personal AI tutor for {display_name}.\n\
             \n\
             Your student is working on their subjects. Your role is to use\n\
             available resources(docs), and understand institution/school perttern in teaching\n\
             so that you teach them based on their curriculum perttern [We are in DEVELOPMENT SO BE HELPFUL IN DEBUGING].\n\
             \n\
             You have built-in tools: you can run Python, JavaScript (Bun), and bash\n\
             scripts; read files; draw charts; and do calculations. Use them silently\n\
             in service of the student — like a calculator that works off-screen:\n\
             - Run computations or draw plots when it helps explain something. Show\n\
               only the result, never the code, unless the student asks \"how did you\n\
               do that?\"\n\
             - Read subject materials (files, documents) from the workspace before\n\
               answering questions about them.\n\
             - When the student shares their own work, open and read it before commenting.\n\
             \n\
             Language rules (always followed):\n\
             - Never use programming terms, IT jargon, or computing language with the\n\
               student. They are not studying computing.\n\
             - Keep explanations simple and age-appropriate.\n\
             - When the answer needs a number, calculation, or diagram — compute it;\n\
               do not describe what the result would look like instead of showing it.\
            "
        );
        serde_json::to_string(&intro).unwrap_or_default()
    };

    let initial_settings = serde_json::json!({
        "permissions": {
            "deny": [
                "WorkerCreate", "WorkerGet", "WorkerObserve", "WorkerResolveTrust",
                "WorkerAwaitReady", "WorkerSendPrompt", "WorkerRestart", "WorkerTerminate",
                "TeamCreate", "TeamDelete",
                "CronCreate", "CronDelete", "CronList",
                "TodoWrite", "Agent", "Sleep", "SendUserMessage", "AskUserQuestion",
                "TaskCreate", "TaskGet", "TaskList", "TaskStop", "TaskUpdate", "TaskOutput",
                "ListMcpResources", "ReadMcpResource", "McpAuth", "RemoteTrigger",
                "MCP", "TestingPermission",
                "Skill", "PowerShell", "LSP", "Config",
                "EnterPlanMode", "ExitPlanMode", "StructuredOutput"
            ]
        }
    });
    std::fs::write(
        dirs.config.join("settings.json"),
        serde_json::to_string_pretty(&initial_settings).unwrap(),
    )
    .map_err(|e| AppError::Session(format!("failed to write session settings: {e}")))?;

    let default_claw_home = std::env::var("HOME")
        .map(|h| std::path::PathBuf::from(h).join(".claw"))
        .ok();
    if let Some(creds_src) = default_claw_home.map(|h| h.join("credentials.json")) {
        if creds_src.exists() {
            if let Err(e) = std::fs::copy(&creds_src, dirs.config.join("credentials.json")) {
                tracing::warn!(src = %creds_src.display(), error = %e, "could not copy credentials.json into session config");
            }
        }
    }

    let subject_ids: Vec<String> = if student.cohort_id.is_empty() {
        vec![]
    } else {
        state.backend.list_subjects(&student.cohort_id).await?
            .into_iter()
            .map(|s| s.slug)
            .collect()
    };

    let student_json_obj = serde_json::json!({
        "student_id":       student.id,
        "username":         student.username,
        "display_name":     student.display_name,
        "role":             student.role,
        "cohort_id":        student.cohort_id,
        "subject_ids":      subject_ids,
        "session_id":       session_id,
        "system_prompt":      system_prompt_b64,
    });
    let student_json = student_json_obj.to_string();
    std::fs::write(dirs.config.join("student.json"), &student_json)
        .map_err(|e| AppError::Session(format!("failed to write student.json: {e}")))?;

    let effective_model = if let Some(m) = body.model.clone().filter(|m| !m.is_empty()) {
        Some(m)
    } else if let Some(last) = student.last_model.clone().filter(|m| !m.is_empty()) {
        Some(last)
    } else {
        let student_models = state.backend.models_for_student(&student.id)
            .await
            .unwrap_or_default();
        student_models
            .into_iter()
            .next()
            .or_else(|| std::env::var("CLAW_MODEL").ok())
    };
    tracing::info!(
        student_id = %student.id,
        model = ?effective_model,
        "create_session: resolved effective model"
    );
    if effective_model.is_none() {
        tracing::warn!("no model set anywhere; claw will use its compiled default");
    }

    let session = Session {
        id: session_id.clone(),
        student_id: student.id.clone(),
        state: "active".to_string(),
        namespace_pid: None,
        overlay_mount: dirs.merged.display().to_string(),
        model: effective_model.clone(),
        last_input_at: None,
        last_token_checkpoint: 0,
        started_at: String::new(),
        ended_at: None,
    };
    state.backend.insert_session(&session).await?;

    let last_input_at = Arc::new(AtomicU64::new(now_secs()));
    state
        .broker
        .create_entry(&session_id, Arc::clone(&last_input_at))
        .await;
    let idle_secs: u64 = std::env::var("IDLE_TIMEOUT_S")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(900);
    let warn_secs: u64 = std::env::var("WARN_BEFORE_S")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(60);
    tokio::spawn(run_watchdog(
        WatchdogConfig {
            session_id: session_id.clone(),
            overlay_mount: dirs.merged.clone(),
            workspace_root: state.workspace_root.clone(),
            idle_timeout: Duration::from_secs(idle_secs),
            warn_before: Duration::from_secs(warn_secs),
            registry: Some(Arc::clone(&state.registry)),
        },
        Arc::clone(&state.broker),
        state.backend.clone(),
    ));

    let token = state.auth.sign_session_token(
        &student.id,
        &student.role,
        &student.cohort_id,
        subject_ids,
        &session_id,
    )?;

    let _ = state.backend.touch_last_seen(&student.id).await;

    tracing::info!(
        session_id = %session_id,
        student    = %student.display_name,
        "session created"
    );

    Ok((
        StatusCode::CREATED,
        Json(CreateSessionResponse {
            session_id: session_id.clone(),
            token,
        }),
    ))
}

// ── Get session ───────────────────────────────────────────────────────────

async fn get_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse> {
    let session = state.backend.get_session(&session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;
    Ok(Json(session))
}

// ── Set model mid-session ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct SetModelBody {
    model: String,
    /// Optional per-session thinking parameter overrides (JSON object).
    /// e.g. {"thinking_type":"enabled","budget_tokens":8000}
    /// Overrides the defaults stored on the model record in the DB.
    #[serde(default)]
    thinking_params: Option<std::collections::HashMap<String, serde_json::Value>>,
}

/// PUT /sessions/:id/model
/// Updates the model stored in SQLite and writes it to a side-channel file
/// that the running pty_bridge can detect and send as a `/model <name>` command
/// to claw's stdin.
async fn set_model(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<SetModelBody>,
) -> Result<impl IntoResponse> {
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;
    let session = state.backend.get_session(&session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;
    if claims.role == "student" && claims.sub != session.student_id {
        return Err(AppError::Forbidden("not your session".into()));
    }

    let model = body.model.trim().to_string();
    if model.is_empty() {
        return Err(AppError::BadRequest("model must not be empty".to_string()));
    }

    state.backend.set_session_model(&session_id, &model).await?;
    state.backend.set_last_model(&session.student_id, &model).await?;

    let dirs =
        crate::session::dirs::SessionDirs::for_existing_session(&state.workspace_root, &session_id);
    let signal_path = dirs.config.join("pending_model.txt");
    if let Err(e) = std::fs::write(&signal_path, &model) {
        tracing::warn!(session_id = %session_id, error = %e, "Failed to write pending_model.txt");
    }

    if let Some(ref params) = body.thinking_params {
        if !params.is_empty() {
            let thinking_path = dirs.config.join("pending_thinking.json");
            let json_str = serde_json::to_string(params).unwrap_or_default();
            if let Err(e) = std::fs::write(&thinking_path, &json_str) {
                tracing::warn!(session_id = %session_id, error = %e, "Failed to write pending_thinking.json");
            }
            tracing::info!(session_id = %session_id, has_thinking_override = true, "thinking override written");
        }
    }

    tracing::info!(session_id = %session_id, model = %model, "model update requested");
    Ok((StatusCode::NO_CONTENT, ()))
}

// ── Spawn goose for session ────────────────────────────────────────────

#[derive(Deserialize)]
struct SpawnSessionRequest {
    action: SpawnAction,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum SpawnAction {
    Recent,
    New,
}

#[derive(Serialize)]
struct SpawnSessionResponse {
    status: String,
    thread_id: Option<String>,
}

/// POST /sessions/:id/spawn
///
/// Eagerly spawns goose for this session.
/// - `action: "recent"` → resume the most recent thread from HelixDB
/// - `action: "new"`    → create a fresh thread (overwrites recent_thread_id)
///
/// Idempotent: returns immediately if goose is already running.
async fn spawn_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<SpawnSessionRequest>,
) -> Result<impl IntoResponse> {
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;

    let session = state.backend.get_session(&session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

    if claims.role == "student" && claims.sub != session.student_id {
        return Err(AppError::Forbidden("not your session".into()));
    }

    if session.state != "active" {
        return Err(AppError::BadRequest(format!(
            "session {session_id} is not active (state: {})",
            session.state
        )));
    }

    let student_id = session.student_id.clone();

    // Goose already running
    if let Some(managed) = state.registry.get(&session_id).await {
        // action: "new" → create a fresh ACP thread, replacing the old one
        if matches!(body.action, SpawnAction::New) {
            let resp = managed
                .cx
                .send_request(NewSessionRequest::new("/"))
                .block_task()
                .await
                .map_err(|e| AppError::Session(format!("NewSession ACP error: {e}")))?;

            *managed.acp_session_id.lock().await = Some(resp.session_id.clone());

            let new_tid = resp.session_id.0.to_string();

            let _ = state
                .backend
                .set_recent_thread_id(&student_id, &new_tid)
                .await;

            tracing::info!(
                session_id = %session_id,
                thread_id = %new_tid,
                "new thread created via spawn (action=new)"
            );

            return Ok(Json(SpawnSessionResponse {
                status: "ready".to_string(),
                thread_id: Some(new_tid),
            }));
        }

        // action: "recent" → return the current thread
        let thread_id = {
            let guard = managed.acp_session_id.lock().await;
            guard.as_ref().map(|sid| sid.0.to_string())
        };
        return Ok(Json(SpawnSessionResponse {
            status: "already_running".to_string(),
            thread_id,
        }));
    }

    let dirs = SessionDirs::for_existing_session(&state.workspace_root, &session_id);

    // Resolve system_prompt from student.json
    let system_prompt = std::fs::read_to_string(dirs.config.join("student.json"))
        .ok()
        .and_then(|blob| serde_json::from_str::<serde_json::Value>(&blob).ok())
        .and_then(|v| v["system_prompt"].as_str().map(|s| s.to_string()))
        .and_then(|b64| {
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            STANDARD.decode(b64).ok().and_then(|bytes| String::from_utf8(bytes).ok())
        });

    // Resolve env_vars (same list as sse.rs and threads.rs)
    let mut env_vars: Vec<(String, String)> = Vec::new();
    for key in &[
        "HOME", "USER", "PATH", "TERM",
        "XAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
        "GOOGLE_API_KEY", "OPENROUTER_API_KEY",
        "DEEPSEEK_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY",
        "MOONSHOT_API_KEY", "MINIMAX_API_KEY", "NOVITA_API_KEY",
        "NVIDIA_API_KEY", "CEREBRAS_API_KEY", "INCEPTION_API_KEY",
        "OLLAMA_CLOUD_API_KEY", "ZHIPU_API_KEY", "TANZU_AI_API_KEY",
        "TENSORIX_API_KEY", "OVHCLOUD_API_KEY",
        "OPENAI_BASE_URL",
        "GOOSE_EXCLUDED_DIRS",
        "EXA_API_KEY",
    ] {
        if let Ok(val) = std::env::var(key) {
            env_vars.push((key.to_string(), val));
        }
    }

    let model = session.model.clone()
        .filter(|m| !m.is_empty())
        .or_else(|| std::env::var("GOOSE_MODEL").ok());

    let goose_path_root = std::path::PathBuf::from(&state.students_root).join(&student_id);
    let logs_dir = std::path::PathBuf::from(&state.workspace_root)
        .parent()
        .unwrap_or(std::path::Path::new("/data"))
        .join(format!("students/{}", student_id))
        .join(".goose/logs");

    let recent_thread_id = match body.action {
        SpawnAction::Recent => {
            match state.backend.get_recent_thread_id(&student_id).await {
                Ok(Some(tid)) => Some(tid),
                _ => {
                    return Ok(Json(SpawnSessionResponse {
                        status: "no_recent".to_string(),
                        thread_id: None,
                    }));
                }
            }
        }
        SpawnAction::New => None,
    };

    let student = state.backend.get_student(&student_id)
        .await
        .ok()
        .flatten();
    let cohort_id = student.as_ref()
        .map(|s| s.cohort_id.clone())
        .unwrap_or_default();
    let student_workspace = student.map_or_else(
        || std::path::PathBuf::from(&state.students_root).join(&student_id),
        |s| student_home_path(&state.students_root, &s),
    );
    let subject_dirs = collect_subject_dirs(
        std::path::Path::new(&state.subjects_root),
        &cohort_id,
    );

    init_acp_session(
        std::path::PathBuf::from(&state.goose_bin),
        goose_path_root,
        dirs.config.clone(),
        student_workspace,
        std::path::PathBuf::from(&state.jail_tools_host),
        subject_dirs,
        env_vars,
        model,
        state.backend.clone(),
        session_id.clone(),
        student_id,
        logs_dir,
        system_prompt,
        Arc::clone(&state.registry),
        recent_thread_id,
    )
    .await?;

    // Read back thread_id from registry after spawn
    let thread_id = {
        let managed = state.registry.get(&session_id).await;
        match managed {
            Some(m) => {
                let guard = m.acp_session_id.lock().await;
                (*guard).as_ref().map(|sid| sid.0.to_string())
            }
            None => None,
        }
    };

    Ok(Json(SpawnSessionResponse {
        status: "ready".to_string(),
        thread_id,
    }))
}

// ── Token usage summary ───────────────────────────────────────────────────

async fn get_token_usage(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse> {
    let totals = state.backend.session_totals(&session_id).await?;
    Ok(Json(totals))
}

async fn get_session_models(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse> {
    let session = state.backend.get_session(&session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

    if session.state != "active" {
        return Err(AppError::BadRequest(format!(
            "session {session_id} is not active (state: {})",
            session.state
        )));
    }

    let result = state.backend.get_session_models(&session_id).await?;
    Ok(Json(result))
}

// ── Terminate session ─────────────────────────────────────────────────────

async fn terminate_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse> {
    let session = state.backend.get_session(&session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

    if let Some(managed) = state.registry.get(&session_id).await {
        // Container path: kill + delete handles process, mounts, cgroup
        let mut cg = managed.container.lock().await;
        container::kill_and_delete_container(&mut cg);

        // Fallback for old unshare sessions (no container): kill process tree
        if cg.is_none() {
            kill_process_tree(managed.pid as i64, 5).await;
        }

        let mut child_guard = managed.child.lock().await;
        *child_guard = None;
        state.registry.remove(&session_id).await;
    }

    if let Some(pid) = session.namespace_pid {
        kill_process_tree(pid, 5).await;
    }

    // Remove veth pair (needed for both container and unshare sessions)
    let (b1, b2) = session_ip_block(&session_id);
    cleanup_veth(b1, b2).await;

    state.backend.set_session_state(&session_id, "ended").await?;
    state.broker.remove_entry(&session_id).await;
    crate::session::dirs::cleanup_session_dir(&state.workspace_root, &session_id);

    tracing::info!(session_id = %session_id, "session terminated");
    Ok(StatusCode::NO_CONTENT)
}

// ── Broadcast message ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct BroadcastBody {
    message: String,
    /// If true, send to ALL active sessions (teacher/admin only).
    #[serde(default)]
    all: bool,
}

async fn broadcast_message(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<BroadcastBody>,
) -> Result<impl IntoResponse> {
    // Require teacher or admin role.
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let claims = state.auth.verify(token)?;
    if claims.role != "teacher" && claims.role != "admin" {
        return Err(AppError::Forbidden("not your session".into()));
    }

    // Format the banner: ANSI bold yellow, visible on any dark/light terminal.
    let banner = format!("\r\n\x1b[1;33m[EduClaw] {}\x1b[0m\r\n", body.message);
    let bytes = banner.into_bytes();

    if body.all {
        let sessions = state.broker.list_entries().await;
        for (sid, _) in sessions {
            state.broker.write_to_pty(&sid, bytes.clone()).await;
        }
        tracing::info!(from = %claims.sub, "broadcast to all sessions");
    } else {
        state.broker.write_to_pty(&session_id, bytes).await;
        tracing::info!(session_id = %session_id, from = %claims.sub, "broadcast to session");
    }

    Ok(StatusCode::NO_CONTENT)
}

// ── Workspace tree helpers ────────────────────────────────────────────────

/// Build an ASCII tree of the session workspace for inclusion in instructions.md.
///
/// Top-level dirs in `lower` are the subject folders — shown with titles read from
/// `subject.json`.  Files inside each subject are listed (up to 8; "... N more"
/// beyond that).  `subject.json` itself is omitted — it is internal metadata.
///
/// `upper` contains the student's persistent personal files; shown separately after
/// the subject tree (`.claw/` is excluded as it is session config).
fn build_workspace_tree(lower: &std::path::Path, upper: &std::path::Path) -> String {
    let mut lines: Vec<String> =
        vec!["/ (workspace root — subject materials, read-only)".to_string()];

    // Collect subject dirs from lower layer, sorted by name.
    let mut subject_dirs: Vec<std::path::PathBuf> = std::fs::read_dir(lower)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    subject_dirs.sort();

    // Personal files in upper (excluding .claw/)
    let personal: Vec<std::path::PathBuf> = std::fs::read_dir(upper)
        .map(|rd| {
            let mut v: Vec<_> = rd
                .filter_map(|e| e.ok())
                .filter(|e| e.file_name() != ".claw")
                .map(|e| e.path())
                .collect();
            v.sort();
            v
        })
        .unwrap_or_default();

    // All subject dirs use ├── (personal files and .claw/ always follow).
    for subj in subject_dirs.iter() {
        let name = subj.file_name().unwrap_or_default().to_string_lossy();
        let title = read_subject_title(subj).unwrap_or_default();
        let comment = if title.is_empty() {
            String::new()
        } else {
            format!("   ← {title}")
        };
        lines.push(format!("├── {name}/{comment}"));

        // List non-metadata files inside the subject dir.
        let mut files: Vec<_> = std::fs::read_dir(subj)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| e.path().is_file() && e.file_name() != "subject.json")
                    .map(|e| e.path())
                    .collect()
            })
            .unwrap_or_default();
        files.sort();

        let show = files.len().min(8);
        for (j, f) in files.iter().take(show).enumerate() {
            let fc = if j == show - 1 && files.len() <= 8 {
                "└──"
            } else {
                "├──"
            };
            let fname = f.file_name().unwrap_or_default().to_string_lossy();
            lines.push(format!("│   {fc} {fname}"));
        }
        if files.len() > 8 {
            lines.push(format!("│   └── ... {} more file(s)", files.len() - 8));
        }
    }

    // Personal files live at the workspace root (same level as subject dirs).
    for entry in personal.iter().take(20) {
        let n = entry.file_name().unwrap_or_default().to_string_lossy();
        lines.push(format!("├── {n}   ← personal saved file"));
    }
    if personal.len() > 20 {
        lines.push(format!(
            "├── ... {} more personal file(s)",
            personal.len() - 20
        ));
    }

    lines.push("└── .claw/".to_string());

    lines.join("\n")
}

/// Read the human-readable title from a subject's `subject.json`, if present.
fn read_subject_title(subject_dir: &std::path::Path) -> Option<String> {
    let raw = std::fs::read_to_string(subject_dir.join("subject.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v["title"].as_str().map(|s| s.to_string())
}

/// Detect the latest (most recently modified) session in the student's .claw/sessions directory.
/// Returns the session ID if found, or None if no sessions exist.
fn detect_latest_student_session(student_dir: &std::path::Path) -> Option<String> {
    let sessions_dir = student_dir.join(".claw/sessions");

    // Try to read the sessions directory
    let entries = std::fs::read_dir(&sessions_dir).ok()?;

    // Find all .jsonl and .json files, sorted by modification time (newest first)
    let mut session_files: Vec<(std::time::SystemTime, String)> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            let is_session_file = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext == "jsonl" || ext == "json")
                .unwrap_or(false);

            if !is_session_file {
                return None;
            }

            let modified = entry.metadata().ok()?.modified().ok()?;
            let session_id = path.file_stem()?.to_str()?.to_string();

            Some((modified, session_id))
        })
        .collect();

    // Sort by modification time (newest first)
    session_files.sort_by(|a, b| b.0.cmp(&a.0));

    // Return the ID of the most recently modified session
    session_files.into_iter().next().map(|(_, id)| id)
}
