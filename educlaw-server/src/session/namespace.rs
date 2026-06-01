// educlaw-server/src/session/namespace.rs
//
// OverlayFS management (kernel overlayfs), filesystem jails (pivot_root),
// and network namespace isolation (veth pairs) for session subprocesses.
// Uses the unshare(mount+pid+net) approach — no Docker, sub-100ms startup.

use std::path::Path;
use std::time::Duration;

use tokio::process::Command;

use crate::error::{AppError, Result};
use crate::session::dirs::SessionDirs;

// ── Host networking bootstrap (NAT + forwarding) ─────────────────────────

/// Ensure host networking prerequisites exist for session netns egress.
///
/// Idempotent behavior:
/// - enables `net.ipv4.ip_forward=1`
/// - ensures NAT MASQUERADE for 10.200.0.0/16
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
        &["-t", "nat", "-C", "POSTROUTING", "-s", "10.200.0.0/16", "-j", "MASQUERADE"],
        &["-t", "nat", "-A", "POSTROUTING", "-s", "10.200.0.0/16", "-j", "MASQUERADE"],
        "NAT MASQUERADE for 10.200.0.0/16",
    )
    .await?;

    ensure_iptables_rule(
        &["-C", "FORWARD", "-s", "10.200.0.0/16", "-j", "ACCEPT"],
        &["-A", "FORWARD", "-s", "10.200.0.0/16", "-j", "ACCEPT"],
        "FORWARD allow outbound 10.200.0.0/16",
    )
    .await?;

    ensure_iptables_rule(
        &["-C", "FORWARD", "-d", "10.200.0.0/16", "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"],
        &["-A", "FORWARD", "-d", "10.200.0.0/16", "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"],
        "FORWARD allow established/related to 10.200.0.0/16",
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

// ── OverlayFS ──────────────────────────────────────────────────────────────

/// Mount kernel overlayfs over the session's lower/upper/work dirs into merged/.
///
/// This is a strict migration path: no fallback to fuse-overlayfs.
/// The server must run as root for this mount to succeed.
pub async fn mount_overlay(dirs: &SessionDirs) -> Result<()> {
    if unsafe { libc::geteuid() } != 0 {
        return Err(AppError::Session(
            "kernel overlayfs requires root: run educlaw-server as root (no fuse fallback)".to_string(),
        ));
    }

    let options = format!(
        "lowerdir={},upperdir={},workdir={}",
        dirs.lower.display(),
        dirs.upper.display(),
        dirs.work.display(),
    );

    let output = Command::new("mount")
        .args(["-t", "overlay", "overlay", "-o", &options, &dirs.merged.display().to_string()])
        .output()
        .await
        .map_err(|e| AppError::Session(format!("kernel overlay mount command failed: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Session(format!(
            "kernel overlay mount failed: {stderr}"
        )));
    }
    Ok(())
}

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


// ── Unique IP allocation (session_id → 10.200.{b1}.{b2}) ──────────────────
//
// Deterministic, collision-free mapping from session UUID to a /24 block
// in 10.200.0.0/16. Uses BLAKE3 for uniform distribution without external
// state (no IPAM server, no DB table, no counter).

/// Map a session UUID to a unique /24 subnet within 10.200.0.0/16.
///
/// Returns `(b1, b2)` such that the child gets `10.200.{b1}.{b2}/24` and
/// the host end gets `10.200.{b1}.1/24`.
///
/// Two bytes from the BLAKE3 hash give 64 009 unique subnets — collision
/// probability at 10 000 concurrent sessions is ≈1.2 × 10⁻⁶.
pub fn session_ip_block(session_id: &str) -> (u16, u16) {
    let hash = blake3::hash(session_id.as_bytes());
    let b = hash.as_bytes();
    let b1 = (u32::from_le_bytes([b[0], b[1], b[2], b[3]]) % 253 + 1) as u16;
    let b2 = (u32::from_le_bytes([b[4], b[5], b[6], b[7]]) % 253 + 1) as u16;
    (b1, b2)
}

// ── Filesystem jail (pivot_root script) ───────────────────────────────────

