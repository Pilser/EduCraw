// educlaw-server/src/session/namespace.rs
//
// Host networking bootstrap (NAT/iptables), veth pair management,
// legacy overlay unmount (fallback for pre-migration sessions),
// and container-side network configuration via nsenter.

use std::path::Path;
use std::time::Duration;

use tokio::process::Command;

use crate::error::{AppError, Result};

// ── Host networking bootstrap (NAT + forwarding) ─────────────────────────

/// Ensure host networking prerequisites exist for session netns egress.
///
/// Idempotent behavior:
/// - enables `net.ipv4.ip_forward=1`
/// - ensures NAT MASQUERADE for 10.0.0.0/8
/// - ensures FORWARD accept rules for outbound + established return traffic
///
/// Must run with root privileges.
pub async fn ensure_host_networking() -> Result<()> {
    if unsafe { libc::geteuid() } != 0 {
        return Err(AppError::Session(
            "host networking bootstrap requires root (ip_forward/iptables)".to_string(),
        ));
    }

    let output = Command::new("sysctl")
        .args(["-w", "net.ipv4.ip_forward=1"])
        .output()
        .await
        .map_err(|e| AppError::Session(format!("failed to run sysctl for ip_forward: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Session(format!(
            "failed to enable net.ipv4.ip_forward: {stderr}"
        )));
    }

    ensure_iptables_rule(
        &["-t", "nat", "-C", "POSTROUTING", "-s", "10.0.0.0/8", "-j", "MASQUERADE"],
        &["-t", "nat", "-A", "POSTROUTING", "-s", "10.0.0.0/8", "-j", "MASQUERADE"],
        "NAT MASQUERADE for 10.0.0.0/8",
    )
    .await?;

    ensure_iptables_rule(
        &["-C", "FORWARD", "-s", "10.0.0.0/8", "-j", "ACCEPT"],
        &["-A", "FORWARD", "-s", "10.0.0.0/8", "-j", "ACCEPT"],
        "FORWARD allow outbound 10.0.0.0/8",
    )
    .await?;

    ensure_iptables_rule(
        &["-C", "FORWARD", "-d", "10.0.0.0/8", "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"],
        &["-A", "FORWARD", "-d", "10.0.0.0/8", "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"],
        "FORWARD allow established/related to 10.0.0.0/8",
    )
    .await?;

    tracing::info!("host networking bootstrap ready (ip_forward + NAT/FORWARD rules)");
    Ok(())
}

async fn ensure_iptables_rule(check_args: &[&str], add_args: &[&str], label: &str) -> Result<()> {
    let check = Command::new("iptables")
        .args(check_args)
        .output()
        .await
        .map_err(|e| AppError::Session(format!("iptables check failed for {label}: {e}")))?;

    if check.status.success() {
        tracing::debug!(rule = label, "iptables rule already present");
        return Ok(());
    }

    let add = Command::new("iptables")
        .args(add_args)
        .output()
        .await
        .map_err(|e| AppError::Session(format!("iptables add failed for {label}: {e}")))?;

    if !add.status.success() {
        let stderr = String::from_utf8_lossy(&add.stderr);
        return Err(AppError::Session(format!(
            "iptables add failed for {label}: {stderr}"
        )));
    }

    tracing::info!(rule = label, "iptables rule added");
    Ok(())
}

// ── Container network setup (nsenter child-side config) ───────────────────

