# Cross-Build Guide: Fully Static musl Binary

## Build Environment

| Component | Version |
|---|---|
| OS | Ubuntu 25.10 ("Questing Quokka") |
| Rust | 1.95.0 (2026-04-14) |
| GCC | 15.2.0-4ubuntu4 |
| musl | 1.2.5-3 |

## Problem

Building `goose-cli` with `x86_64-unknown-linux-musl` target produced linker errors:

```
undefined reference to 'log', 'pow', 'expf', 'log2', 'powf', 'exp2f'
undefined reference to '__gcc_personality_v0'
```

### Root Cause

The `zstd-sys` crate's build script discovered the system `libzstd` via pkg-config and emitted:

```
cargo:rustc-link-search=native=/usr/lib/x86_64-linux-gnu
cargo:rustc-link-lib=zstd
```

This injected `/usr/lib/x86_64-linux-gnu` into the linker search path **before** Rust's self-contained musl CRT path (`<sysroot>/lib/rustlib/x86_64-unknown-linux-musl/lib/self-contained/`). The linker then resolved `-lc` to glibc's `libc.a` (`/usr/lib/x86_64-linux-gnu/libc.a`) instead of musl's `libc.a` (6.1M in the self-contained directory).

Glibc's `libc.a` caused two problems:
1. **Missing math symbols** — glibc splits math functions into `libm.a` (not linked), while musl bundles everything into `libc.a`.
2. **`__gcc_personality_v0`** — glibc's `qsort.o` references this symbol from `libgcc_eh`, which isn't linked.

Worse, `ZSTD_SYS_USE_PKG_CONFIG=0` was set in the build script, but this **enabled** pkg-config (the crate treats *any* set value as "use pkg-config").

## Solution

Three changes were made:

### 1. Linker Wrapper Script (`musl-cc`)

A wrapper around `x86_64-linux-musl-gcc` that strips banned glibc library paths from the linker arguments:

- Intercepts `-L` flags pointing to `/usr/lib/x86_64-linux-gnu`, `/usr/lib/gcc/x86_64-linux-gnu`, and `/usr/lib/x86_64-linux-musl`
- Handles both `-L/path` (joined) and `-L /path` (separate) argument forms
- Passes all other arguments through to the real compiler

### 2. Cargo Config (`.cargo/config.toml`)

Configured the target to use the wrapper script and enable static CRT:

```toml
[target.x86_64-unknown-linux-musl]
linker = "/path/to/goose-workspace/musl-cc"
rustflags = ["-C", "target-feature=+crt-static"]
```

### 3. Build Script Fixes (`cross-build.sh`)

- **Removed `ZSTD_SYS_USE_PKG_CONFIG=0`** — was actually enabling pkg-config for zstd-sys
- **Added `LIBZSTD_NO_PKG_CONFIG=1`** — explicitly disables pkg-config, forcing zstd-sys to build from source
- **Kept `BZIP2_NO_PKG_CONFIG=1`** — already correct
- **Set `AR_x86_64_unknown_linux_musl=ar`** — required by `ring`'s build script
- **Set `LIBRARY_PATH`** — points to the self-contained directory as fallback

## Additional Cargo.toml Changes

### Workspace `Cargo.toml`
```toml
[profile.release]
opt-level = 3
lto = "fat"
codegen-units = 1
panic = "abort"
strip = "none"
debug = 0
```

### `crates/goose/Cargo.toml`
Added bundled libsqlite3-sys (sqlx already bundles sqlite by default in 0.8.6, but the explicit dependency ensures it):
```toml
libsqlite3-sys = { version = "0.30", features = ["bundled"] }
```

### `crates/goose-cli/Cargo.toml`
Replaced `regex-onig` (requires oniguruma C library) with `regex-fancy` (pure Rust):
```toml
bat = { version = "0.26.1", default-features = false }
syntect = { version = "5.3", default-features = false, features = ["regex-fancy", "parsing", "default-syntaxes", "default-themes"] }
```

## TLS/SSL

The project already uses `rustls-tls` (pure Rust, no OpenSSL dependency). It is the default feature:

```toml
default = ["rustls-tls"]
```

## Build Command

```bash
./cross-build.sh
```

Which runs:
```bash
cargo build --release --target x86_64-unknown-linux-musl --package goose-cli
```

## Verification

The resulting binary is fully static:

```
$ file target/x86_64-unknown-linux-musl/release/goose
ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), static-pie linked, with debug_info, not stripped

$ ldd target/x86_64-unknown-linux-musl/release/goose
statically linked
```

## Key Files

| File | Purpose |
|---|---|
| `musl-cc` | Linker wrapper that strips glibc paths |
| `.cargo/config.toml` | Target-specific linker and rustflags |
| `cross-build.sh` | Build script with required environment variables |
