# Goose System Prompts — Override Guide

## Built-in Prompt Templates

Source: `crates/goose/src/prompts/`. Compiled into the binary at build time via `include_dir!`.

| File | Purpose |
|---|---|
| `system.md` | Main personality & behavior (Jinja2 template) |
| `subagent_system.md` | Subagents spawned for specific tasks |
| `tiny_model_system.md` | Small local models (flat shell-style, no Jinja2) |
| `compaction.md` | Summarize conversation history at context limit |
| `recipe.md` | Generate recipe files from conversations |
| `plan.md` | Step-by-step planning |
| `permission_judge.md` | Read-only operation detection |
| `session_name.md` | Generate short session names |
| `apps_create.md` | Generate new Goose apps |
| `apps_iterate.md` | Iterate on existing Goose apps |

---

## How Paths Are Resolved

All Goose paths go through `Paths::get_dir()` in `paths.rs:7-32`. Resolution order:

1. **`$GOOSE_PATH_ROOT`** env var — if set, everything goes under it:
   ```
   $GOOSE_PATH_ROOT/
   ├── config/      ← prompts, skills, hints, recipes, permissions, config.yaml, secrets.yaml
   ├── data/        ← sessions, schedule, models
   └── state/       ← logs, history, instance_id
   ```

2. **Default** (no env var) — uses `etcetera` crate → XDG on Linux:
   - `$XDG_CONFIG_HOME/goose/` or `$HOME/.config/goose/`
   - `$XDG_DATA_HOME/goose/` or `$HOME/.local/share/goose/`
   - `$XDG_STATE_HOME/goose/` or `$HOME/.local/state/goose/`

### What Lives Under `config/`

| Feature | Relative Path | Code |
|---|---|---|
| **System prompts** | `config/prompts/` | `prompt_template.rs:64` |
| **Global hints** (`.goosehints`, `AGENTS.md`) | `config/` | `load_hints.rs:234` |
| **Skills** | `config/skills/` | `skills/mod.rs:102,208` |
| **Recipes** | `config/recipes/` | `local_recipes.rs:15` |
| **Permissions** | `config/permissions/` + `config/permission.yaml` | `permission_store.rs:41`, `permission.rs:14` |
| **Custom providers** | `config/custom_providers/` | `declarative_providers.rs:30` |
| **Adversary.md** | `config/adversary.md` | `adversary_inspector.rs:80` |
| **MCP apps cache** | `config/mcp-apps-cache/` | `goose_apps/cache.rs:20` |
| **config.yaml** | `config/config.yaml` | `base.rs:167` |
| **secrets.yaml** | `config/secrets.yaml` | `base.rs:190` |
| **Provider tokens** (OAuth, Copilot, Gemini, etc.) | `config/<provider>/` | various providers |

### What Stays Project-Local (Not Under `config/`)

These are intentionally tied to the working directory, not global config:
- `.goosehints` / `AGENTS.md` in the project directory (project-local hints)
- `.agents/skills/` in the project directory
- `.goose/recipes/` in the project directory
- Subdirectory hints (auto-discovered as goose navigates)

---

## Override Method 1: Copy to `config/prompts/`

Copy the `.md` file to `<config-dir>/prompts/<same-filename>.md`. Goose checks this path first at render time (`prompt_template.rs:93-109`).

```bash
# If using GOOSE_PATH_ROOT:
export GOOSE_PATH_ROOT=/your/custom/path
mkdir -p $GOOSE_PATH_ROOT/config/prompts
cp crates/goose/src/prompts/system.md $GOOSE_PATH_ROOT/config/prompts/system.md

# If using default paths:
mkdir -p ~/.config/goose/prompts
cp crates/goose/src/prompts/system.md ~/.config/goose/prompts/system.md
```

To revert, remove the file and the built-in version is used again.

### Template Variables Available in `system.md`

Rendered with `minijinja` (Jinja2-like syntax). Context from `SystemPromptContext` in `prompt_manager.rs:36-47`:

