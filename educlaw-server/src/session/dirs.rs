use std::path::PathBuf;

/// Temp directory for one session's OCI bundle (config.json, state, resolv.conf).
/// Uses `/tmp/craw/{session_id}/` so the OS auto-cleans on reboot
/// even if `cleanup_session_dir` fails.
pub fn session_temp_dir(session_id: &str) -> PathBuf {
    std::env::temp_dir().join("craw").join(session_id)
}

/// Nuke the entire `/tmp/craw/` directory on startup.
/// Since every session bundle is ephemeral, this ensures no stale
/// Youki state, orphaned resolv.conf, or abandoned config.json
/// survives a server restart — regardless of whether the session
/// was in the DB or not.
pub fn cleanup_all_temp_dirs() {
    let root = std::env::temp_dir().join("craw");
    if !root.exists() {
        return;
    }
    if let Err(e) = std::fs::remove_dir_all(&root) {
        tracing::warn!(path = %root.display(), error = %e, "failed to clean temp session dirs (harmless)");
    } else {
        tracing::info!(path = %root.display(), "all temp session dirs cleaned");
    }
}

/// Filesystem layout for one session.
///
/// Persistent paths:
///   lower  = cohort course materials (bind source, read-only)
///   upper  = student's home dir (bind source, read-write)
///
/// Ephemeral paths (tmpfs-backed, under `/tmp/craw/{session_id}/`):
///   config.json ← OCI specification
///   state.json  ← Youki runtime metadata (killed on server restart)
///   resolv.conf ← DNS config
#[derive(Debug, Clone)]
pub struct SessionDirs {
    /// Bundle root in `/tmp/craw/{session_id}/`.
    pub root: PathBuf,
    /// Cohort course content — read-only bind mount source.
    pub lower: PathBuf,
    /// Student's persistent home — read-write bind mount source.
    pub upper: PathBuf,
}

impl SessionDirs {
    pub fn new(session_id: &str, lower: PathBuf, upper: PathBuf) -> Self {
        Self {
            root: session_temp_dir(session_id),
            lower,
            upper,
        }
    }

    /// Build only the ephemeral paths for a session that already exists.
    pub fn for_existing_session(session_id: &str) -> Self {
        Self {
            root: session_temp_dir(session_id),
            lower:  PathBuf::new(),
            upper:  PathBuf::new(),
        }
    }
}

/// Remove a session's temp directory.
///
/// Best-effort: logs a warning on failure but never propagates errors.
/// Even if this fails, `cleanup_all_temp_dirs` on next server start
/// (or the OS tmp cleaner) will eventually clean it.
pub fn cleanup_session_dir(session_id: &str) {
    let root = session_temp_dir(session_id);
    if !root.exists() {
        return;
    }
    for attempt in 1..=5 {
        match std::fs::remove_dir_all(&root) {
            Ok(()) => {
                tracing::info!(
                    session_id = %session_id,
                    path = %root.display(),
                    "cleanup: session directory removed"
                );
                return;
            }
            Err(e) if attempt < 5 => {
                tracing::debug!(
                    session_id = %session_id,
                    attempt,
                    error = %e,
                    "cleanup: remove_dir_all failed, retrying in 500ms"
                );
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            Err(e) => {
                tracing::warn!(
                    session_id = %session_id,
                    path = %root.display(),
                    error = %e,
                    "cleanup: failed to remove session directory after 5 attempts"
                );
            }
        }
    }
}
