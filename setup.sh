#!/bin/bash
# EduCraw Setup — Create production directories and deploy binaries
# Usage: sudo ./setup.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "This script must be run with sudo"
    exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRV=/srv/educraw
VAR=/var/lib/educraw
DEPLOY_USER="${SUDO_USER:-root}"

echo "Setting up EduCraw..."

# Create directories
mkdir -p "$SRV/bin" "$SRV/data/subjects"
mkdir -p "$VAR/sessions" "$VAR/students"

# Copy binaries
if [[ -d "$REPO_DIR/bin" ]]; then
    cp -r "$REPO_DIR/bin"/* "$SRV/bin/" 2>/dev/null || true
    echo "✓ Binaries copied to $SRV/bin"
else
    echo "✗ No bin/ folder found in repo"
fi

# Copy frontend
if [[ -d "$REPO_DIR/bin/web-ui" ]]; then
    mkdir -p "$SRV/bin/web-ui"
    cp -r "$REPO_DIR/bin/web-ui"/* "$SRV/bin/web-ui/" 2>/dev/null || true
    echo "✓ Frontend copied to $SRV/bin/web-ui"
fi

# Copy educlaw-server binary
if [[ -f "$REPO_DIR/bin/educlaw-server" ]]; then
    cp "$REPO_DIR/bin/educlaw-server" "$SRV/"
    chmod +x "$SRV/educlaw-server"
    echo "✓ educlaw-server copied to $SRV/"
else
    echo "~ educlaw-server binary not found in bin/ (skipped)"
fi

# Copy goose config template
if [[ -d "$REPO_DIR/test-goose-home/config" ]]; then
    mkdir -p "$SRV/templates/goose-config"
    cp -r "$REPO_DIR/test-goose-home/config" "$SRV/templates/goose-config/"
    [[ -f "$SRV/templates/goose-config/config/config.yaml" ]] && chmod 644 "$SRV/templates/goose-config/config/config.yaml"
    [[ -f "$SRV/templates/goose-config/config/secrets.yaml" ]] && chmod 600 "$SRV/templates/goose-config/config/secrets.yaml"
    echo "✓ Goose config template copied to $SRV/templates/goose-config"
else
    echo "~ test-goose-home/config not found (skipped)"
fi

# Copy .env
if [[ ! -f "$SRV/.env" ]]; then
    cp "$REPO_DIR/.env" "$SRV/.env"
    chmod 600 "$SRV/.env"
    echo "✓ .env created (edit it before running)"
else
    echo "~ .env already exists (skipped)"
fi

# Set permissions (skip mounted OverlayFS merged directories)
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$SRV" "$VAR" 2>/dev/null || true
chmod +x "$SRV/bin/goose" 2>/dev/null || true
chmod +x "$SRV/educlaw-server" 2>/dev/null || true

echo "✓ Permissions set for $DEPLOY_USER"
echo ""
echo "Next steps:"
echo "  1. Edit $SRV/.env and set your API keys"
echo "  2. Run: cd $SRV && ./educlaw-server"
