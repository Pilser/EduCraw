// educlaw-server/src/session/dirs.rs
//
// Per-session filesystem layout definition.

use std::path::PathBuf;

/// Filesystem layout for one session.
///
/// Persistent paths (survive across sessions):
///   lower  = /data/subjects/{cohort_id}/          ← cohort course materials (read-only via OverlayFS)
///                                                    cohort_id is a slug (e.g. "primary-2b"), not a UUID
///   upper  = /data/students/{username}/            ← student's home dir (read-write, persisted on disk)
///                                                    username is unique and human-readable to the agent
///
/// Ephemeral paths (created fresh per session, under workspace_root/{session_id}/):
///   work/    ← OverlayFS work dir (must be on the same filesystem as upper/)
///   merged/  ← unified view — agent's working root (EDUCLAW_WORKSPACE)
///   config/  ← per-session CLAW_CONFIG_HOME
#[derive(Debug, Clone)]
pub struct SessionDirs {
    pub root: PathBuf,
    /// Cohort course content — read-only lower layer of OverlayFS.
    /// Must already exist on disk before mount_overlay is called.
    pub lower: PathBuf,
    /// Student's persistent home — read-write upper layer of OverlayFS.
    /// Created if it doesn't exist yet (first session for this student).
    pub upper: PathBuf,
    pub work: PathBuf,
    pub merged: PathBuf,
    pub config: PathBuf,
}

impl SessionDirs {
    /// Build paths for a session.
    ///
    /// * `workspace_root` — base dir for ephemeral session dirs
    ///   (e.g. `/var/lib/educlaw/sessions`)
    /// * `session_id`     — unique session UUID
    /// * `lower`          — cohort content dir (must already exist)
    ///   (e.g. `/data/subjects/{cohort_id}`)
    /// * `upper`          — student persistent dir (created on first session)
    ///   (e.g. `/data/students/{student_id}`)
    pub fn new(
        workspace_root: &str,
        session_id: &str,
        lower: PathBuf,
        upper: PathBuf,
    ) -> Self {
        let root = PathBuf::from(workspace_root).join(session_id);
        Self {
            lower,
            upper,
            work:   root.join("work"),
            merged: root.join("merged"),
            config: root.join("config"),
            root,
        }
    }

    /// Build only the ephemeral paths for a session that already exists.
    /// Use this in WebSocket handlers and session teardown where the mount
    /// was already done by `create_session` — `lower`/`upper` are not needed.
    pub fn for_existing_session(workspace_root: &str, session_id: &str) -> Self {
        let root = PathBuf::from(workspace_root).join(session_id);
        // lower/upper are not valid in this context — callers must not access them.
        Self {
            lower:  PathBuf::new(),
            upper:  PathBuf::new(),
            work:   root.join("work"),
            merged: root.join("merged"),
            config: root.join("config"),
            root,
        }
    }

    /// Create dirs that need to exist before OverlayFS is mounted.
    ///
    /// * `upper/`  — student persistent home; safe to create if first session.
    /// * `work/`   — OverlayFS scratch; ephemeral.
    /// * `merged/` — mount point; ephemeral.
    /// * `config/` — claw config home; ephemeral.
    ///
    /// `lower/` is *not* created here — it must be pre-populated cohort content.
    /// Returns an error if `lower` does not exist.
    pub fn create_all(&self) -> std::io::Result<()> {
        if !self.lower.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!(
                    "cohort content dir does not exist: {}",
                    self.lower.display()
                ),
            ));
        }
        for dir in [
            &self.upper,
            &self.work,
            &self.merged,
            &self.config,
        ] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(())
    }
}

/// Remove the ephemeral session directory tree after the session has ended.
///
/// This deletes `{workspace_root}/{session_id}/` which contains only:
///   `work/`, `merged/`, `config/` — all created fresh per session.
///
/// It does NOT touch persistent paths (`upper` / student home, `lower` / cohort content).
///
/// **Must be called AFTER `umount_overlay`** — the merged mount must be gone
/// before the directory can be removed.
///
/// Best-effort: logs a warning on failure but never propagates errors,
/// since the session is already terminated at this point.
pub fn cleanup_session_dir(workspace_root: &str, session_id: &str) {
    let root = std::path::PathBuf::from(workspace_root).join(session_id);
    if !root.exists() {
        return;
    }

    // Give the kernel a moment to release mount references after lazy unmount.
    std::thread::sleep(std::time::Duration::from_millis(300));

    // Retry a few times — the kernel may need a moment to fully release the mount.
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
