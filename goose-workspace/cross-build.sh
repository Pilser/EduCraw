#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

SELF_CONTAINED="$(rustc --print sysroot)/lib/rustlib/x86_64-unknown-linux-musl/lib/self-contained"

export AR_x86_64_unknown_linux_musl="ar"
export PKG_CONFIG_ALLOW_CROSS=1
# Don't set ZSTD_SYS_USE_PKG_CONFIG at all — any value means "use pkg-config"
# Instead, explicitly disable pkg-config discovery for zstd
export LIBZSTD_NO_PKG_CONFIG=1
export BZIP2_NO_PKG_CONFIG=1
export LIBRARY_PATH="${SELF_CONTAINED}:${LIBRARY_PATH:-}"

exec cargo build --release --target x86_64-unknown-linux-musl --package goose-cli "$@"
