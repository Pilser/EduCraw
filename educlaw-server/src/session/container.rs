use std::fs;
use std::io;
use std::os::unix::io::OwnedFd;
use std::path::{Path, PathBuf};
use std::time::Duration;

use libcontainer::container::builder::ContainerBuilder;
use libcontainer::container::Container;
use libcontainer::syscall::syscall::SyscallType;

use crate::error::{AppError, Result};

/// Paths and identities that define one OCI bundle for a session.
pub struct SessionBundle {
    pub session_id: String,
    /// Directory containing config.json + rootfs/
    pub bundle_dir: PathBuf,
    /// OCI rootfs: tmpfs mount point, bind targets will appear here
    pub rootfs: PathBuf,
}

/// Sources for bind mounts inside the container.
pub struct BindSources {
    pub goose_bin: PathBuf,
    pub jail_tools: PathBuf,
    pub student_home: PathBuf,
    pub config_dir: PathBuf,
    pub ssl_certs: PathBuf,
    pub subject_dirs: Vec<PathBuf>,
}

/// Environment variables and model selection for the container process.
pub struct ContainerEnv {
    pub env_vars: Vec<(String, String)>,
    pub model: Option<String>,
}

// ── Bundle creation ──────────────────────────────────────────────────────────

impl SessionBundle {
    pub fn new(workspace_root: &str, session_id: &str) -> Self {
        let bundle_dir = PathBuf::from(workspace_root).join(session_id);
        let rootfs = bundle_dir.join("rootfs");
        Self {
            session_id: session_id.to_string(),
            bundle_dir,
            rootfs,
        }
    }

    /// Create the bundle directory structure and a clean empty rootfs.
    ///
    /// Removes any stale content from a previous session at the same path
    /// so that Youki's `prepare_rootfs` can create default devices and
    /// symlinks without `EEXIST` errors.
    pub fn create_dirs(&self) -> io::Result<()> {
        if self.rootfs.exists() {
            std::fs::remove_dir_all(&self.rootfs)?;
        }
        std::fs::create_dir_all(&self.rootfs)?;
        Ok(())
    }

    /// Remove the entire bundle directory.
    pub fn cleanup(&self) {
        let _ = std::fs::remove_dir_all(&self.bundle_dir);
    }
}

