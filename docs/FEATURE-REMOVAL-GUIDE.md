## FEATURE REMOVAL GUIDE

**Recommended Approach: SYSTEMATIC TRACKING (Not Trial-and-Error)**

### Why Systematic Tracking?
- **Prevents breaking changes** - Know impact before removing
- **Enables planning** - Understand dependencies and alternatives
- **Reduces risk** - Avoid runtime failures from missing features
- **Better documentation** - Track why features were removed

### Step 1: Feature Usage Analysis
Run these commands to map feature usage BEFORE removing from Cargo.toml:

#### 1.1 Find All Feature References
```bash
# Find cfg(feature = "feature-name") usage
cd goose-creates
grep -r 'cfg(feature = "code-mode")' crates/goose/src/
grep -r 'cfg(feature = "local-inference")' crates/goose/src/
grep -r 'cfg(feature = "aws-providers")' crates/goose/src/
grep -r 'cfg(feature = "telemetry")' crates/goose/src/
grep -r 'cfg(feature = "otel")' crates/goose/src/
```

#### 1.2 Find Module Imports
```bash
# Find module declarations that might be feature-gated
grep -n "pub mod" crates/goose/src/lib.rs
grep -A5 -B5 "gateway\|scheduler" crates/goose/src/lib.rs
```

#### 1.3 Find Function Calls
```bash
# Find function calls that might depend on features
grep -r "posthog::" crates/goose/src/
grep -r "otel::" crates/goose/src/
grep -r "Bedrock\|SageMaker" crates/goose/src/
```

### Step 2: Dependency Analysis
Map the dependency chains:

#### Feature Dependencies:
- `local-inference` → enables `dictation` module
- `code-mode` → enables `code_execution` platform extension
- `telemetry` → enables `posthog.rs` module
- `otel` → enables `otel/` module
- `aws-providers` → enables AWS provider modules

#### Module Dependencies:
- `scheduler` → used by `agents/schedule_tool.rs`
- `gateway` → standalone module (check for usage)
- `dictation` → depends on `local-inference`

### Step 3: Removal Strategy by Feature

#### SAFE REMOVALS (Feature-Gated - Just Remove from Cargo.toml):

### 1. `code-mode` - Code Analysis (tree-sitter)
**Status**: ✅ SAFE - Feature-gated
**Removal Method**: Remove from Cargo.toml features list
**Files affected**: `crates/goose/src/agents/platform_extensions/code_execution.rs`
**Verification**: Build succeeds, `analyze` tool still works (basic mode)

### 2. `local-inference` - Local LLM Models (Whisper, GGUF)
**Status**: ✅ SAFE - Feature-gated
**Removal Method**: Remove from Cargo.toml features list
**Files affected**: `crates/goose/src/dictation.rs`, candle/llama-cpp dependencies
**Verification**: Build succeeds, no local model providers available

### 3. `aws-providers` - AWS Bedrock/SageMaker
**Status**: ✅ SAFE - Feature-gated
**Removal Method**: Remove from Cargo.toml features list
**Files affected**: AWS provider modules in `crates/goose/src/providers/`
**Verification**: Build succeeds, Anthropic/OpenAI providers still work

### 4. `telemetry` - PostHog Analytics
**Status**: ✅ SAFE - Feature-gated
**Removal Method**: Remove from Cargo.toml features list
**Files affected**: `crates/goose/src/posthog.rs`
**Verification**: Build succeeds, no analytics calls

### 5. `otel` - OpenTelemetry Tracing
**Status**: ✅ SAFE - Feature-gated
**Removal Method**: Remove from Cargo.toml features list
**Files affected**: `crates/goose/src/otel/` directory
**Verification**: Build succeeds, no tracing

#### CONDITIONAL REMOVALS (May Need Code Changes):

