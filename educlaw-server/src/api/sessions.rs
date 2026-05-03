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

use crate::db::sessions::{self as db_sess, Session};
use crate::db::{models as db_models, students, subjects, token_usage as db_tokens};
use crate::auth::bearer_token;
use crate::error::{AppError, Result};
use crate::session::{
    broker::now_secs,
    dirs::SessionDirs,
    namespace::{mount_overlay, umount_overlay, spawn_claw_session, SpawnParams},
    watchdog::{run_watchdog, WatchdogConfig},
};

use super::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sessions", post(create_session))
        .route("/sessions/:id", get(get_session))
        .route("/sessions/:id", delete(terminate_session))
        .route("/sessions/:id/broadcast", post(broadcast_message))
        .route("/sessions/:id/models", get(get_session_models))
        .route("/sessions/:id/model", axum::routing::put(set_model))
        .route("/sessions/:id/token-usage", get(get_token_usage))
}

// ── Create session ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateSessionRequest {
    student_id: String,
    model: Option<String>,
}

#[derive(Serialize)]
struct CreateSessionResponse {
    session_id: String,
    ws_url: String,
    token: String,
}

async fn create_session(
    State(state): State<AppState>,
    Json(body): Json<CreateSessionRequest>,
) -> Result<impl IntoResponse> {
    let student = students::get_student(&state.pool, &body.student_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("student {} not found", body.student_id)))?;

    let session_id = Uuid::new_v4().to_string();

    // lower = {subjects_root}/{cohort_id}/{...subject slugs...} — read-only via OverlayFS
    //   cohort.id is a slug (e.g. "primary-2b"), not a UUID — already human-readable.
    // upper = {students_root}/{username}/ — student persistent home, read-write.
    //   username is unique and human-readable; the agent sees paths like
    //   /srv/educlaw/data/students/alice/ instead of an opaque UUID.
    let lower = if student.cohort_id.is_empty() {
        // No cohort assigned: fall back to an empty dir so OverlayFS still mounts cleanly.
        let fallback = std::path::PathBuf::from(&state.subjects_root).join("_empty");
        std::fs::create_dir_all(&fallback)
            .map_err(|e| AppError::Session(format!("failed to create fallback lower dir: {e}")))?;
        fallback
    } else {
        std::path::PathBuf::from(&state.subjects_root).join(&student.cohort_id)
    };
    let upper = std::path::PathBuf::from(&state.students_root).join(&student.username);

    let dirs = SessionDirs::new(&state.workspace_root, &session_id, lower, upper);

    // Prepare filesystem layout
    dirs.create_all()
        .map_err(|e| AppError::Session(format!("failed to create session dirs: {e}")))?;

    // Write student context into the upper (persistent) layer BEFORE OverlayFS mounts.
    // claw reads instructions.md while building the system prompt — before init.sh runs.
    // Writing to upper/ directly means the file appears in merged/ after the mount.
    //
    // We also base64-encode a short tutor intro and store it in student.json so ws.rs
    // can forward it as EDUCLAW_SYSTEM_PROMPT — that replaces claw's hardcoded
    // "software engineering tasks" opening section (section #1 of the system prompt).
    let (instructions_md, system_prompt_b64) = {
        let display_name = if student.display_name.trim().is_empty() {
            student.username.clone()
        } else {
            student.display_name.clone()
        };
        let workspace_path = dirs.merged.display().to_string();

        // ── Layer 1: tutor intro (replaces hardcoded section #1 via env var) ──
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
        // JSON-encode the intro so it is safe as a single env var value (newlines and
        // quotes become \n / \") while remaining readable in logs and student.json.
        let b64 = serde_json::to_string(&intro).unwrap_or_default();

        // ── Layer 2: instructions.md — session context + workspace tree ──
        let tree = build_workspace_tree(&dirs.lower, &dirs.upper);
        let md = format!(
            "## Student context\n\
             - Name: {display_name}\n\
             - Session ID: {session_id}\n\
             {cohort_line}\
             \n\
             ## Workspace layout\n\
             \n\
             {tree}\n\
             \n\
             ## How to use the workspace\n\
             - Subject materials are in the subject folders above (read-only).\n\
             - Use your tools to open files dont wait student to ask you becuse he/she \n\
               might not even know that they exist. Summarise in plain language — do not quote large raw blocks.\n\
             - Use Python,or bash to solve equations, draw diagrams,To open PDF files\n\
               or compute answers. These are your internal tools — show only the result.\n\
             - The student's personal files (if any) are their saved work. Treat with care. Use python to convert pdf to .md in student's root if you want to read it,if it fails Tell Student The file was scanned You cant Read it\n\
             - Working directory: {workspace_path}\n\
             \n\
             ## Image / plot rules\n\
             - Always save plots with `plt.savefig('name.png')` — never use `plt.show()`.\n\
             - Never print, cat, or pipe binary file contents to the terminal.\n\
             - After saving, tell the student the filename so they can view it in this formart for frontend to render it well  ![Title of File](file_name.file-extension). Use this everytime showing any file to Student even if its in subject Folder metods stays the same.\n",
            cohort_line = if student.cohort_id.is_empty() {
                String::new()
            } else {
                format!("- Cohort ID: {}\n", student.cohort_id)
            },
        );

        (md, b64)
    };

    let claw_dir = dirs.upper.join(".claw");
    std::fs::create_dir_all(&claw_dir)
        .map_err(|e| AppError::Session(format!("failed to create .claw dir: {e}")))?;
    std::fs::write(claw_dir.join("instructions.md"), &instructions_md)
        .map_err(|e| AppError::Session(format!("failed to write instructions.md: {e}")))?;

    // Write initial settings.json so claw can configure permissions.
    // init.sh will merge its own keys (systemPrompt, permissionMode) into this.
    //
    // The `permissions.deny` list suppresses tools that are irrelevant for student
    // math/physics sessions so they are never sent to the model in the tools array.
    // Kept: bash, read_file, read_image, write_file, edit_file, glob_search,
    //       grep_search, NotebookEdit, WebFetch, WebSearch, ToolSearch, REPL.
    let initial_settings = serde_json::json!({
        "permissions": {
            "deny": [
                // Worker & Team tools — sub-agent orchestration, not needed for students
                "WorkerCreate", "WorkerGet", "WorkerObserve", "WorkerResolveTrust",
                "WorkerAwaitReady", "WorkerSendPrompt", "WorkerRestart", "WorkerTerminate",
                "TeamCreate", "TeamDelete",
                // Cron / scheduling
                "CronCreate", "CronDelete", "CronList",
                // Task management tools
                "TodoWrite", "Agent", "Sleep", "SendUserMessage", "AskUserQuestion",
                "TaskCreate", "TaskGet", "TaskList", "TaskStop", "TaskUpdate", "TaskOutput",
                // MCP / remote tools
                "ListMcpResources", "ReadMcpResource", "McpAuth", "RemoteTrigger",
                "MCP", "TestingPermission",
                // System / config tools
                "Skill", "PowerShell", "LSP", "Config",
                "EnterPlanMode", "ExitPlanMode", "StructuredOutput"
            ]
        }
    });
    std::fs::write(
        dirs.config.join("settings.json"),
        serde_json::to_string_pretty(&initial_settings).unwrap(),
    ).map_err(|e| AppError::Session(format!("failed to write session settings: {e}")))?;

    // Copy credentials.json from the user's default claw config home so the
    // per-session CLAW_CONFIG_HOME has working API credentials (OAuth token etc.).
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

    // Mount OverlayFS
    mount_overlay(&dirs).await?;

    // Create logs directory for claw diagnostic output
    let logs_dir = dirs.upper.join(".claw/logs");
    std::fs::create_dir_all(&logs_dir)
        .map_err(|e| AppError::Session(format!("failed to create logs directory: {e}")))?;

    // Resolve subject slugs for this cohort
    let subject_ids: Vec<String> = if student.cohort_id.is_empty() {
        vec![]
    } else {
        subjects::list_subjects(&state.pool, &student.cohort_id)
            .await?
            .into_iter()
            .map(|s| s.slug)
            .collect()
    };

    // Build the student JSON blob used for:
    //   - EDUCLAW_STUDENT_JSON env var (init.sh reads this for settings.json)
    //   - student.json on disk (ws.rs re-reads it for each PTY spawn)
    // system_prompt_b64 is included so ws.rs can forward EDUCLAW_SYSTEM_PROMPT.
    // cohort_id and subject_ids are included for MCP access control;
    // init.sh must NOT include subject_ids in the system prompt.

    // Write student.json to config dir so ws.rs can forward EDUCLAW_STUDENT_JSON
    // and EDUCLAW_SYSTEM_PROMPT to the interactive PTY spawn.
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

    // Model priority (highest → lowest):
    //   1. request body `model` field
    //   2. first model in the student's DB-assigned model list
    //   3. first globally-enabled model in the `models` table
    //   4. CLAW_MODEL env var
    // This ensures the student's UI-selected model (or the DB default) is used
    // instead of always deferring to the server-wide CLAW_MODEL env var.
    let effective_model = if let Some(m) = body.model.clone().filter(|m| !m.is_empty()) {
        Some(m)
    } else {
        let student_models = db_models::models_for_student(&state.pool, &student.id).await
            .unwrap_or_default();
        student_models.into_iter().next()
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

    // Persist session record
    let session = Session {
        id: session_id.clone(),
        student_id: student.id.clone(),
        state: "active".to_string(),
        namespace_pid: None,
        overlay_mount: dirs.merged.display().to_string(),
        model: effective_model.clone(),
        last_input_at: None,
        started_at: String::new(), // set by DB DEFAULT
        ended_at: None,
    };
    db_sess::insert_session(&state.pool, &session).await?;

    // Create broker entry + spawn idle watchdog
    let last_input_at = Arc::new(AtomicU64::new(now_secs()));
    state.broker.create_entry(&session_id, Arc::clone(&last_input_at)).await;
    let idle_secs: u64 = std::env::var("IDLE_TIMEOUT_S")
        .ok().and_then(|s| s.parse().ok()).unwrap_or(900);
    let warn_secs: u64 = std::env::var("WARN_BEFORE_S")
        .ok().and_then(|s| s.parse().ok()).unwrap_or(60);
    tokio::spawn(run_watchdog(
        WatchdogConfig {
            session_id: session_id.clone(),
            overlay_mount: dirs.merged.clone(),
            idle_timeout: Duration::from_secs(idle_secs),
            warn_before:  Duration::from_secs(warn_secs),
        },
        Arc::clone(&state.broker),
        state.pool.clone(),
    ));

    // Spawn claw inside an unshare namespace; record the PID for Shell MCP nsenter.
    let mcp_socket = std::env::var("EDUCLAW_MCP_SOCKET")
        .unwrap_or_else(|_| "127.0.0.1:9000".to_string());

    // Detect if student has a prior session to resume
    let mut env_vars = vec![
        ("EDUCLAW_MCP_SOCKET".to_string(), mcp_socket),
        ("EDUCLAW_SYSTEM_PROMPT".to_string(), system_prompt_b64.clone()),
        ("EDUCLAW_STRUCTURED_OUTPUT".to_string(), "1".to_string()),  // Enable OSC diagnostics
        // Force matplotlib to use the non-interactive Agg backend so plt.show()
        // never blocks waiting for a GUI display that doesn't exist.
        ("MPLBACKEND".to_string(), "Agg".to_string()),
        // Pass log file path to claw so it can write diagnostics
        ("CLAW_LOG_FILE".to_string(), logs_dir.join("claw.log").display().to_string()),
    ];
    
    if let Some(latest_session_id) = detect_latest_student_session(&dirs.upper) {
        env_vars.push(("CLAW_LOAD_SESSION".to_string(), latest_session_id.clone()));
        tracing::info!(
            session_id = %session_id,
            student_id = %student.id,
            latest_session_id = %latest_session_id,
            "detected latest student session; will be resumed"
        );
    } else {
        tracing::info!(
            session_id = %session_id,
            student_id = %student.id,
            "no prior session found; will create new"
        );
    }

    let spawn_params = SpawnParams {
        session_id: session_id.clone(),
        student_json: student_json.clone(),
        dirs: dirs.clone(),
        claw_bin: std::env::var("CLAW_BIN").unwrap_or_else(|_| "claw".to_string()),
        model: effective_model,
        env: env_vars,
    };
    match spawn_claw_session(&spawn_params).await {
        Ok(pid) => {
            let _ = db_sess::set_namespace_pid(&state.pool, &session_id, pid as i64).await;
            // Apply cgroups v2 resource caps (best-effort; logs on failure).
            crate::security::cgroups::setup_session_cgroup(&session_id, pid).await;
            tracing::info!(session_id = %session_id, pid = pid, "claw namespace spawned");
        }
        Err(e) => {
            tracing::warn!(session_id = %session_id, error = %e, "claw spawn failed (PTY bridge will retry)");
        }
    }

    // Session-scoped JWT for the WebSocket handshake
    let token = state.auth.sign_session_token(
        &student.id,
        &student.role,
        &student.cohort_id,
        subject_ids,
        &session_id,
    )?;

    // Update student last_seen (non-fatal)
    let _ = students::touch_last_seen(&state.pool, &student.id).await;

    tracing::info!(
        session_id = %session_id,
        student    = %student.display_name,
        "session created"
    );

    Ok((
        StatusCode::CREATED,
        Json(CreateSessionResponse {
            session_id: session_id.clone(),
            ws_url: format!("/sessions/{session_id}/ws"),
            token,
        }),
    ))
}

