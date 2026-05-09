# Goose `GOOSE_PATH_ROOT` - Complete Analysis

## Overview

This document analyzes how Goose uses the `GOOSE_PATH_ROOT` environment variable and whether all configurations, system prompts, skills, and other files can be loaded from a custom path instead of using Goose's internal defaults.

---

## How `GOOSE_PATH_ROOT` Works

**File:** `goose-workspace/crates/goose/src/config/paths.rs:1-63`

```rust
impl Paths {
    fn get_dir(dir_type: DirType) -> PathBuf {
        if let Ok(test_root) = std::env::var("GOOSE_PATH_ROOT") {
            let base = PathBuf::from(test_root);
            match dir_type {
                DirType::Config => base.join("config"),
                DirType::Data => base.join("data"),
                DirType::State => base.join("state"),
            }
        } else {
            // Uses platform-specific paths (e.g., ~/.config/goose/, ~/.local/share/goose/)
            let strategy = choose_app_strategy(AppStrategyArgs {
                top_level_domain: "Block".to_string(),
                author: "Block".to_string(),
                app_name: "goose".to_string(),
            })?;
            // ...
        }
    }
}
```

### What `GOOSE_PATH_ROOT` Affects

When `GOOSE_PATH_ROOT=/overlay/home/student1`, Goose uses:

| Original Path | Overridden Path |
|---------------|-----------------|
| `~/.config/goose/` | `/overlay/home/student1/config/` |
| `~/.local/share/goose/` | `/overlay/home/student1/data/` |
| `~/.local/state/goose/` | `/overlay/home/student1/state/` |

---

## What Can Be Overridden via `GOOSE_PATH_ROOT`

### 1. ✅ Configuration Files

**Files:** `goose-workspace/crates/goose/src/config/base.rs:164-204`

| File | Path with `GOOSE_PATH_ROOT` | Loading Code |
|------|----------------------------|----------------|
| `config.yaml` | `$GOOSE_PATH_ROOT/config/config.yaml` | `Paths::config_dir().join(CONFIG_YAML_NAME)` |
| `secrets.yaml` | `$GOOSE_PATH_ROOT/config/secrets.yaml` | `config_dir.join("secrets.yaml")` |

**Verification:**
```rust
// base.rs:167
let user_config_path = config_dir.join(CONFIG_YAML_NAME);  // → resolved via Paths
```

---

### 2. ✅ System Prompts (Partial Override)

**File:** `goose-workspace/crates/goose/src/prompt_template.rs:1-242`

#### How Prompts Are Loaded:

```rust
// Lines 7, 102-108
static CORE_PROMPTS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/src/prompts");  // Embedded in binary!

fn user_prompts_dir() -> PathBuf {
    Paths::config_dir().join("prompts")  // → $GOOSE_PATH_ROOT/config/prompts/
}

pub fn render_template<T: Serialize>(name: &str, context: &T) -> Result<String, MiniJinjaError> {
    let user_path = user_prompts_dir().join(name);  // Check user path first
    let template_str = if user_path.exists() {
        std::fs::read_to_string(&user_path).map_err(|e| { /* ... */ })?
    } else {
        // Fall back to embedded version
        let file = CORE_PROMPTS_DIR.get_file(name).ok_or_else(|| { /* ... */ })?;
        String::from_utf8_lossy(file.contents()).to_string()
    };
    // ...
}
```

#### Available Prompt Files (Embedded in Binary):

Located at: `goose-workspace/crates/goose/src/prompts/`

| File | Description | Can Override via `GOOSE_PATH_ROOT`? |
|------|-------------|----------------------------|
| `system.md` | Main system prompt | ✅ Yes - place at `$GOOSE_PATH_ROOT/config/prompts/system.md` |
| `compaction.md` | Prompt for summarizing conversation | ✅ Yes |
| `subagent_system.md` | System prompt for subagents | ✅ Yes |
| `recipe.md` | Prompt for generating recipes | ✅ Yes |
| `apps_create.md` | Prompt for creating apps | ✅ Yes |
| `apps_iterate.md` | Prompt for updating apps | ✅ Yes |
| `permission_judge.md` | Prompt for analyzing tool operations | ✅ Yes |
| `plan.md` | Prompt for creating step-by-step plans | ✅ Yes |
| `tiny_model_system.md` | System prompt for tiny models | ✅ Yes |
| `session_name.md` | Prompt for generating session names | ✅ Yes |

**Important:** The embedded versions are used ONLY if the file does NOT exist in `user_prompts_dir()`. So you CAN override ALL prompts via `GOOSE_PATH_ROOT`.

