// Shared utility functions for API handlers

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::acp_bridge::init_acp_session;
use crate::error::{AppError, Result};
use crate::session::container::collect_subject_dirs;
use crate::session::dirs::SessionDirs;
use crate::session::registry::ManagedSession;

use super::AppState;

/// Look up a managed session in the registry, lazily spawning goose if needed.
///
/// This is the canonical pattern for any endpoint that needs a live ACP
/// connection: try the registry first, fall back to spawning goose for
/// the existing-but-not-running session. The same logic is used by
/// `threads.rs`, `recipes.rs`, and `sse.rs` so behaviour stays consistent
/// across endpoints (e.g. a recipe list works even after the session
/// has been idle long enough to drop from the registry).
pub async fn get_managed_session(
    state: &AppState,
    session_id: &str,
) -> Result<Arc<ManagedSession>> {
    if let Some(managed) = state.registry.get(session_id).await {
        return Ok(managed);
    }

    // Session not in registry — spawn goose and register it (lazy init)
    let session = state
        .backend
        .get_session(session_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

    if session.state != "active" {
        return Err(AppError::BadRequest(format!(
            "session {session_id} is not active (state: {})",
            session.state
        )));
    }

    let student_id = session.student_id.clone();
    let dirs = SessionDirs::for_existing_session(session_id);

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

    let model = session
        .model
        .clone()
        .filter(|m| !m.is_empty())
        .or_else(|| std::env::var("GOOSE_MODEL").ok());

    let goose_path_root = std::path::PathBuf::from(&state.students_root).join(&student_id);
    let logs_dir = std::path::PathBuf::from(&state.workspace_root)
        .parent()
        .unwrap_or(std::path::Path::new("/data"))
        .join(format!("students/{}", student_id))
        .join(".goose/logs");

    let recent_thread_id = state
        .backend
        .get_recent_thread_id(&student_id)
        .await
        .unwrap_or(None);

    let student = state.backend.get_student(&student_id)
        .await
        .ok()
        .flatten();
    let cohort_id = student.as_ref()
        .map(|s| s.cohort_id.clone())
        .unwrap_or_default();
    let student_workspace = student.map_or_else(
        || std::path::PathBuf::from(&state.students_root).join(&student_id),
        |s| {
            let component = s.home_dir.as_deref().unwrap_or(&s.username);
            std::path::PathBuf::from(&state.students_root).join(component)
        },
    );
    let subject_dirs = collect_subject_dirs(Path::new(&state.subjects_root), &cohort_id);

    init_acp_session(
        std::path::PathBuf::from(&state.goose_bin),
        goose_path_root,
        dirs.root.clone(),
        student_workspace,
        std::path::PathBuf::from(&state.jail_tools_host),
        subject_dirs,
        env_vars,
        model,
        state.backend.clone(),
        session_id.to_string(),
        student_id,
        logs_dir,
        Arc::clone(&state.registry),
        recent_thread_id,
    )
    .await?;

    state
        .registry
        .get(session_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found after init")))
}

/// Resolve the project_dir used by recipe create/import — the student's
/// visible workspace (OverlayFS merged view). Writes go through to the
/// persistent upper layer, so files survive session end.
pub fn resolve_recipe_project_dir(state: &AppState, session_id: &str) -> String {
    let dirs = SessionDirs::for_existing_session(session_id);
    dirs.root.to_string_lossy().to_string()
}

/// Recursively copy directory and all contents
pub fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    // Verify source directory exists and is readable
    if !src.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Source directory not found: {}", src.display()),
        ));
    }

    let metadata = std::fs::metadata(src)?;
    if !metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Source is not a directory: {}", src.display()),
        ));
    }

    // Create destination directory
    std::fs::create_dir_all(dst).map_err(|e| {
        std::io::Error::new(
            e.kind(),
            format!(
                "Failed to create destination directory {}: {}",
                dst.display(),
                e
            ),
        )
    })?;

    let entries = std::fs::read_dir(src).map_err(|e| {
        std::io::Error::new(
            e.kind(),
            format!("Failed to read source directory {}: {}", src.display(), e),
        )
    })?;

    for entry in entries {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let file_name = entry.file_name();
        let dst_path = dst.join(&file_name);

        if ty.is_dir() {
            copy_dir_all(&src_path, &dst_path).map_err(|e| {
                std::io::Error::new(
                    e.kind(),
                    format!(
                        "Failed to copy directory {} to {}: {}",
                        src_path.display(),
                        dst_path.display(),
                        e
                    ),
                )
            })?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| {
                std::io::Error::new(
                    e.kind(),
                    format!(
                        "Failed to copy file {} to {}: {}",
                        src_path.display(),
                        dst_path.display(),
                        e
                    ),
                )
            })?;
        }
    }
    Ok(())
}

