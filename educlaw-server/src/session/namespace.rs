// educlaw-server/src/session/namespace.rs
//
// OverlayFS management (via fuse-overlayfs) and claw session spawn.
// Uses the unshare(mount+pid) approach — no Docker, sub-100ms startup.

use std::path::Path;
use std::time::Duration;

use tokio::process::Command;

use crate::error::{AppError, Result};
use crate::session::dirs::SessionDirs;

// ── OverlayFS ──────────────────────────────────────────────────────────────

/// Mount fuse-overlayfs over the session's lower/upper/work dirs into merged/.
pub async fn mount_overlay(dirs: &SessionDirs) -> Result<()> {
    let output = Command::new("fuse-overlayfs")
        .arg("-o")
        .arg(format!(
            "lowerdir={},upperdir={},workdir={}",
            dirs.lower.display(),
            dirs.upper.display(),
            dirs.work.display(),
        ))
        .arg(dirs.merged.display().to_string())
        .output()
        .await
        .map_err(|e| AppError::Session(format!("fuse-overlayfs failed to start: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Session(format!(
            "fuse-overlayfs mount failed: {stderr}"
        )));
    }
    Ok(())
}

/// Unmount fuse-overlayfs.
///
/// Uses lazy unmount (`fusermount -uz`) which always succeeds — it detaches
/// the mount from the filesystem tree immediately. The kernel cleans up the
/// actual mount when all processes (e.g. goose) release their references.
///
/// Retries a few times in case the mount is momentarily busy.
/// Returns `true` if the unmount was initiated successfully, `false` otherwise.
pub async fn umount_overlay(merged: &Path) -> bool {
    let mount_path = merged.display().to_string();

    // Try normal unmount first (clean, fails if busy)
    for attempt in 1..=3 {
        let output = Command::new("fusermount")
            .arg("-u")
            .arg(&mount_path)
            .output()
            .await;

        if let Ok(o) = output {
            if o.status.success() {
                tracing::debug!(path = %mount_path, "overlay unmounted (normal)");
                return true;
            }
        }

        if attempt < 3 {
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    // Normal unmount failed after retries — use lazy unmount.
    // -z: lazy, detaches from filesystem tree immediately.
    // The kernel cleans up the mount when all processes release references.
    tracing::debug!(path = %mount_path, "normal unmount busy, using lazy unmount");
    let output = Command::new("fusermount")
        .arg("-uz")
        .arg(&mount_path)
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            tracing::debug!(path = %mount_path, "overlay unmounted (lazy)");
            true
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            tracing::warn!(path = %mount_path, stderr = %stderr, "lazy fusermount failed");
            false
        }
        Err(e) => {
            tracing::warn!(path = %mount_path, error = %e, "lazy fusermount command failed");
            false
        }
    }
}

/// Kill a process and all its children, then wait for it to exit.
///
/// Uses `kill -9` on the process group to ensure all child processes
/// (claw, subshells, tools spawned by claw) are terminated.
/// Then waits up to `timeout_secs` for the process to be reaped.
pub async fn kill_process_tree(pid: i64, timeout_secs: u64) {
    // Send SIGKILL to the entire process group (-pid means process group)
    let _ = Command::new("kill")
        .args(["-9", &format!("-{}", pid)])
        .output()
        .await;

    // Also send to the individual PID in case it's not a process group leader
    let _ = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output()
        .await;

    // Wait for the process to actually exit
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
    while std::time::Instant::now() < deadline {
        let output = Command::new("kill")
            .arg("-0")
            .arg(&pid.to_string())
            .output()
            .await;
        if let Ok(o) = output {
            if !o.status.success() {
                // Process is gone
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    tracing::warn!(pid, "kill_process_tree: process did not exit within timeout");
}



// ── Session spawn ──────────────────────────────────────────────────────────
//
// Primary spawn path: pty_bridge.rs uses portable-pty which handles PTY
// attachment. This function is the namespace-only wrapper, useful for
// headless sessions or future broker-managed spawns.

#[derive(Debug)]
pub struct SpawnParams {
    pub session_id: String,
    pub student_json: String,
    pub dirs: SessionDirs,
    pub claw_bin: String,
    pub model: Option<String>,
    /// Extra env vars (API keys, etc.) to forward into the session.
    pub env: Vec<(String, String)>,
}

/// Spawn `claw` inside `unshare --mount --pid --fork`.
/// Returns the OS PID of the outer wrapper process.
///
/// **Process group isolation:** The spawned process tree is placed in its own
/// session/process group via `setsid()`. This means `kill -9 -{pid}` kills
/// ONLY this session's claw process and all its children — never other sessions
/// or the server itself.
pub async fn spawn_claw_session(params: &SpawnParams) -> Result<u32> {
    let mut claw_args = vec![params.claw_bin.clone()];
    if let Some(ref model) = params.model {
        claw_args.push("--model".to_string());
        claw_args.push(model.clone());
    }
    let claw_cmd = claw_args.join(" ");

    let mut cmd = Command::new("unshare");
    cmd.args(["--user", "--map-root-user", "--mount", "--pid", "--fork", "sh", "-c", &claw_cmd]);
    cmd.current_dir(&params.dirs.merged);
    cmd.env("CLAW_CONFIG_HOME", &params.dirs.config);
    cmd.env("EDUCLAW_STUDENT_JSON", &params.student_json);
    cmd.env("EDUCLAW_SESSION_ID", &params.session_id);
    cmd.env("EDUCLAW_WORKSPACE", &params.dirs.merged);
    for (key, value) in &params.env {
        cmd.env(key, value);
    }

    // Apply seccomp BPF deny-list in the child process (Linux only).
    // Also calls setsid() to create a dedicated process group so that
    // kill -9 -{pid} kills ONLY this session's tree.
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt as _;

        match crate::security::seccomp::build_student_filter() {
            Ok(filter) => {
                // SAFETY: pre_exec runs in the child after fork(), single-threaded,
                // before exec(). Both setsid() and seccompiler::apply_filter are
                // async-signal-safe (setsid = syscall, apply_filter = prctl).
                unsafe {
                    cmd.pre_exec(move || {
                        // Create a new session so this process tree gets its own
                        // process group. PID becomes the PGID, making kill -9 -PID
                        // target ONLY this session's claw + all descendants.
                        libc::setsid();

                        seccompiler::apply_filter(&filter)
                            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
                        Ok(())
                    });
                }
            }
            Err(e) => {
                tracing::warn!("seccomp filter build failed, running without: {e}");
            }
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Session(format!("failed to spawn claw: {e}")))?;

    let pid = child
        .id()
        .ok_or_else(|| AppError::Session("spawned process has no PID".to_string()))?;

    // Let Tokio reap the child when it exits; PTY bridge manages the actual I/O.
    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    Ok(pid)
}
