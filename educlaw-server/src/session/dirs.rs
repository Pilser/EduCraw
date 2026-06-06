use std::path::PathBuf;

/// Filesystem layout for one session.
///
/// Persistent paths (survive across sessions):
///   lower  = /data/subjects/{cohort_id}/          ← cohort course materials (bind source, read-only)
///   upper  = /data/students/{username}/            ← student's home dir (bind source, read-write)
///
/// Ephemeral paths (created fresh per session, under workspace_root/{session_id}/):
///   work/    ← OverlayFS work dir (must be on same filesystem as upper/)
///   merged/  ← unified view (old overlay approach — keep until Youki wiring completes)
///   rootfs/  ← OCI container rootfs (new approach)
///   config/  ← per-session CLAW_CONFIG_HOME (bind source)
///   config.json ← OCI specification (at bundle root)
#[derive(Debug, Clone)]
pub struct SessionDirs {
    pub root: PathBuf,
    /// Cohort course content — read-only bind mount source.
    pub lower: PathBuf,
    /// Student's persistent home — read-write bind mount source.
    pub upper: PathBuf,
    /// OverlayFS work dir (temporary — will be removed with overlay).
    pub work: PathBuf,
    /// OverlayFS merged mount point (temporary — will be removed with overlay).
    pub merged: PathBuf,
    /// OCI container rootfs (replaces merged/ once Youki is wired).
    pub rootfs: PathBuf,
    /// Per-session CLAW_CONFIG_HOME, bind-mounted into container.
    pub config: PathBuf,
}

impl SessionDirs {
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
            rootfs: root.join("rootfs"),
            config: root.join("config"),
            root,
        }
    }

    /// Build only the ephemeral paths for a session that already exists.
    pub fn for_existing_session(workspace_root: &str, session_id: &str) -> Self {
        let root = PathBuf::from(workspace_root).join(session_id);
        Self {
            lower:  PathBuf::new(),
            upper:  PathBuf::new(),
            work:   PathBuf::new(),
            merged: PathBuf::new(),
            rootfs: root.join("rootfs"),
            config: root.join("config"),
            root,
        }
    }

    /// Create dirs that need to exist before mount_overlay or OCI bundle.
    /// `lower/` is *not* created here — it must be pre-populated cohort content.
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
        for dir in [&self.upper, &self.work, &self.merged, &self.rootfs, &self.config] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(())
    }

    /// The bundle directory (parent of rootfs/) where config.json lives.
    pub fn bundle_dir(&self) -> PathBuf {
        self.root.clone()
    }
}

/// Remove the ephemeral session directory tree after the session has ended.
///
/// Best-effort: logs a warning on failure but never propagates errors.
pub fn cleanup_session_dir(workspace_root: &str, session_id: &str) {
    let root = std::path::PathBuf::from(workspace_root).join(session_id);
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