---

### 3. ✅ Custom Providers

**File:** `goose-workspace/crates/goose/src/config/declarative_providers.rs:27-31`

```rust
static FIXED_PROVIDERS: Dir = include_dir!("$CARGO_MANIFEST_DIR/src/providers/declarative");  // Embedded defaults

pub fn custom_providers_dir() -> std::path::PathBuf {
    Paths::config_dir().join("custom_providers")  // → $GOOSE_PATH_ROOT/config/custom_providers/
}
```

| Type | Path | Can Override? |
|------|------|---------------|
| Fixed (built-in) providers | Embedded in binary | ❌ NO (but you can add custom ones) |
| Custom providers | `$GOOSE_PATH_ROOT/config/custom_providers/` | ✅ YES |

---

### 4. ✅ Skills (Partial Override)

**File:** `goose-workspace/crates/goose/src/skills/mod.rs:1-386`

#### Built-in Skills (Embedded in Binary):

**File:** `goose-workspace/crates/goose/src/skills/builtin.rs:1-11`

```rust
static BUILTIN_SKILLS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/src/skills/builtins");

pub fn get_all() -> Vec<&'static str> {
    BUILTIN_SKILLS_DIR
        .files()
        .filter(|f| f.path().extension().is_some_and(|ext| ext == "md"))
        .filter_map(|f| f.contents_utf8())
        .collect()
}
```

❌ **CANNOT be overridden via `GOOSE_PATH_ROOT`** - loaded directly from embedded binary!

#### Loadable Skills (File System):

**File:** `goose-workspace/crates/goose/src/skills/mod.rs:28-50`

```rust
pub fn global_skills_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".agents").join("skills"))  // NOT affected by GOOSE_PATH_ROOT
}

pub fn project_skills_dir(project_dir: &Path) -> PathBuf {
    project_dir.join(".agents").join("skills")  // NOT affected by GOOSE_PATH_ROOT
}

// But also checks config dir!
fn inferred_discoverable_skill_root(path: &Path) -> Option<PathBuf> {
    let mut global_roots = Vec::new();
    if let Some(global_root) = global_skills_dir() {
        global_roots.push(global_root);
    }
    global_roots.push(Paths::config_dir().join("skills"));  // ✅ YES - $GOOSE_PATH_ROOT/config/skills/
    // ...
}
```

| Skill Type | Path | Can Override via `GOOSE_PATH_ROOT`? |
|------------|------|----------------------------|
| Built-in skills | Embedded in binary | ❌ NO |
| Global skills | `~/.agents/skills/` | ❌ NO |
| Project skills | `<project>/.agents/skills/` | ❌ NO |
| Config skills | `$GOOSE_PATH_ROOT/config/skills/` | ✅ YES |

---

### 5. ✅ Session Data

**Files:** `goose-workspace/crates/goose/src/session/session_manager.rs`

```rust
// Sessions DB and conversation data stored in:
Paths::data_dir()  // → $GOOSE_PATH_ROOT/data/
```

✅ **Fully overridden via `GOOSE_PATH_ROOT`**

---

## What CANNOT Be Overridden via `GOOSE_PATH_ROOT`

### ❌ Built-in Skills (Embedded in Binary)

**File:** `goose-workspace/crates/goose/src/skills/builtin.rs`

```rust
static BUILTIN_SKILLS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/src/skills/builtins");

pub fn get_all() -> Vec<&'static str> {
    // Reads directly from embedded directory - no file system access!
    BUILTIN_SKILLS_DIR.files()...
}
```

**Workaround:** You would need to modify the Goose source code to load from a file path instead of using `include_dir!`.

---

### ❌ Core Prompt Defaults (Embedded in Binary)

While you CAN override them by placing files in `$GOOSE_PATH_ROOT/config/prompts/`, the DEFAULT versions are embedded in the binary via:

```rust
static CORE_PROMPTS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/src/prompts");
```

