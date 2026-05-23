// educlaw-server/src/session/watchdog.rs
//
// Per-session idle watchdog — spawned as a Tokio task in api/sessions.rs.
//
// Timeline (defaults: idle_timeout=900s, warn_before=60s):
//   every 30 s : check elapsed since last keypress via broker
//   at T-60 s  : write ANSI warning banner to PTY
//   at T       : set DB state → "ended", write goodbye, umount overlay
//
// The task exits when:
//   - The session times out (handled here).
//   - The entry is removed from broker externally (DELETE /sessions/:id).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::time::sleep;

use crate::db::DbBackend;
use crate::session::{
    broker::{now_secs, SessionBroker},
    dirs::cleanup_session_dir,
    namespace::{cleanup_veth, kill_process_tree, session_ip_block, umount_overlay},
    registry::SessionRegistry,
};

// ── Config ────────────────────────────────────────────────────────────────

pub struct WatchdogConfig {
    pub session_id: String,
    /// Path to the OverlayFS merged mount (for umount on timeout).
    pub overlay_mount: PathBuf,
    /// Base directory for ephemeral session dirs (e.g. `/var/lib/educraw/sessions`).
    pub workspace_root: String,
    pub idle_timeout: Duration,
    pub warn_before: Duration,
    /// Registry entry for the session's goose subprocess (may be None if goose
    /// hasn't been spawned yet or this is a headless session).
    pub registry: Option<Arc<SessionRegistry>>,
}

// ── Task ──────────────────────────────────────────────────────────────────

pub async fn run_watchdog(
    config: WatchdogConfig,
    broker: Arc<SessionBroker>,
    backend: Arc<dyn DbBackend>,
) {
    let mut warned = false;

    loop {
        sleep(Duration::from_secs(30)).await;

        // Session removed from broker — terminated externally, stop.
        let last_secs = match broker.last_input_secs(&config.session_id).await {
            Some(t) => t,
            None => break,
        };

        let elapsed = Duration::from_secs(now_secs().saturating_sub(last_secs));

        // Hard timeout: terminate
        if elapsed >= config.idle_timeout {
            let _ = backend.set_session_state(&config.session_id, "ended").await;

            broker
                .write_to_pty(
                    &config.session_id,
                    b"\r\n\x1b[33m[EduClaw] Session timed out. Your files are saved.\x1b[0m\r\n"
                        .to_vec(),
                )
                .await;

            broker.remove_entry(&config.session_id).await;

            // Kill claw's process tree (if it exists)
            if let Ok(Some(sess)) = backend.get_session(&config.session_id).await {
                if let Some(pid) = sess.namespace_pid {
                    kill_process_tree(pid, 5).await;
                }
            }

            // Kill goose process tree via its unshare process group
            if let Some(ref registry) = config.registry {
                if let Some(managed) = registry.get(&config.session_id).await {
                    // Kill the entire process group first (unshare wrapper + goose + all children)
                    // kill_process_tree uses kill -9 -pid which hits the whole process group,
                    // then polls kill -0 until the process is gone or 5s timeout passes.
                    let group_pid = managed.pid as i64;
                    kill_process_tree(group_pid, 5).await;
                    tracing::info!(session_id = %config.session_id, pid = managed.pid, "watchdog: goose process group killed");

                    // Fallback kill via tokio child handle, then drop it
                    let mut child_guard = managed.child.lock().await;
                    if let Some(ref mut child) = *child_guard {
                        let _ = child.kill().await;
                    }
                    *child_guard = None;
                    registry.remove(&config.session_id).await;
                }
            }

            // Remove veth pair (child end auto-destroyed with netns teardown)
            let (b1, b2) = session_ip_block(&config.session_id);
            cleanup_veth(b1, b2).await;

            if !umount_overlay(&config.overlay_mount).await {
                tracing::warn!(
                    session_id = %config.session_id,
                    "watchdog: overlay umount failed — cleanup may fail"
                );
            }
            cleanup_session_dir(&config.workspace_root, &config.session_id);

            tracing::info!(
                session_id = %config.session_id,
                "watchdog: idle timeout — session terminated"
            );
            break;
        }

        // Warning threshold
        let warn_threshold = config.idle_timeout.saturating_sub(config.warn_before);
        if elapsed >= warn_threshold && !warned {
            let secs_left = (config.idle_timeout - elapsed).as_secs();
            let msg = format!(
                "\r\n\x1b[33m[EduClaw] Session idle \u{2014} {} s to disconnect.\x1b[0m\r\n",
                secs_left
            );
            broker
                .write_to_pty(&config.session_id, msg.into_bytes())
                .await;
            warned = true;
            tracing::debug!(
                session_id = %config.session_id,
                secs_left,
                "watchdog: idle warning sent"
            );
        }

        // Check if an external DELETE already ended the session in DB.
        match backend.get_session(&config.session_id).await {
            Ok(Some(s)) if s.state == "ended" => break,
            Ok(None) => break,
            _ => {}
        }
    }
}