/// Build the OCI config.json at `bundle_dir/config.json`.
pub fn write_oci_config(
    bundle: &SessionBundle,
    sources: &BindSources,
    env: &ContainerEnv,
) -> Result<()> {
    let config_path = bundle.bundle_dir.join("config.json");

    let mut env_list: Vec<String> = Vec::new();
    for (k, v) in &env.env_vars {
        env_list.push(format!("{k}={v}"));
    }
    // Prepend busybox tools to PATH so goose can find sh, ls, etc.
    let tools_path = "/tools/busybox";
    let path_entry = env_list.iter_mut().find(|e| e.starts_with("PATH="));
    match path_entry {
        Some(val) => {
            let rest = val.trim_start_matches("PATH=");
            *val = format!("PATH={tools_path}:{rest}");
        }
        None => {
            env_list.push(format!("PATH={tools_path}:/bin:/usr/bin"));
        }
    }
    env_list.push("HOME=/".into());
    env_list.push("GOOSE_PATH_ROOT=/claw_config".into());
    env_list.push("CLAW_CONFIG_HOME=/claw_config".into());

    let args = vec!["/goose".to_string(), "acp".to_string()];
    // Bind mount sources (host path → container dest)
    let mut mounts: Vec<serde_json::Value> = Vec::new();

    // Runtime filesystems
    mounts.push(serde_json::json!({
        "destination": "/proc",
        "type": "proc",
        "source": "proc",
        "options": []
    }));
    // /dev is a tmpfs (not devtmpfs) so the kernel does NOT auto-populate
    // it.  Youki's prepare_rootfs runs after mounts are applied and creates
    // device nodes via Device::create_devices + symlinks via
    // Symlink::setup_kcore_symlink / setup_default_symlinks.
    // A devtmpfs mount would pre-create /dev/kcore as a device node,
    // causing EEXIST when setup_kcore_symlink later tries to symlink it.
    mounts.push(serde_json::json!({
        "destination": "/dev",
        "type": "tmpfs",
        "source": "tmpfs",
        "options": ["nosuid", "strictatime", "mode=755", "size=65536k"]
    }));
    mounts.push(serde_json::json!({
        "destination": "/tmp",
        "type": "tmpfs",
        "source": "tmpfs",
        "options": ["nosuid", "nodev", "noexec"]
    }));
    mounts.push(serde_json::json!({
        "destination": "/run",
        "type": "tmpfs",
        "source": "tmpfs",
        "options": ["nosuid", "nodev", "noexec"]
    }));

    // Bind mounts: goose binary
    mounts.push(serde_json::json!({
        "destination": "/goose",
        "type": "bind",
        "source": sources.goose_bin,
        "options": ["bind", "ro", "nosuid", "nodev"]
    }));

    // Bind mounts: jail tools
    mounts.push(serde_json::json!({
        "destination": "/tools",
        "type": "bind",
        "source": sources.jail_tools,
        "options": ["bind", "ro", "nosuid", "nodev"]
    }));

    // Bind mounts: session config (goose writes config/data/state here)
    mounts.push(serde_json::json!({
        "destination": "/claw_config",
        "type": "bind",
        "source": sources.config_dir,
        "options": ["bind", "nosuid", "nodev"]
    }));

    // Bind mounts: SSL certs
    mounts.push(serde_json::json!({
        "destination": "/etc/ssl",
        "type": "bind",
        "source": sources.ssl_certs,
        "options": ["bind", "ro", "nosuid", "nodev"]
    }));

    // Bind mounts: subject dirs (each at root level)
    for subject_dir in &sources.subject_dirs {
        if let Some(name) = subject_dir.file_name() {
            let dest = format!("/{}", name.to_string_lossy());
            mounts.push(serde_json::json!({
                "destination": dest,
                "type": "bind",
                "source": subject_dir,
                "options": ["bind", "ro", "nosuid", "nodev"]
            }));
        }
    }

    // Capabilities: start with minimal set, add what goose requires
    let caps = serde_json::json!([
        "CAP_NET_RAW",
        "CAP_DAC_OVERRIDE",
        "CAP_FOWNER",
        "CAP_CHOWN",
        "CAP_SETUID",
        "CAP_SETGID",
        "CAP_SETPCAP",
        "CAP_NET_BIND_SERVICE",
        "CAP_SYS_PTRACE",
        "CAP_SYS_ADMIN",
    ]);

    // Write resolv.conf for DNS inside the container
    let resolv_path = bundle.bundle_dir.join("resolv.conf");
    let resolv_content = "nameserver 1.1.1.1\nnameserver 8.8.8.8\noptions edns0 trust-ad\n";
    let _ = std::fs::write(&resolv_path, resolv_content);

    // Bind mount the resolv.conf into the container
    mounts.push(serde_json::json!({
        "destination": "/etc/resolv.conf",
        "type": "bind",
        "source": resolv_path,
        "options": ["bind", "ro", "nosuid", "nodev", "noexec"]
    }));

    // Seccomp: default-ALLOW + deny dangerous syscalls (matches build_student_filter)
    let blocked_syscalls = [
        "ptrace", "process_vm_readv", "process_vm_writev",
        "reboot", "kexec_load", "kexec_file_load",
        "syslog", "mknod", "mknodat",
        "create_module", "init_module", "finit_module", "delete_module",
        "perf_event_open", "bpf", "userfaultfd",
    ];

    let config = serde_json::json!({
        "ociVersion": "1.0.2",
        "process": {
            "terminal": false,
            "user": { "uid": 0, "gid": 0 },
            "args": args,
            "env": env_list,
            "cwd": "/",
            "capabilities": {
                "bounding": caps,
                "effective": caps,
                "permitted": caps,
                "ambient": caps
            },
            "rlimits": [
                { "type": "RLIMIT_NOFILE", "hard": 1024, "soft": 1024 }
            ],
            "noNewPrivileges": true
        },
        "root": {
            "path": sources.student_home,
            "readonly": false
        },
        "hostname": "sandbox",
        "mounts": mounts,
        "linux": {
            "namespaces": [
                { "type": "pid" },
                { "type": "network" },
                { "type": "mount" },
                { "type": "uts" },
                { "type": "ipc" }
            ],
            "resources": {
                "memory": { "limit": 536870912 },
                "pids": { "limit": 256 }
            },
            "seccomp": {
                "defaultAction": "SCMP_ACT_ALLOW",
                "architectures": ["SCMP_ARCH_X86_64"],
                "syscalls": [
                    {
                        "names": blocked_syscalls,
                        "action": "SCMP_ACT_KILL_PROCESS"
                    }
                ]
            }
        }
    });

    let json_str = serde_json::to_string_pretty(&config)
        .map_err(|e| AppError::Session(format!("serialize OCI config: {e}")))?;

    std::fs::write(&config_path, &json_str)
        .map_err(|e| AppError::Session(format!("write OCI config: {e}")))?;

    tracing::debug!(
        session_id = %bundle.session_id,
        config = %config_path.display(),
        "OCI config.json written"
    );
    Ok(())
}