To completely replace the embedded defaults (so they're never used), you would need to modify `prompt_template.rs`.

---

### ❌ Declarative Provider Defaults (Embedded in Binary)

**File:** `goose-workspace/crates/goose/src/config/declarative_providers.rs:27`

```rust
static FIXED_PROVIDERS: Dir = include_dir!("$CARGO_MANIFEST_DIR/src/providers/declarative");
```

These are embedded and used as defaults. You can add custom providers in `$GOOSE_PATH_ROOT/config/custom_providers/`, but the built-in ones remain embedded.

---

### ❌ Signup Templates (Embedded in Binary)

**Files:**
- `goose-workspace/crates/goose/src/config/signup_openrouter/server.rs:16`
- `goose-workspace/crates/goose/src/config/signup_tetrate/server.rs:14`

```rust
static TEMPLATES_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/src/config/signup_openrouter/templates");
```

---

## EduCraw's Usage of `GOOSE_PATH_ROOT`

**File:** `educlaw-server/src/acp_bridge/session.rs:42-74`

```rust
pub async fn run_acp_session(
    // ...
    goose_path_root: PathBuf,  // e.g., /overlay/home/student1
    // ...
) {
    // Initialize isolated namespace
    tokio::fs::create_dir_all(&goose_path_root).await.ok();

    // Write per-session system-prompt override
    if let Some(ref prompt) = system_prompt {
        let goose_config_dir = goose_path_root.join("config");
        let prompt_dir = goose_config_dir.join("prompts");
        tokio::fs::create_dir_all(&prompt_dir).await.ok();
        tokio::fs::write(prompt_dir.join("system.md"), prompt).await.ok();
    }

    // Spawn goose acp subprocess
    let mut cmd = tokio::process::Command::new(&goose_bin);
    cmd.arg("acp");
    cmd.env_clear();
    cmd.env("GOOSE_PATH_ROOT", goose_path_root.display().to_string());
    // ...
}
```

### What EduCraw CAN Configure via `GOOSE_PATH_ROOT`:

✅ **System prompts** - writes to `$GOOSE_PATH_ROOT/config/prompts/system.md`
✅ **config.yaml** - place at `$GOOSE_PATH_ROOT/config/config.yaml`
✅ **secrets.yaml** - place at `$GOOSE_PATH_ROOT/config/secrets.yaml`
✅ **Custom skills** - place at `$GOOSE_PATH_ROOT/config/skills/`
✅ **Custom providers** - place at `$GOOSE_PATH_ROOT/config/custom_providers/`
✅ **Session data** - stored in `$GOOSE_PATH_ROOT/data/`

### What EduCraw CANNOT Configure via `GOOSE_PATH_ROOT`:

❌ **Built-in skills** - embedded in Goose binary at compile time
❌ **Default prompts** - embedded in Goose binary (but can be overridden with files)
❌ **Fixed providers** - embedded in Goose binary

---

## Summary Table

| Component | Default Location | Override Path with `GOOSE_PATH_ROOT` | Can Override? |
|-----------|------------------|---------------------------------------------|---------------|
| **config.yaml** | `~/.config/goose/config.yaml` | `$GOOSE_PATH_ROOT/config/config.yaml` | ✅ YES |
| **secrets.yaml** | `~/.config/goose/secrets.yaml` | `$GOOSE_PATH_ROOT/config/secrets.yaml` | ✅ YES |
| **System prompts** | Embedded in binary | `$GOOSE_PATH_ROOT/config/prompts/` | ✅ YES (override files) |
| **Custom skills** | N/A | `$GOOSE_PATH_ROOT/config/skills/` | ✅ YES |
| **Built-in skills** | Embedded in binary | N/A | ❌ NO |
| **Custom providers** | N/A | `$GOOSE_PATH_ROOT/config/custom_providers/` | ✅ YES |
| **Fixed providers** | Embedded in binary | N/A | ❌ NO (add custom instead) |
| **Session data** | `~/.local/share/goose/` | `$GOOSE_PATH_ROOT/data/` | ✅ YES |
| **State data** | `~/.local/state/goose/` | `$GOOSE_PATH_ROOT/state/` | ✅ YES |

---

## Conclusion

**Can all configs, system prompts, and skills be loaded via `GOOSE_PATH_ROOT` without Goose using internal configs?**

- ✅ **Config files (config.yaml, secrets.yaml)**: YES
- ✅ **System prompts**: YES - if you place override files in `$GOOSE_PATH_ROOT/config/prompts/`
- ⚠️ **Skills**: PARTIAL
  - Custom skills: YES via `$GOOSE_PATH_ROOT/config/skills/`
  - Built-in skills: ❌ NO - embedded in binary via `include_dir!` macro
- ✅ **Session/state data**: YES

**To completely replace built-in skills**, you would need to:
1. Modify `goose-workspace/crates/goose/src/skills/builtin.rs` to load from a file path instead of `include_dir!`
2. Recompile Goose
3. Place your skill files in the specified path

**Or alternatively**, use the `load_skill` tool to load skills from the filesystem at runtime (from `$GOOSE_PATH_ROOT/config/skills/` or project directories).