| Variable | Type | Description |
|---|---|---|
| `{{ extensions }}` | `Vec<ExtensionInfo>` | Active extensions (name, instructions, has_resources) |
| `{{ current_date_time }}` | `String` | Timestamp (rounded to hour for prompt cache) |
| `{{ extension_tool_limits }}` | `Option<(usize, usize)>` | Warning when >5 extensions or >50 tools |
| `{{ goose_mode }}` | `GooseMode` | `Auto`, `Chat`, etc. |
| `{{ is_autonomous }}` | `bool` | Whether in autonomous mode |
| `{{ enable_subagents }}` | `bool` | Whether subagents are enabled |
| `{{ max_extensions }}` | `usize` | Always `5` |
| `{{ max_tools }}` | `usize` | Always `50` |
| `{{ code_execution_mode }}` | `bool` | Whether in code execution mode |

### Notes

- If Jinja2 rendering fails, it falls back to: `"You are a general-purpose AI agent called goose, created by Block"`
- Unicode tags in range `U+E0000–U+E007F` are auto-sanitized
- `{{ current_date_time }}` position affects prompt caching — keep it early for better cache hit rates
- `tiny_model_system.md` does NOT use Jinja2 — it's a flat prompt for shell-style interaction

---

## Override Method 2: `GOOSE_SYSTEM_PROMPT_FILE_PATH` env var

Fully replaces the system prompt with content from a file. Set in environment or in `config/config.yaml`:

```bash
export GOOSE_SYSTEM_PROMPT_FILE_PATH=/path/to/my/prompt.txt
```

Or in config:
```yaml
GOOSE_SYSTEM_PROMPT_FILE_PATH: /path/to/my/prompt.txt
```

Resolution order (`config/base.rs:674-700`):
1. Environment variable (uppercase key name)
2. Merged config files (system → user)

---

## Override Method 3: `--system` CLI flag

Appends inline text as additional system prompt:

```bash
goose run --system "Always answer in Spanish" "my task"
```

---

## Override Method 4: `.goosehints` / `AGENTS.md` (Project Hints)

**Auto-discovered from the project directory** and appended under `# Additional Instructions`.

Discovery algorithm (`load_hints.rs:225-291`):

1. **Global hints**: `<config-dir>/.goosehints` (labeled "Global Hints")
2. **Local hints**: walks from CWD up to the git root (or just CWD if no `.git`), reading hints files at each level (labeled "Project Hints")

The filenames are configurable via `CONTEXT_FILE_NAMES` in config. Defaults:
- `.goosehints`
- `AGENTS.md`

Hints files can reference other files using `@filename.md` syntax (up to 3 levels deep, git-root-bound, respects `.gitignore`):

```
# .goosehints
This project uses PostgreSQL.
@docs/architecture.md
@CONTRIBUTING.md
```

---

## Subdirectory Hints

When goose navigates into subdirectories (via tool calls), it tracks which directories were visited. If a subdirectory has a `.goosehints` or `AGENTS.md`, its content is loaded and appended as additional instructions, labeled "Subdirectory Hints".

Implemented in `SubdirectoryHintTracker` (`load_hints.rs:26-96`).

---

## Skills

Loaded from `<config-dir>/skills/` via `Paths::config_dir().join("skills")` (`skills/mod.rs:102,208`) and from project-local directories (`.agents/skills/`, `.goose/skills/`, `.claude/skills/` under CWD).

---

## Programmatic API (for extension developers)

In Rust:

```rust
// Full override
prompt_manager.set_system_prompt_override(template_string);

// Append extra instructions under "# Additional Instructions"
prompt_manager.add_system_prompt_extra("my_key", "instruction text");

// Build the final prompt
let prompt = prompt_manager.builder()
    .with_extension(extension_info)
    .with_hints(working_dir)
    .with_goose_mode(GooseMode::Auto)
    .build();
```
