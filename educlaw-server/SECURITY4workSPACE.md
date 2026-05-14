# EduClaw Session Security

## The problem: overlayfs does not confine

The current setup mounts fuse-overlayfs into `merged/` and sets CWD there, but the agent still sees the **full host filesystem** because `unshare --mount` inherits all host mounts. The agent can simply `cd /`:

```
ls /          → shows the real host root
cat /etc/shadow  → works (if permissions allow)
```

The overlayfs provides content in one directory, but the agent is not locked inside it.

## The fix: pivot_root

`pivot_root` makes `merged/` the new `/` and detaches the old host root. The agent physically cannot resolve paths outside the overlayfs, even as root.

### Integration into `src/session/namespace.rs`

Current code (line 77-78):
```rust
cmd.args(["--user", "--map-root-user", "--mount", "--pid", "--fork",
    "sh", "-c", &claw_cmd]);
```

Replace with a wrapper script:
```rust
let merged = params.dirs.merged.display().to_string();
let inner_script = format!(
    r#"
set -e
M="{merged}"

# 1. Mount host system dirs read-only (libc, curl, python, SSL certs)
mount --bind /usr "$M/usr"
mount --bind /lib "$M/lib"
mount --bind /lib64 "$M/lib64" 2>/dev/null || true
mount --bind /etc "$M/etc"
mount -o remount,ro,bind "$M/usr"
mount -o remount,ro,bind "$M/lib"
mount -o remount,ro,bind "$M/lib64" 2>/dev/null || true
mount -o remount,ro,bind "$M/etc"

# 2. Make merged a mount point (required by pivot_root)
mount --bind "$M" "$M"

# 3. Rotate root
mkdir -p "$M/.old_root"
cd "$M"
pivot_root . .old_root
cd /

# 4. Detach old root
umount -l /.old_root
rmdir /.old_root 2>/dev/null || true

# 5. Runtime filesystems
mount -t proc proc /proc
mount -t devtmpfs devtmpfs /dev
mount -t tmpfs tmpfs /tmp

# 6. Launch agent
exec {claw_cmd}
"#
);
cmd.args(["--user", "--map-root-user", "--mount", "--pid", "--fork",
    "sh", "-c", &inner_script]);
```

### Verification

```bash
ls /                  # only overlayfs files
cat /etc/shadow       # ENOENT
ls /home              # ENOENT
python3 -c "import os; print(os.listdir('/'))"
```

---

## Network namespace isolation

Add `--net` to the unshare flags so the agent gets its own virtual network stack. This eliminates port collisions and prevents network-level escapes.

```diff
- "--user", "--map-root-user", "--mount", "--pid", "--fork",
+ "--user", "--map-root-user", "--mount", "--pid", "--net", "--fork",
```

### Option A: Configure veth from inside (in the pivot_root script)

Add before the pivot_root block (host root still visible, `ip` binary accessible):

```bash
# Inside namespace, before pivot_root
ip link set lo up
ip link add veth_child type veth peer name veth_host
ip addr add 10.200.1.2/24 dev veth_child
ip link set veth_child up
ip link set veth_host netns 1   # give host end back to init netns
ip route add default via 10.200.1.1
```

On the host side, after spawning, move the host end into the initial namespace and configure:
```bash
# Wait for the veth_host to appear in init netns
ip link set veth_host netns 1 2>/dev/null || true
ip addr add 10.200.1.1/24 dev veth_host
ip link set veth_host up
echo 1 > /proc/sys/net/ipv4/ip_forward
iptables -t nat -A POSTROUTING -s 10.200.1.0/24 -j MASQUERADE
```

### Option B: Configure veth entirely from the host via nsenter (recommended)

After `spawn_claw_session()` returns the PID, the Rust server configures everything:

```rust
let pid = spawn_claw_session(&params).await?;

// Create veth pair
Command::new("ip")
    .args(["link", "add", "veth_host", "type", "veth", "peer", "name", "veth_child"])
    .spawn()?;

// Move child end into agent's network namespace
// Uses -U to enter the user namespace too (needed because --user was used)
Command::new("ip")
    .args(["link", "set", "veth_child", "netns", &pid.to_string()])
    .spawn()?;

// Configure child side via nsenter -U (user ns) + -n (net ns)
// Inside the user namespace the process is root(0) with full capabilities
nsenter_exec(&pid, &["ip", "addr", "add", "10.200.1.2/24", "dev", "veth_child"])?;
nsenter_exec(&pid, &["ip", "link", "set", "lo", "up"])?;
nsenter_exec(&pid, &["ip", "link", "set", "veth_child", "up"])?;
nsenter_exec(&pid, &["ip", "route", "add", "default", "via", "10.200.1.1"])?;

// Configure host side
Command::new("ip")
    .args(["addr", "add", "10.200.1.1/24", "dev", "veth_host"])
    .spawn()?;
Command::new("ip")
    .args(["link", "set", "veth_host", "up"])
    .spawn()?;
```

Where `nsenter_exec` is:
```rust
fn nsenter_exec(pid: &u32, args: &[&str]) -> Result<()> {
    let mut cmd = Command::new("nsenter");
    cmd.args(["-t", &pid.to_string(), "-U", "-n", "--"]);
    cmd.args(args);
    cmd.spawn()?;
    Ok(())
}
```

**Why `-U` is needed:** `--user` creates a user namespace where the server's UID is mapped to root(0). The network namespace is owned by this user namespace. `nsenter` without `-U` would enter the network namespace but the process would run as the **host** UID (which is nobody inside), giving it zero capabilities. With `-U`, you enter the user namespace too, become root(0) inside it, and gain full capabilities over the network namespace.

---

## What is seccomp? (your current system)

A kernel-level firewall for system calls. Every action goes through a syscall — `open` (file), `kill` (signal), `ptrace` (debug), `reboot` (shutdown), etc.

Your `src/security/seccomp.rs` uses a **deny-list**: default-ALLOW, block the 17 most dangerous syscalls (`ptrace`, `reboot`, `bpf`, `module` loading, etc.). This is fine as-is.

---

## Summary: what to keep / add

| Component | Status | File |
|---|---|---|
| `unshare --user --map-root-user --mount --pid --fork` | ✅ Keep | `namespace.rs:78` |
| `fuse-overlayfs` | ✅ Keep | `namespace.rs:16-37` |
| **pivot_root** | ❌ **Must add** — closes the escape hole | Add to inner script |
| **`--net` + veth** | ❌ **Should add** — prevents port collisions | Add flag + host-side nsenter config |
| seccomp deny-list | ✅ Keep as-is | `seccomp.rs` |
| cgroups v2 | ✅ Keep | `cgroups.rs` |
| watchdog | ✅ Keep | `watchdog.rs` |
