# HelixDB Host Runtime Guide

Binaries extracted from `ghcr.io/helixdb/enterprise-dev:latest` (Nix-built container).

## Extracted Binaries

| Binary | Size | Type | Purpose |
|--------|------|------|---------|
| `bin/hyperscale` | 40.5 MB | ELF 64-bit x86-64 | Core DB engine — handles storage, replication, gRPC backend on `:50051` |
| `bin/gateway` | 34.3 MB | ELF 64-bit x86-64 | HTTP API gateway — serves REST/gRPC-Web on `:8080` |
| `bin/tini` | 27 KB | ELF 64-bit x86-64 | Init process — PID 1 signal forwarding (optional, for container-like process management) |
| `bin/enterprise-dev-entrypoint` | 3.2 KB | Bash script | Orchestrator — starts hyperscale, waits for readiness, bootstraps writer, then starts gateway |
| `gateway.protoset` | 4.6 KB | Protobuf | gRPC service definitions for `grpcurl` bootstrap calls |

## Runtime Requirements

### Shared Libraries

All three ELF binaries are **dynamically linked against glibc 2.40**. On the host they resolve to the system's glibc:

```
libgcc_s.so.1
libm.so.6
libc.so.6
ld-linux-x86-64.so.2
```

**No Nix store required** — the Nix interpreter path is remapped to `/lib64/ld-linux-x86-64.so.2` on the host.

### External Tools (for entrypoint script)

The `enterprise-dev-entrypoint` script requires these to be on `$PATH`:

| Tool | Used For | Install on Ubuntu |
|------|----------|-------------------|
| `bash` (5.x) | Script interpreter | Pre-installed |
| `patchelf` | Patches Nix linker to system linker on first run | `sudo apt install patchelf` |
| `nc` (netcat) | Health check — polls TCP port 50051 | `sudo apt install netcat-openbsd` |
| `grpcurl` | Bootstrap — calls `Promote` and `Health` gRPC methods | Auto-downloaded to `bin/` on first run |
| `coreutils` | `kill`, `sleep`, `wait`, etc. | Pre-installed |

### Required Directories

```
db/          — Database storage (configurable via DB_PATH)
/tmp/fts     — Full-text search generation cache (configurable via FTS_GENERATION_CACHE_DISK_ROOT)
```

## Ubuntu Compatibility

**Tested on: Ubuntu 25.10 (Questing)**

The binaries **will run on Ubuntu** provided the system glibc version is **>= 2.40**. Check your glibc:

```bash
ldd --version
```

| Ubuntu Version | glibc Version | Compatible? |
|----------------|---------------|-------------|
| 25.10 (Questing) | 2.40 | Yes |
| 25.04 (Plucky) | 2.40 | Yes |
| 24.04 LTS (Noble) | 2.39 | **No** — glibc too old |
| 22.04 LTS (Jammy) | 2.35 | **No** — glibc too old |

If your glibc is too old, you have two options:
1. **Run in Docker** (the original container works everywhere)
2. **Statically link** or rebuild from source (if source is available)

### Verify on Your System

```bash
ldd .helix/bin/hyperscale
ldd .helix/bin/gateway
```

If all libraries resolve (no "not found" lines), the binaries will run.

## Running on Host

### Quick Start: `helix-run.sh`

Drop the `bin/` folder, `gateway.protoset`, and `helix-run.sh` into any directory and run:

```bash
./helix-run.sh
```

All data (`db/`, `fts/`) is created in that same directory. Defaults to `IN_MEMORY` storage.

To use MinIO, set env vars before running:

```bash
export HELIX_S3_BUCKET=helix-db
export HELIX_AWS_ACCESS_KEY_ID=minioadmin
export HELIX_AWS_SECRET_ACCESS_KEY=minioadmin
export HELIX_AWS_ENDPOINT=http://127.0.0.1:9000
./helix-run.sh
```

### Option 1: Direct Binary Launch (Simplest)

Skip the entrypoint script and run the binaries directly:

```bash
# Set environment
export BACKEND_ADDR="http://127.0.0.1:50051"
export LISTEN_ADDR="0.0.0.0:8080"
export S3_BUCKET="IN_MEMORY"  # or configure MinIO (see below)
export DB_PATH="db/"
export FTS_GENERATION_CACHE_DISK_ROOT="/tmp/fts"

# Create required dirs
mkdir -p db /tmp/fts

# Start hyperscale (DB engine) in background
.helix/bin/hyperscale &

# Wait for it to be ready
sleep 3

# Start gateway (API) in background
.helix/bin/gateway &
```

Access the API at `http://localhost:8080`.

### Option 2: Using the Entrypoint Script

First fix the shebang and PATH in the entrypoint:

```bash
# Fix shebang to use system bash
sed -i '1s|.*|#!/bin/bash|' .helix/bin/enterprise-dev-entrypoint

# Make sure dependencies are installed
sudo apt install netcat-openbsd grpcurl

# Set environment and run
export BACKEND_ADDR="http://127.0.0.1:50051"
export LISTEN_ADDR="0.0.0.0:8080"
export S3_BUCKET="IN_MEMORY"
export DB_PATH="db/"

mkdir -p db /tmp/fts

.helix/bin/enterprise-dev-entrypoint
```

### Option 3: Full Setup with MinIO (Persistent Storage)

See the MinIO section below for running MinIO on the host and configuring Helix to use it.

## MinIO Integration

HelixDB uses MinIO as an S3-compatible object storage backend for persistent data. When `S3_BUCKET` is set to anything other than `IN_MEMORY`, Helix connects to MinIO to store database files.

### Running MinIO on Host

#### Install MinIO