### 6. `gateway` - Telegram/Slack Integration
**Status**: ❌ REQUIRES CODE CHANGES - Not cfg-gated in lib.rs
**Current State**: Always compiled (line 19 in lib.rs: `pub mod gateway;`)
**Removal Method**:
1. Add feature gate in `crates/goose/src/lib.rs`:
   ```rust
   #[cfg(feature = "gateway")]
   pub mod gateway;
   ```
2. Add feature to `crates/goose/Cargo.toml`:
   ```toml
   gateway = []  # Empty feature since module has no dependencies
   ```
3. Remove from default features list
**Files affected**: `crates/goose/src/gateway.rs`, any code using gateway
**Verification**: Build succeeds, no Telegram/Slack integration

### 7. `scheduler` - Background Job Scheduling
**Status**: ❌ REQUIRES CODE CHANGES - Not cfg-gated in lib.rs  
**Current State**: Always compiled (lines 36-37 in lib.rs)
**Removal Method**:
1. Add feature gates in `crates/goose/src/lib.rs`:
   ```rust
   #[cfg(feature = "scheduler")]
   pub mod scheduler;
   #[cfg(feature = "scheduler")]
   pub mod scheduler_trait;
   ```
2. Add feature to `crates/goose/Cargo.toml`:
   ```toml
   scheduler = ["dep:tokio-cron-scheduler", "dep:chrono"]  # Add actual deps
   ```
3. Remove from default features list
4. Check `agents/schedule_tool.rs` for conditional compilation
**Files affected**: `crates/goose/src/scheduler.rs`, `crates/goose/src/scheduler_trait.rs`
**Verification**: Build succeeds, no cron scheduling available

### 8. `dictation` - Voice Input (Whisper)
**Status**: ✅ AUTO-REMOVED with `local-inference`
**Removal Method**: Removing `local-inference` automatically removes dictation
**Files affected**: `crates/goose/src/dictation.rs`
**Verification**: Build succeeds, no voice input

### Step 4: Implementation Plan

#### Phase 1: Safe Feature Removals (No Code Changes)
```bash
# Backup current working build
cp -r target target.backup

# Remove features from Cargo.toml
edit crates/goose/Cargo.toml  # Remove: code-mode, local-inference, aws-providers, telemetry, otel

# Test build
cargo build --release

# If build fails, check error messages and fix
# Most likely: missing imports that were feature-gated
```

#### Phase 2: Module Analysis
```bash
# Check if gateway/scheduler are cfg-gated
grep -A10 "pub mod gateway" crates/goose/src/lib.rs
grep -A10 "pub mod scheduler" crates/goose/src/lib.rs

# Find all usage of these modules
grep -r "gateway::" crates/goose/src/
grep -r "scheduler::" crates/goose/src/
```

#### Phase 3: Conditional Compilation (If Needed)
If modules aren't cfg-gated, add feature gates:
```rust
// In lib.rs
#[cfg(feature = "gateway")]
pub mod gateway;

#[cfg(feature = "scheduler")]  
pub mod scheduler;
pub mod scheduler_trait;
```

#### Phase 4: Final Testing
```bash
# Full test suite
cargo test

# Binary size check
ls -lh target/release/goose

# Functional test
./target/release/goose acp --help
```

### Step 5: Documentation Updates
After successful removal:
- Update this guide with actual issues encountered
- Update GOOSE-STRUCTURE-ANALYSIS.md with final minimal config
- Document any breaking changes for Educlaw integration

### Safe Removal Order:
1. **Phase 1**: Feature-gated removals (code-mode, local-inference, aws-providers, telemetry, otel)
2. **Phase 2**: Add cfg-gates for gateway and scheduler modules  
3. **Phase 3**: Remove gateway and scheduler from default features
4. **Test compilation after each phase**
5. **Verify core functionality remains intact**

### Risk Mitigation:
- **Always backup** before changes: `cp -r target target.backup`
- **Test incrementally** - one feature at a time
- **Have rollback plan** - can restore from git if needed
- **Monitor binary size** - track size reduction achieved
