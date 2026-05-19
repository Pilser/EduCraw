#!/bin/bash
set -euo pipefail

# Resolve the directory this script lives in (portable across symlinks)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/bin"

# All data stays in the script's directory
export DB_PATH="$SCRIPT_DIR/db/"
export FTS_GENERATION_CACHE_DISK_ROOT="$SCRIPT_DIR/fts/"
export FTS_GENERATION_CACHE_MEMORY_BYTES=1048576
export FTS_GENERATION_CACHE_DISK_BYTES=1048576

# Helix networking
export BACKEND_ADDR="http://127.0.0.1:50051"
export LISTEN_ADDR="${HELIX_LISTEN_ADDR:-0.0.0.0:8080}"

# Storage mode: IN_MEMORY or configure S3/MinIO via env vars
export S3_BUCKET="${HELIX_S3_BUCKET:-IN_MEMORY}"
export S3_REGION="${HELIX_S3_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${HELIX_AWS_ACCESS_KEY_ID:-}"
export AWS_SECRET_ACCESS_KEY="${HELIX_AWS_SECRET_ACCESS_KEY:-}"
export AWS_ENDPOINT="${HELIX_AWS_ENDPOINT:-}"
export AWS_ALLOW_HTTP="${HELIX_AWS_ALLOW_HTTP:-true}"

# Logging
export RUST_LOG="${HELIX_RUST_LOG:-gateway=info,hyperscale=info,helix::db::helix_db=info,slatedb=info}"

# Create local data directories
mkdir -p "$SCRIPT_DIR/db" "$SCRIPT_DIR/fts"

# Validate binaries exist
for bin in hyperscale gateway; do
  if [[ ! -x "$BIN_DIR/$bin" ]]; then
    echo "Error: $BIN_DIR/$bin not found or not executable" >&2
    echo "Place the helix binaries in: $BIN_DIR/" >&2
    exit 1
  fi
done

# Patch Nix interpreter to system linker if needed
SYSTEM_LINKER="/lib64/ld-linux-x86-64.so.2"
for bin in hyperscale gateway tini; do
  if [[ -f "$BIN_DIR/$bin" ]]; then
    CURRENT_INTERP=$(patchelf --print-interpreter "$BIN_DIR/$bin" 2>/dev/null || echo "")
    if [[ "$CURRENT_INTERP" == /nix/store/* ]]; then
      if command -v patchelf &>/dev/null; then
        echo "Patching $bin to use system linker..."
        chmod u+w "$BIN_DIR/$bin"
        patchelf --set-interpreter "$SYSTEM_LINKER" "$BIN_DIR/$bin"
      else
        echo "Error: $bin uses Nix linker but 'patchelf' is not installed" >&2
        echo "Install with: sudo apt install patchelf" >&2
        exit 1
      fi
    fi
  fi
done

# Ensure grpcurl is available (download to bin/ if missing)
GRPCURL="$BIN_DIR/grpcurl"
if [[ ! -x "$GRPCURL" ]]; then
  if ! command -v grpcurl &>/dev/null; then
    echo "Downloading grpcurl..."
    GRPCURL_URL="https://github.com/fullstorydev/grpcurl/releases/download/v1.9.3/grpcurl_1.9.3_linux_x86_64.tar.gz"
    curl -sL "$GRPCURL_URL" | tar xz -C "$BIN_DIR" grpcurl
    chmod +x "$GRPCURL"
    echo "grpcurl installed to $BIN_DIR/"
  else
    GRPCURL="$(command -v grpcurl)"
  fi
fi

# Ensure netcat is available
if ! command -v nc &>/dev/null; then
  echo "Error: 'nc' (netcat) not found in PATH" >&2
  echo "Install with: sudo apt install netcat-openbsd" >&2
  exit 1
fi

# Cleanup handler
cleanup() {
  echo ""
  echo "Shutting down HelixDB..."
  set +e
  [[ -n "${GATEWAY_PID:-}" ]] && kill "$GATEWAY_PID" 2>/dev/null && wait "$GATEWAY_PID" 2>/dev/null
  [[ -n "${HYPERSCALE_PID:-}" ]] && kill "$HYPERSCALE_PID" 2>/dev/null && wait "$HYPERSCALE_PID" 2>/dev/null
  set -e
  echo "Stopped."
  exit 0
}

trap cleanup INT TERM

echo "=== HelixDB ==="
echo "Data dir:    $SCRIPT_DIR/db/"
echo "FTS cache:   $SCRIPT_DIR/fts/"
echo "Storage:     $S3_BUCKET"
echo "Gateway:     http://$LISTEN_ADDR"
echo ""

# Start hyperscale (core DB engine)
echo "Starting hyperscale..."
"$BIN_DIR/hyperscale" &
HYPERSCALE_PID=$!

# Wait for hyperscale to accept gRPC connections
echo "Waiting for hyperscale on :50051..."
timeout=60
for i in $(seq 1 $timeout); do
  if nc -z 127.0.0.1 50051 2>/dev/null; then
    echo "hyperscale ready (${i}s)"
    break
  fi
  if ! kill -0 "$HYPERSCALE_PID" 2>/dev/null; then
    echo "Error: hyperscale exited unexpectedly" >&2
    exit 1
  fi
  if [[ $i -eq $timeout ]]; then
    echo "Error: hyperscale did not become ready within ${timeout}s" >&2
    exit 1
  fi
  sleep 1
done

# Bootstrap writer via gRPC
echo "Bootstrapping writer..."
"$GRPCURL" -plaintext -protoset "$SCRIPT_DIR/gateway.protoset" \
  -d '{"term":1,"op_id":"host-bootstrap"}' \
  127.0.0.1:50051 gateway.BackendService/Promote >/dev/null 2>&1 || true

# Start gateway (HTTP API)
echo "Starting gateway..."
"$BIN_DIR/gateway" &
GATEWAY_PID=$!

echo ""
echo "HelixDB is running!"
echo "  API:     http://localhost:${LISTEN_ADDR##*:}"
echo "  Data:    $SCRIPT_DIR/db/"
echo "  Press Ctrl+C to stop"
echo ""

# Wait for either process to exit
wait "$HYPERSCALE_PID" "$GATEWAY_PID" 2>/dev/null || true
cleanup