```bash
# Download MinIO server binary
curl -LO https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/

# Download MinIO client (mc) — optional but useful
curl -LO https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x mc
sudo mv mc /usr/local/bin/
```

#### Start MinIO Server

```bash
# Create data directory
mkdir -p ~/minio-data

# Set credentials
export MINIO_ROOT_USER=minioadmin
export MINIO_ROOT_PASSWORD=minioadmin

# Start MinIO (default: :9000 API, :9001 console)
minio server ~/minio-data --console-address :9001 &
```

MinIO will be available at:
- **API**: `http://localhost:9000`
- **Console**: `http://localhost:9001` (login with `minioadmin`/`minioadmin`)

#### Create the Bucket

```bash
# Configure mc client
mc alias set local http://localhost:9000 minioadmin minioadmin

# Create the helix-db bucket
mc mb local/helix-db
```

### Configure Helix to Use Host MinIO

```bash
export AWS_ACCESS_KEY_ID=minioadmin
export AWS_SECRET_ACCESS_KEY=minioadmin
export AWS_ENDPOINT=http://127.0.0.1:9000
export AWS_ALLOW_HTTP=true
export S3_BUCKET=helix-db
export S3_REGION=us-east-1
export DB_PATH=db/
export BACKEND_ADDR="http://127.0.0.1:50051"
export LISTEN_ADDR="0.0.0.0:8080"
export FTS_GENERATION_CACHE_DISK_ROOT="/tmp/fts"

mkdir -p db /tmp/fts

# Start Helix
.helix/bin/hyperscale &
sleep 3
.helix/bin/gateway &
```

### Full Host Startup Script

Create `.helix/start.sh`:

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$SCRIPT_DIR/bin"

# MinIO config
export MINIO_ROOT_USER=minioadmin
export MINIO_ROOT_PASSWORD=minioadmin
export AWS_ACCESS_KEY_ID=minioadmin
export AWS_SECRET_ACCESS_KEY=minioadmin
export AWS_ENDPOINT=http://127.0.0.1:9000
export AWS_ALLOW_HTTP=true
export S3_BUCKET=helix-db
export S3_REGION=us-east-1

# Helix config
export DB_PATH="$SCRIPT_DIR/db/"
export BACKEND_ADDR="http://127.0.0.1:50051"
export LISTEN_ADDR="0.0.0.0:8080"
export FTS_GENERATION_CACHE_DISK_ROOT="/tmp/fts"
export FTS_GENERATION_CACHE_MEMORY_BYTES=1048576
export FTS_GENERATION_CACHE_DISK_BYTES=1048576
export RUST_LOG="gateway=info,hyperscale=info,helix::db::helix_db=info,slatedb=info"

mkdir -p "$SCRIPT_DIR/db" /tmp/fts

echo "Starting MinIO..."
minio server ~/minio-data --console-address :9001 &
MINIO_PID=$!

echo "Waiting for MinIO..."
sleep 3

# Create bucket if it doesn't exist
mc alias set local http://127.0.0.1:9000 minioadmin minioadmin 2>/dev/null || true
mc mb local/helix-db 2>/dev/null || true

echo "Starting hyperscale..."
"$BIN_DIR/hyperscale" &
HYPERSCALE_PID=$!

echo "Waiting for hyperscale to accept gRPC on :50051..."
for i in $(seq 1 60); do
  if nc -z 127.0.0.1 50051 2>/dev/null; then
    echo "hyperscale ready"
    break
  fi
  if ! kill -0 "$HYPERSCALE_PID" 2>/dev/null; then
    echo "hyperscale failed to start"
    exit 1
  fi
  sleep 1
done

echo "Bootstrapping writer..."
grpcurl -plaintext -protoset "$SCRIPT_DIR/gateway.protoset" \
  -d '{"term":1,"op_id":"host-bootstrap"}' \
  127.0.0.1:50051 gateway.BackendService/Promote >/dev/null 2>&1 || true

echo "Starting gateway..."
"$BIN_DIR/gateway" &
GATEWAY_PID=$!

echo "HelixDB running:"
echo "  Gateway: http://localhost:8080"
echo "  MinIO Console: http://localhost:9001"

# Wait for any process to exit
wait -n "$HYPERSCALE_PID" "$GATEWAY_PID" "$MINIO_PID" || true

echo "Shutting down..."
kill "$GATEWAY_PID" "$HYPERSCALE_PID" "$MINIO_PID" 2>/dev/null || true
wait
```

```bash
chmod +x .helix/start.sh
.helix/start.sh
```

### In-Memory Mode (No MinIO Required)

For development/testing without MinIO:

```bash
export S3_BUCKET="IN_MEMORY"
export DB_PATH="db/"
export BACKEND_ADDR="http://127.0.0.1:50051"
export LISTEN_ADDR="0.0.0.0:8080"

mkdir -p db

.helix/bin/hyperscale &
sleep 3
.helix/bin/gateway &
```

Note: Data in `IN_MEMORY` mode is lost on restart. The `db/` directory still stores some metadata via SlateDB.

## Architecture

```
Client (HTTP/gRPC-Web)
         |
         v
    [gateway] :8080
         |
         v
  [hyperscale] :50051 (gRPC)
         |
    +----+----+
    |         |
    v         v
  db/      MinIO (:9000)
  (local)  (object store)
```

- **gateway** — HTTP API, accepts queries on `:8080`, forwards to hyperscale via gRPC
- **hyperscale** — Core engine, gRPC backend on `:50051`, manages SlateDB storage and S3 sync
- **MinIO** — S3-compatible object storage for database persistence (optional, `IN_MEMORY` fallback)

## Stopping

```bash
# Kill all Helix processes
pkill -f hyperscale
pkill -f gateway
pkill -f minio
```