// ── Get session ───────────────────────────────────────────────────────────

async fn get_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse> {
    let session = db_sess::get_session(&state.pool, &session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;
    Ok(Json(session))
}

// ── Set model mid-session ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct SetModelBody {
    model: String,
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
    // Allow the session owner, teacher, or admin.
    let session = db_sess::get_session(&state.pool, &session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;
    if claims.role == "student" && claims.sub != session.student_id {
        return Err(AppError::Forbidden);
    }

    let model = body.model.trim().to_string();
    if model.is_empty() {
        return Err(AppError::BadRequest("model must not be empty".to_string()));
    }

    // Persist new model in DB.
    db_sess::set_session_model(&state.pool, &session_id, &model).await?;

    // Signal the running pty_bridge by writing a side-channel file.
    // pty_bridge watches for this file and injects `/model <name>\n` into
    // claw's stdin, then removes the file.
    let dirs = crate::session::dirs::SessionDirs::for_existing_session(
        &state.workspace_root, &session_id,
    );
    let signal_path = dirs.config.join("pending_model.txt");
    let _ = std::fs::write(&signal_path, &model);

    tracing::info!(session_id = %session_id, model = %model, "model update requested");
    Ok((StatusCode::NO_CONTENT, ()))
}

// ── Token usage summary ───────────────────────────────────────────────────

async fn get_token_usage(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse> {
    let totals = db_tokens::session_totals(&state.pool, &session_id).await?;
    Ok(Json(totals))
}

// ── GET /sessions/:id/models ──────────────────────────────────────────────

async fn get_session_models(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse> {
    let session = db_sess::get_session(&state.pool, &session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

    let models =
        db_models::models_for_student(&state.pool, &session.student_id).await?;
    let active = session
        .model
        .unwrap_or_else(|| "grok-4-1-fast-reasoning".to_string());

    Ok(Json(serde_json::json!({
        "models": models,
        "active": active,
    })))
}

// ── Terminate session ─────────────────────────────────────────────────────

async fn terminate_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse> {
    let session = db_sess::get_session(&state.pool, &session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

    // SIGTERM the namespace init process
    if let Some(pid) = session.namespace_pid {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output();
    }

    // Best-effort overlay unmount
    let dirs = SessionDirs::for_existing_session(&state.workspace_root, &session_id);
    umount_overlay(&dirs.merged).await;

    db_sess::set_session_state(&state.pool, &session_id, "ended").await?;
    state.broker.remove_entry(&session_id).await;
    crate::security::cgroups::teardown_session_cgroup(&session_id).await;

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
        return Err(AppError::Forbidden);
    }

    // Format the banner: ANSI bold yellow, visible on any dark/light terminal.
    let banner = format!(
        "\r\n\x1b[1;33m[EduClaw] {}\x1b[0m\r\n",
        body.message
    );
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
    let mut lines: Vec<String> = vec!["/ (workspace root — subject materials, read-only)".to_string()];

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
                    .filter(|e| {
                        e.path().is_file() && e.file_name() != "subject.json"
                    })
                    .map(|e| e.path())
                    .collect()
            })
            .unwrap_or_default();
        files.sort();

        let show = files.len().min(8);
        for (j, f) in files.iter().take(show).enumerate() {
            let fc = if j == show - 1 && files.len() <= 8 { "└──" } else { "├──" };
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
        lines.push(format!("├── ... {} more personal file(s)", personal.len() - 20));
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
            let session_id = path
                .file_stem()?
                .to_str()?
                .to_string();
            
            Some((modified, session_id))
        })
        .collect();
    
    // Sort by modification time (newest first)
    session_files.sort_by(|a, b| b.0.cmp(&a.0));
    
    // Return the ID of the most recently modified session
    session_files.into_iter().next().map(|(_, id)| id)
}