/// Copy goose config template files for a new student
pub fn setup_goose_config(student_id: &str, students_root: &str) {
    let student_dir = PathBuf::from(students_root).join(student_id);
    let goose_template = PathBuf::from("/srv/educraw/templates/goose-config/config");
    let goose_dst = student_dir.join("config");

    // Debug: Log paths being used
    tracing::debug!(
        student_id = %student_id,
        student_dir = %student_dir.display(),
        goose_template = %goose_template.display(),
        goose_dst = %goose_dst.display(),
        "attempting to copy goose config template"
    );

    // Step 1: Verify source template exists and is readable
    if !goose_template.exists() {
        tracing::warn!(
            student_id = %student_id,
            source_path = %goose_template.display(),
            "source template directory not found"
        );
        return;
    }

    if !goose_template.is_dir() {
        tracing::warn!(
            student_id = %student_id,
            source_path = %goose_template.display(),
            "source template path is not a directory"
        );
        return;
    }

    // Step 2: Create student directory if it doesn't exist
    if let Err(e) = std::fs::create_dir_all(&student_dir) {
        tracing::error!(
            student_id = %student_id,
            student_dir = %student_dir.display(),
            error = %e,
            "failed to create student directory"
        );
        return;
    }

    tracing::debug!(
        student_id = %student_id,
        student_dir = %student_dir.display(),
        "student directory created or already exists"
    );

    // Step 3: Attempt to copy template files
    if let Err(e) = copy_dir_all(&goose_template, &goose_dst) {
        tracing::error!(
            student_id = %student_id,
            source = %goose_template.display(),
            destination = %goose_dst.display(),
            error = %e,
            "failed to copy goose config template files"
        );
        return;
    }

    tracing::info!(
        student_id = %student_id,
        destination = %goose_dst.display(),
        "goose config template copied successfully"
    );

    // Step 4: Set file permissions: config.yaml 644, secrets.yaml 600
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let config_yaml_path = goose_dst.join("config.yaml");
        let secrets_yaml_path = goose_dst.join("secrets.yaml");

        match std::fs::set_permissions(&config_yaml_path, std::fs::Permissions::from_mode(0o644)) {
            Ok(_) => tracing::debug!(
                student_id = %student_id,
                path = %config_yaml_path.display(),
                permissions = "0644",
                "config.yaml permissions set"
            ),
            Err(e) => tracing::warn!(
                student_id = %student_id,
                path = %config_yaml_path.display(),
                error = %e,
                "failed to set config.yaml permissions"
            ),
        }

        match std::fs::set_permissions(&secrets_yaml_path, std::fs::Permissions::from_mode(0o600)) {
            Ok(_) => tracing::debug!(
                student_id = %student_id,
                path = %secrets_yaml_path.display(),
                permissions = "0600",
                "secrets.yaml permissions set"
            ),
            Err(e) => tracing::warn!(
                student_id = %student_id,
                path = %secrets_yaml_path.display(),
                error = %e,
                "failed to set secrets.yaml permissions"
            ),
        }
    }
}