/// Build a `Container` via libcontainer (Youki).
///
/// This creates the container process in a "Created" state (namespaces set up,
/// process forked but not yet exec'd). Call `start()` to begin execution.
///
/// **Note:** `ContainerBuilder` is `!Send`, so this runs synchronously.
/// It does NOT cross `.await` points.
pub fn build_container(
    bundle: &SessionBundle,
    stdin: Option<OwnedFd>,
    stdout: Option<OwnedFd>,
    stderr: Option<OwnedFd>,
) -> std::result::Result<Container, libcontainer::error::LibcontainerError> {
    tracing::debug!(
        session_id = %bundle.session_id,
        bundle = %bundle.bundle_dir.display(),
        rootfs = %bundle.rootfs.display(),
        "build_container: starting"
    );

    let mut builder = ContainerBuilder::new(
        bundle.session_id.clone(),
        SyscallType::default(),
    )
    .with_root_path(&bundle.bundle_dir)
    .expect("invalid root path for container state");

    if let Some(fd) = stdin {
        builder = builder.with_stdin(fd);
    }
    if let Some(fd) = stdout {
        builder = builder.with_stdout(fd);
    }
    if let Some(fd) = stderr {
        builder = builder.with_stderr(fd);
    }

    // Log OCI config for debugging
    let config_path = bundle.bundle_dir.join("config.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        tracing::debug!(
            session_id = %bundle.session_id,
            "OCI config.json:\n{}",
            content
        );
    }

    let mut init_builder = builder.as_init(&bundle.bundle_dir);
    init_builder = init_builder.with_systemd(false);
    init_builder = init_builder.as_sibling(false);
    init_builder = init_builder.with_detach(false);

    let result = init_builder.build();
    if let Err(ref e) = result {
        tracing::error!(
            session_id = %bundle.session_id,
            error = %e,
            "build_container failed"
        );
    }
    result
}

/// Start a previously created container (resume the paused init process).
pub fn start_container(container: &mut Container) -> std::result::Result<(), libcontainer::error::LibcontainerError> {
    container.start()
}

/// Send a signal to the container init process.
pub fn kill_container(
    container: &mut Container,
    signal: nix::sys::signal::Signal,
) -> std::result::Result<(), libcontainer::error::LibcontainerError> {
    container.kill(signal, false)
}

/// Delete the container (clean up namespaces, cgroups, state file).
pub fn delete_container(
    container: &mut Container,
    force: bool,
) -> std::result::Result<(), libcontainer::error::LibcontainerError> {
    container.delete(force)
}