/// Configure the container-side of a veth pair via nsenter.
///
/// Must be called after `setup_veth_pair` (which moves the child end into the
/// container's netns and configures the host end) and before the container
/// process starts executing (between `build_container` and `start_container`).
///
/// The PID is stable once `build_container` returns (container status = Created).
pub async fn setup_container_network(pid: u32, b1: u16, b2: u16, b3: u16) -> Result<()> {
    let veth_child = format!("vc{b1}_{b2}_{b3}");
    let child_ip = format!("10.{b1}.{b2}.{b3}/24");
    let child_gw = format!("10.{b1}.{b2}.1");

    // Bring loopback up inside the container netns
    let output = Command::new("nsenter")
        .args(["-t", &pid.to_string(), "-n", "--", "ip", "link", "set", "lo", "up"])
        .output()
        .await
        .map_err(|e| AppError::Session(format!("nsenter lo up: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Session(format!("nsenter lo up error: {stderr}")));
    }

    // Assign IP to the child veth
    let output = Command::new("nsenter")
        .args(["-t", &pid.to_string(), "-n", "--", "ip", "addr", "add", &child_ip, "dev", &veth_child])
        .output()
        .await
        .map_err(|e| AppError::Session(format!("nsenter addr add: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Session(format!("nsenter addr add error: {stderr}")));
    }

    // Bring child veth up
    let output = Command::new("nsenter")
        .args(["-t", &pid.to_string(), "-n", "--", "ip", "link", "set", &veth_child, "up"])
        .output()
        .await
        .map_err(|e| AppError::Session(format!("nsenter veth up: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Session(format!("nsenter veth up error: {stderr}")));
    }

    // Add default route via host end
    let output = Command::new("nsenter")
        .args(["-t", &pid.to_string(), "-n", "--", "ip", "route", "add", "default", "via", &child_gw])
        .output()
        .await
        .map_err(|e| AppError::Session(format!("nsenter route add: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Session(format!("nsenter route add error: {stderr}")));
    }

    tracing::debug!(pid, b1, b2, "container network configured via nsenter");
    Ok(())
}

// ── Legacy overlay unmount (fallback for pre-migration sessions) ───────────

/// Unmount kernel overlayfs.
///
/// Retries normal `umount` first, then uses lazy `umount -l` if still busy.
/// Returns `true` if unmount was initiated successfully, `false` otherwise.
pub async fn umount_overlay(merged: &Path) -> bool {
    let mount_path = merged.display().to_string();

    // Try normal unmount first (clean, fails if busy)
    for attempt in 1..=3 {
        let output = Command::new("umount")
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
    let output = Command::new("umount")
        .args(["-l", &mount_path])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            tracing::debug!(path = %mount_path, "overlay unmounted (lazy)");
            true
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            tracing::warn!(path = %mount_path, stderr = %stderr, "lazy umount failed");
            false
        }
        Err(e) => {
            tracing::warn!(path = %mount_path, error = %e, "lazy umount command failed");
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


// ── Unique IP allocation (session_id → 10.{b1}.{b2}.{b3}) ──────────────────
//
// Deterministic mapping from session UUID to a /24 block in 10.0.0.0/8.
// Uses BLAKE3 for uniform distribution without external state.

/// Map a session UUID to a unique /24 subnet within 10.0.0.0/8.
///
/// Returns `(b1, b2, b3)` such that the child gets `10.{b1}.{b2}.{b3}/24` and
/// the host end gets `10.{b1}.{b2}.1/24`.
///
/// Three bytes from the BLAKE3 hash give 253×256×256 = 16 580 608 unique
/// subnets — collision probability at 10 000 concurrent sessions is negligible
/// (~0.3 %).
pub fn session_ip_block(session_id: &str) -> (u16, u16, u16) {
    let hash = blake3::hash(session_id.as_bytes());
    let b = hash.as_bytes();
    let b1 = (u32::from_le_bytes([b[0], b[1], b[2], b[3]]) % 253 + 1) as u16;
    let b2 = b[4] as u16;
    let b3 = b[5] as u16;
    (b1, b2, b3)
}

// ── Network namespace (veth pair setup / teardown) ─────────────────────────

/// Create a veth pair, move the child end into the container's network namespace,
/// and configure the host end.  The child end IP/routing is configured by a
/// subsequent `setup_container_network` call via nsenter.
pub async fn setup_veth_pair(pid: u32, b1: u16, b2: u16, b3: u16) -> Result<()> {
    let veth_host = format!("ve{b1}_{b2}_{b3}");
    let veth_child = format!("vc{b1}_{b2}_{b3}");
    let host_ip = format!("10.{b1}.{b2}.1/24");

    // 1. Create veth pair
    let output = Command::new("ip")
        .args(["link", "add", &veth_host, "type", "veth", "peer", "name", &veth_child])
        .output()
        .await
        .map_err(|e| AppError::Session(format!("create veth pair failed: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Session(format!("create veth pair error: {stderr}")));
    }

    // 2. Move child end into the goose's network namespace
    let output = Command::new("ip")
        .args(["link", "set", &veth_child, "netns", &pid.to_string()])
        .output()
        .await
        .map_err(|e| AppError::Session(format!("move veth to netns failed: {e}")))?;
    if !output.status.success() {
        let _ = Command::new("ip").args(["link", "delete", &veth_host]).output().await;
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Session(format!("move veth to netns error: {stderr}")));
    }

    // 3. Child side IP/routing is configured by setup_container_network via nsenter.
    //    Called after build, before start (PID stable, no user namespace to cross).

    // 4. Configure host side
    let output = Command::new("ip")
        .args(["addr", "add", &host_ip, "dev", &veth_host])
        .output()
        .await
        .map_err(|e| AppError::Session(format!("set host veth IP failed: {e}")))?;
    if !output.status.success() {
        let _ = Command::new("ip").args(["link", "delete", &veth_host]).output().await;
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Session(format!("set host veth IP error: {stderr}")));
    }

    let output = Command::new("ip")
        .args(["link", "set", &veth_host, "up"])
        .output()
        .await
        .map_err(|e| AppError::Session(format!("bring up host veth failed: {e}")))?;
    if !output.status.success() {
        let _ = Command::new("ip").args(["link", "delete", &veth_host]).output().await;
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Session(format!("bring up host veth error: {stderr}")));
    }

    tracing::debug!(pid, b1, b2, veth = %veth_host, "veth pair configured");
    Ok(())
}

/// Remove the host end of a veth pair. The child end is auto-destroyed when
/// the network namespace is torn down (last process exits).
pub async fn cleanup_veth(b1: u16, b2: u16, b3: u16) {
    let veth_host = format!("ve{b1}_{b2}_{b3}");
    let _ = Command::new("ip")
        .args(["link", "delete", &veth_host])
        .output()
        .await;
}

/// Remove any orphaned veth interfaces left from a crashed or unclean shutdown.
///
/// Scans ALL veth interfaces on the host and deletes those matching our naming
/// conventions (`ve*`, `vc*`, or the legacy `veth_h_*` / `veth_c_*`).  This is
/// safe because:
///   - Active sessions' veths are already cleaned by the caller
///   - Any remaining interface with our naming is by definition orphaned
///   - veths are ephemeral kernel objects with no persistent state
///
/// Run ONCE at server startup.
pub async fn cleanup_orphaned_veths() {
    let output = Command::new("sh")
        .args([
            "-c",
            r#"ip -o link show type veth | awk -F': ' '{print $2}' | awk '{print $1}' | grep -E '^(ve|vc|veth_h_|veth_c_)[0-9_]+' | cut -d@ -f1 | sort -u | xargs -r -L1 ip link delete"#,
        ])
        .output()
        .await;
    match output {
        Ok(o) if o.status.success() => {
            let deleted = String::from_utf8_lossy(&o.stdout);
            if !deleted.is_empty() {
                tracing::info!("orphaned veth interfaces cleaned up");
            }
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            tracing::warn!(stderr = %stderr, "orphaned veth cleanup had errors (harmless)");
        }
        Err(e) => {
            tracing::warn!(error = %e, "orphaned veth cleanup command failed (harmless)");
        }
    }
}
