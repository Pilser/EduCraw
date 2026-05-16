#!/bin/bash
# ============================================================
# EduClaw Server — systemd setup script
#
# This script:
#   1. Creates the cgroup delegation directory (so the server
#      can create per-session cgroups without root)
#   2. Creates a systemd service file with CAP_SYS_ADMIN
#      (so the server can manage cgroups)
#   3. Enables the service to start on boot
#   4. Starts the service now
#
# All paths are read from .env — change them there, not here.
#
# Run with: sudo bash setup-systemd.sh
# ============================================================

set -e

# ── Config ────────────────────────────────────────────────────
PROJECT_DIR="/home/pilser/AA-Projects/EduCraw/educlaw-server"
SERVER_BIN="$PROJECT_DIR/target/release/educlaw-server"
ENV_FILE="$PROJECT_DIR/.env"
SERVICE_NAME="educlaw-server"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Detect the user running the server (default: current user)
SERVER_USER="${EDUCLAW_USER:-$(whoami)}"

# ── Helper: read a value from .env ───────────────────────────
# Usage: env_get KEY default_value
env_get() {
    local key="$1"
    local default="$2"
    if [ -f "$ENV_FILE" ]; then
        local val=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d'=' -f2-)
        if [ -n "$val" ]; then
            echo "$val"
            return
        fi
    fi
    echo "$default"
}

# ── Read all paths from .env (with fallback defaults) ────────
CGROUP_DIR=$(env_get "EDUCRAW_CGROUP_ROOT" "/sys/fs/cgroup/educraw")
WORKSPACE_ROOT=$(env_get "EDUCLAW_WORKSPACE_ROOT" "/var/lib/educraw/sessions")
SUBJECTS_ROOT=$(env_get "EDUCLAW_SUBJECTS_ROOT" "/srv/educraw/data/subjects")
STUDENTS_ROOT=$(env_get "EDUCLAW_STUDENTS_ROOT" "/srv/educraw/data/students")

# Derive parent writable dirs from the paths above
# e.g. /var/lib/educraw/sessions → /var/lib/educraw
#      /srv/educraw/data/subjects → /srv/educraw
VAR_LIB_DIR=$(echo "$WORKSPACE_ROOT" | sed 's|/sessions$||' | sed 's|/[^/]*$||')
SRV_DIR=$(echo "$SUBJECTS_ROOT" | sed 's|/data/subjects$||' | sed 's|/[^/]*$||')

# Build the ReadWritePaths list — only unique, non-empty entries
READ_WRITE_PATHS=""
for p in "$VAR_LIB_DIR" "$SRV_DIR" "$CGROUP_DIR" "$PROJECT_DIR"; do
    if [ -n "$p" ]; then
        READ_WRITE_PATHS="$READ_WRITE_PATHS $p"
    fi
done
READ_WRITE_PATHS=$(echo "$READ_WRITE_PATHS" | xargs)  # trim leading space

# ── Checks ────────────────────────────────────────────────────

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root (use sudo)"
    exit 1
fi

# ── Step 0: Kernel settings for namespace isolation ───────────
echo "[0/5] Configuring kernel sysctls..."

# Allow unprivileged user namespaces (required for unshare --user --map-root-user)
if [ "$(sysctl -n kernel.unprivileged_userns_clone 2>/dev/null)" != "1" ]; then
    sysctl -w kernel.unprivileged_userns_clone=1
    echo "kernel.unprivileged_userns_clone=1" > /etc/sysctl.d/99-educraw.conf
    echo "      kernel.unprivileged_userns_clone = 1"
else
    echo "      kernel.unprivileged_userns_clone = 1 (already set)"
fi

# Disable AppArmor restriction on unprivileged userns (Ubuntu 24.04+)
if [ "$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null)" != "0" ]; then
    sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
    echo "kernel.apparmor_restrict_unprivileged_userns=0" > /etc/sysctl.d/99-educraw-unpriv.conf
    echo "      kernel.apparmor_restrict_unprivileged_userns = 0"
else
    echo "      kernel.apparmor_restrict_unprivileged_userns = 0 (already set)"
fi

if [ ! -f "$SERVER_BIN" ]; then
    echo "ERROR: Server binary not found at $SERVER_BIN"
    echo "Run this first: cd $PROJECT_DIR && cargo build --release"
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: .env file not found at $ENV_FILE"
    exit 1
fi

# ── Step 1: Create cgroup delegation directory ────────────────

echo "[1/5] Creating cgroup delegation directory..."

mkdir -p "$CGROUP_DIR"
chown "$SERVER_USER:$SERVER_USER" "$CGROUP_DIR"

echo "      Created: $CGROUP_DIR (owned by $SERVER_USER)"

# ── Step 2: Create systemd service file ───────────────────────

echo "[2/5] Creating systemd service file..."

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=EduClaw Server
After=network.target

[Service]
Type=simple
ExecStart=$SERVER_BIN
WorkingDirectory=$PROJECT_DIR

# Run as the specified user (NOT root)
User=$SERVER_USER
Group=$SERVER_USER

# Grant CAP_SYS_ADMIN so the server can create/manage cgroups
AmbientCapabilities=CAP_SYS_ADMIN CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_SYS_ADMIN CAP_NET_BIND_SERVICE

# Auto-restart on crash
Restart=on-failure
RestartSec=5

# Load environment variables from .env file
EnvironmentFile=$ENV_FILE

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$READ_WRITE_PATHS

[Install]
WantedBy=multi-user.target
EOF

echo "      Created: $SERVICE_FILE"
echo "      ReadWritePaths: $READ_WRITE_PATHS"

# ── Step 3: Enable service on boot ────────────────────────────

echo "[3/5] Enabling service on boot..."

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "      Service enabled (will start on every boot)"

# ── Step 4: Start the service ─────────────────────────────────

echo "[4/5] Starting the service..."

systemctl start "$SERVICE_NAME"

sleep 2

if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo ""
    echo "SUCCESS: EduClaw server is running!"
    echo ""
    echo "  Status:  systemctl status $SERVICE_NAME"
    echo "  Logs:    journalctl -u $SERVICE_NAME -f"
    echo "  Stop:    systemctl stop $SERVICE_NAME"
    echo "  Restart: systemctl restart $SERVICE_NAME"
else
    echo ""
    echo "ERROR: Service failed to start. Check logs:"
    echo "  journalctl -u $SERVICE_NAME --no-pager -n 50"
    exit 1
fi