/// Build a shell script that runs INSIDE the unshared namespace to:
///   1. bind-mount system dirs (usr, lib, lib64, etc) read-only into merged/
///   2. bind-mount goose binary on host /tmp/ then move into merged/
///   3. mount proc, devtmpfs, tmpfs into merged/
///   4. configure networking (veth child already moved in by host)
///   5. double-bind merged/ with exec flag
///   6. pivot_root into merged/ (hides the host filesystem)
///   7. detach the old root
///   8. exec goose acp
///
/// `session_id` is used for a unique temp bind-mount path on /tmp.
/// `goose_bin` is the host path to the goose binary.
/// `b1`, `b2` are the IP block octets (child gets `10.200.{b1}.{b2}`).
/// Every step logs to stderr so the outer Rust stderr-drain captures it.
pub fn build_pivot_root_script(
    merged: &str,
    session_id: &str,
    goose_bin: &str,
    jail_tools_host: &str,
    goose_path_root_host: &str,
    claw_config_home_host: &str,
    b1: u16,
    b2: u16,
) -> String {
    let veth_child = format!("veth_c_{b1}_{b2}");
    let child_ip = format!("10.200.{b1}.{b2}/24");
    let child_gw = format!("10.200.{b1}.1");

    format!(
        r#"set -e
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

M="{merged}"
SID="{session_id}"
GB="{goose_bin}"
JTH="{jail_tools_host}"
GPRH="{goose_path_root_host}"
CFGH="{claw_config_home_host}"
VC="{veth_child}"
CIP="{child_ip}"
CGW="{child_gw}"

echo "[pivot] step 0: bind merged root onto itself" >&2
mkdir -p "$M"
mount --bind "$M" "$M"
mount -o remount,bind,exec "$M" "$M"

echo "[pivot] step 1: mount jail tools (custom static busybox) - NO host system dirs" >&2
mkdir -p "$M/tools" "/tmp/educraw_tools_$SID"
mount --bind "$JTH" "/tmp/educraw_tools_$SID"
mount --move "/tmp/educraw_tools_$SID" "$M/tools"
mount -o remount,bind,exec "$M/tools"

echo "[pivot] step 2: mount goose binary (existing mechanism preserved)" >&2
mkdir -p "$M"
rm -rf "$M/goose"
touch "$M/goose"
touch "/tmp/educraw_goose_$SID"
mount --bind "$GB" "/tmp/educraw_goose_$SID"
mount -o remount,bind,exec "/tmp/educraw_goose_$SID" >/dev/null 2>&1 || true
mount --move "/tmp/educraw_goose_$SID" "$M/goose"
mount -o remount,bind,exec "$M/goose" >/dev/null 2>&1 || true

echo "[pivot] step 3: bind student data dirs into jail" >&2
mkdir -p "$GPRH" "$CFGH"
mkdir -p "$M/goose_home" "$M/claw_config"
mount --bind "$GPRH" "$M/goose_home"
mount --bind "$CFGH" "$M/claw_config"



echo "[pivot] step 4: mount runtime filesystems" >&2
mkdir -p "$M/proc" "$M/dev" "$M/tmp" "$M/run" "$M/etc"
mount -t proc proc "$M/proc"
mount -t devtmpfs devtmpfs "$M/dev"
mount -t tmpfs tmpfs "$M/tmp"
mount -t tmpfs tmpfs "$M/run"

# Package manager caches -> tmpfs
mkdir -p "$M/tmp/pip-cache" "$M/tmp/npm-cache" "$M/tmp/cargo-home"

echo "[pivot] step 5: configure network" >&2
for _ in 1 2 3 4 5 6 7 8 9 10; do
  ip link show "$VC" >/dev/null 2>&1 && break
  sleep 0.05 2>/dev/null || true
done
ip link set lo up
ip addr add "$CIP" dev "$VC" >/dev/null 2>&1
ip link set "$VC" up >/dev/null 2>&1
ip route add default via "$CGW" >/dev/null 2>&1

echo "[pivot] step 6: write resolv.conf to tmpfs /etc" >&2
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\noptions edns0 trust-ad\n' > "$M/etc/resolv.conf"

echo "[pivot] step 7: pivot_root into merged" >&2
cd "$M"
mkdir -p .old_root
pivot_root . .old_root
cd /
umount -l /.old_root 2>/dev/null || true
rmdir /.old_root 2>/dev/null || true

export PATH="/tools/busybox"

echo "[pivot] step 8: exec goose" >&2
exec /goose acp
"#
    )
}

// ── Network namespace (veth pair setup / teardown) ─────────────────────────

/// Create a veth pair, move the child end into the goose's network namespace,
/// and configure the host end.  The child end IP/routing is configured by the
/// inner script (build_pivot_root_script) which runs as root inside the user
/// namespace — avoiding the nsenter -U -n issue with non-root servers.
pub async fn setup_veth_pair(pid: u32, b1: u16, b2: u16) -> Result<()> {
    let veth_host = format!("veth_h_{b1}_{b2}");
    let veth_child = format!("veth_c_{b1}_{b2}");
    let host_ip = format!("10.200.{b1}.1/24");

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

    // 3. Child side IP/routing is configured by the inner pivot_root script
    //    (build_pivot_root_script).  We do NOT nsenter here because non-root
    //    servers cannot enter another user namespace via setns().

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
pub async fn cleanup_veth(b1: u16, b2: u16) {
    let veth_host = format!("veth_h_{b1}_{b2}");
    let _ = Command::new("ip")
        .args(["link", "delete", &veth_host])
        .output()
        .await;
}