/// Wait for the container process to exit (busy-poll with timeout).
pub fn wait_container(
    container: &mut Container,
    timeout: Duration,
) -> Result<()> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        container.refresh_status().map_err(|e| {
            AppError::Session(format!("refresh container status: {e}"))
        })?;
        let status = container.status();
        if status == libcontainer::container::state::ContainerStatus::Stopped {
            return Ok(());
        }
        if std::time::Instant::now() > deadline {
            return Err(AppError::Session("container did not stop within timeout".into()));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Collect subject directory paths for a cohort from the filesystem.
pub fn collect_subject_dirs(subjects_root: &Path, cohort_id: &str) -> Vec<PathBuf> {
    let cohort_dir = subjects_root.join(cohort_id);
    if !cohort_dir.exists() {
        return vec![];
    }
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&cohort_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    dirs.sort();
    dirs
}

/// Path to the Youki container state directory inside a bundle.
///
/// Youki stores runtime state at `{root_path}/{container_id}/state.json`.
/// We use `root_path = bundle_dir` and `container_id = session_id`,
/// so the state file lives at `{bundle_dir}/{session_id}/state.json`.
pub fn container_state_dir(bundle_dir: &Path, session_id: &str) -> PathBuf {
    bundle_dir.join(session_id)
}

/// Remove stale Youki runtime state for a container.
///
/// If a previous build left behind a state directory (e.g. after goose
/// exited and the session is being re‑initialised), remove it so that a
/// fresh `build_container` does not fail with "container already exists".
pub fn cleanup_container_state(bundle_dir: &Path, session_id: &str) {
    let state_dir = container_state_dir(bundle_dir, session_id);
    if state_dir.exists() {
        tracing::debug!(session_id, path = %state_dir.display(), "removing stale container state");
        let _ = fs::remove_dir_all(&state_dir);
    }
}

/// Clean up a stale container after server restart.
///
/// Reads the Youki state file to find the init process PID, kills it,
/// removes the state directory, and removes the bundle directory.
/// Best-effort: logs warnings on failure but never propagates errors.
pub fn cleanup_stale_container(workspace_root: &str, session_id: &str) {
    let bundle_dir = PathBuf::from(workspace_root).join(session_id);
    if !bundle_dir.exists() {
        return;
    }

    // Try to kill the container init process via Youki state file
    let state_dir = container_state_dir(&bundle_dir, session_id);
    let state_file = state_dir.join("state.json");
    if state_file.exists() {
        if let Ok(content) = fs::read_to_string(&state_file) {
            if let Ok(state) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(pid) = state.get("init_process_pid").and_then(|v| v.as_i64()) {
                    tracing::debug!(session_id, pid, "stale container: killing init process");
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .output();
                }
            }
        }
        // Remove state directory (best-effort)
        let _ = fs::remove_dir_all(&state_dir);
    }

    // Remove the entire bundle directory
    let _ = fs::remove_dir_all(&bundle_dir);
}

/// Kill an active container from the registry and delete it.
///
/// Sends SIGTERM and waits up to 5 seconds for the process to exit
/// before falling back to SIGKILL. This avoids the cgroup deletion
/// timeout that occurs when `delete()` is called while the process
/// is still running (cgroup v2 refuses to remove a cgroup with
/// attached processes).
pub fn kill_and_delete_container(container: &mut Option<Container>) {
    if let Some(ref mut c) = container {
        let _ = c.kill(nix::sys::signal::Signal::SIGTERM, false);

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut stopped = false;
        while std::time::Instant::now() < deadline {
            if c.refresh_status().is_ok()
                && c.status() == libcontainer::container::state::ContainerStatus::Stopped
            {
                stopped = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        if !stopped {
            let _ = c.kill(nix::sys::signal::Signal::SIGKILL, false);
            std::thread::sleep(Duration::from_millis(300));
        }

        let _ = c.delete(true);
    }
    *container = None;
}
