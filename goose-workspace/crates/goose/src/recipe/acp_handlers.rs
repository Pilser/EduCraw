use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::agents::extension::ExtensionConfig;
use crate::agents::subagent_handler::{run_subagent_task, SubagentRunParams};
use crate::agents::subagent_task_config::TaskConfig;
use crate::agents::{AgentConfig, GoosePlatform};
use crate::config::permission::PermissionManager;
use crate::config::{Config, GooseMode};
use crate::conversation::message::{Message, MessageContent};
use crate::model::ModelConfig;
use crate::prompt_template;
use crate::providers;
use crate::recipe::build_recipe::{build_discovered_recipe, build_recipe_from_template, BuildDiscoveredRecipeError};
use crate::recipe::discover::{ActivityTrigger, DiscoverExecuteParams};
use crate::recipe::local_recipes;
use crate::recipe::local_recipes::load_local_recipe_file;
use crate::recipe::{ActivityItem, DiscoverActivity, Recipe, RecipeParameter, Settings};
use goose_sdk::custom_requests::DiscoverErrorDto;
use crate::recipe_deeplink;
use crate::session::session_manager::SessionType;
use crate::session::SessionManager;
use goose_sdk::custom_requests::{
    self as cr, ApplyRecipeToSessionRequest, ApplyRecipeToSessionResponse, CreateRecipeRequest,
    CreateRecipeResponse, DeleteRecipeRequest, ExportRecipeRequest, ExportRecipeResponse,
    GenerateFromSessionRequest, GenerateFromSessionResponse, ImportRecipeRequest,
    ImportRecipeResponse, ListRecipesRequest, ListRecipesResponse, ReadRecipeRequest,
    ReadRecipeResponse, RecipeEntry,
};
use rmcp::model::Role;
use tracing::info;
use sacp::Error;

fn recipe_dir(project_dir: &str) -> PathBuf {
    Path::new(project_dir).join(".agents").join("recipes")
}

fn ensure_recipe_dir(project_dir: &str) -> Result<PathBuf, Error> {
    let dir = recipe_dir(project_dir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| Error::internal_error().data(format!("Failed to create .agents/recipes/: {e}")))?;
    Ok(dir)
}

// ── Create ─────────────────────────────────────────────────────────────
// Always saves to {project_dir}/.agents/recipes/{title-slug}.yaml.
// Creates the directory if it doesn't exist.

pub fn handle_create(req: CreateRecipeRequest) -> Result<CreateRecipeResponse, Error> {
    let recipe =
        Recipe::from_content(&req.content).map_err(|e| Error::invalid_params().data(e.to_string()))?;

    let dir = ensure_recipe_dir(&req.project_dir)?;
    let filename = req.filename.unwrap_or_else(|| slugify(&recipe.title));
    let save_path = dir.join(format!("{}.yaml", filename));

    let yaml = recipe.to_yaml().map_err(|e| Error::internal_error().data(e.to_string()))?;
    std::fs::write(&save_path, &yaml)
        .map_err(|e| Error::internal_error().data(e.to_string()))?;

    Ok(CreateRecipeResponse {
        path: save_path.to_string_lossy().to_string(),
        title: recipe.title,
        description: recipe.description,
    })
}

// ── List ───────────────────────────────────────────────────────────────
// Discovers recipes from standard search paths.
// If session_manager and session_id are provided, sets applied_to_current_session
// and is_user_recipe on each entry. The session_id must be the internal session ID
// (not the ACP thread ID) — dispatch resolves it before calling this handler.

pub async fn handle_list(
    req: ListRecipesRequest,
    session_manager: Option<&SessionManager>,
    session_id: Option<&str>,
) -> Result<ListRecipesResponse, Error> {
    let all = local_recipes::list_local_recipes()
        .map_err(|e| Error::internal_error().data(e.to_string()))?;

    // Resolve applied recipe path and project dir from session once (avoid N+1)
    let applied_path: Option<String> = match (session_manager, session_id) {
        (Some(sm), Some(sid)) => {
            sm.get_session(sid, false).await
                .ok()
                .and_then(|s| s.applied_recipe_path)
        }
        _ => None,
    };
    // Use env::current_dir() because list_local_recipes() paths are
    // canonicalized from CWD, not from session.working_dir (which may be
    // an OverlayFS path). The session_id guard ensures we only compute
    // this when we have a valid session context.
    let user_recipes_dir: Option<PathBuf> = if session_id.is_some() {
        std::env::current_dir()
            .ok()
            .map(|cwd| cwd.join(".agents").join("recipes"))
            .map(|p| p.canonicalize().unwrap_or(p))
    } else {
        None
    };

    let recipes: Vec<RecipeEntry> = all
        .into_iter()
        .map(|(path, r)| {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let path_str = path.to_string_lossy().to_string();
            let is_applied = applied_path.as_deref() == Some(&path_str);
            let is_user = user_recipes_dir.as_ref().map_or(false, |d| path.parent() == Some(d.as_path()));
            RecipeEntry {
                name,
                title: r.title,
                description: r.description,
                path: path_str,
                global: false,
                parameters: r.parameters.unwrap_or_default().into_iter().map(|p| cr::RecipeParameterDto {
                    key: p.key,
                    input_type: format!("{:?}", p.input_type),
                    requirement: format!("{:?}", p.requirement),
                    description: p.description,
                    default: p.default,
                    options: p.options,
                }).collect(),
                applied_to_current_session: is_applied,
                is_user_recipe: is_user,
                activities: r.activities.map(|acts| {
                    acts.into_iter().map(|a| match a {
                        ActivityItem::Plain(s) => cr::ActivityItemDto::Plain(s),
                        ActivityItem::Discover(d) => cr::ActivityItemDto::Discover(cr::DiscoverActivityDto {
                            label: d.label,
                            icon: d.icon,
                            hint: d.hint,
                            discover: d.discover.map(|dd| cr::ActivityDiscoverDto {
                                group: dd.group,
                                params: dd.params,
                            }),
                        }),
                    }).collect()
                }),
            }
        })
        .collect();

    Ok(ListRecipesResponse { recipes })
}

// ── Read ───────────────────────────────────────────────────────────────

pub fn handle_read(req: ReadRecipeRequest) -> Result<ReadRecipeResponse, Error> {
    let path = resolve_recipe_path(&req.path, req.project_dir.as_deref())?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| Error::invalid_params().data(e.to_string()))?;
    let recipe =
        Recipe::from_content(&content).map_err(|e| Error::invalid_params().data(e.to_string()))?;
    Ok(ReadRecipeResponse {
        recipe: serde_json::to_value(&recipe)
            .map_err(|e| Error::internal_error().data(e.to_string()))?,
        content,
        path: path.to_string_lossy().to_string(),
    })
}

// ── Delete ─────────────────────────────────────────────────────────────

pub fn handle_delete(req: DeleteRecipeRequest) -> Result<(), Error> {
    let path = resolve_recipe_path(&req.path, req.project_dir.as_deref())?;

    // Scope guard: only allow deleting from {projectDir}/.agents/recipes/
    let project_dir = req.project_dir.as_deref().unwrap_or("");
    let user_recipes_dir = Path::new(project_dir).join(".agents").join("recipes");
    if !path.starts_with(&user_recipes_dir) {
        return Err(Error::invalid_params()
            .data("Recipe is not in your workspace and cannot be deleted"));
    }

    if !path.exists() {
        return Err(Error::invalid_params().data("Recipe not found"));
    }
    std::fs::remove_file(&path).map_err(|e| Error::internal_error().data(e.to_string()))?;
    Ok(())
}

// ── Export ─────────────────────────────────────────────────────────────

pub fn handle_export(req: ExportRecipeRequest) -> Result<ExportRecipeResponse, Error> {
    let path = resolve_recipe_path(&req.path, req.project_dir.as_deref())?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| Error::invalid_params().data(e.to_string()))?;
    let recipe =
        Recipe::from_content(&content).map_err(|e| Error::invalid_params().data(e.to_string()))?;

    let deeplink =
        recipe_deeplink::encode(&recipe).map_err(|e| Error::internal_error().data(e.to_string()))?;
    let recipe_json = serde_json::to_string_pretty(&recipe)
        .map_err(|e| Error::internal_error().data(e.to_string()))?;

    Ok(ExportRecipeResponse {
        deeplink: Some(format!("goose://recipe?config={}", deeplink)),
        recipe_json,
        filename: format!("{}.recipe.json", slugify(&recipe.title)),
    })
}

// ── Import ─────────────────────────────────────────────────────────────
// Always saves to {project_dir}/.agents/recipes/ via handle_create.

pub fn handle_import(req: ImportRecipeRequest) -> Result<ImportRecipeResponse, Error> {
    let content = if let Some(link) = &req.deeplink {
        let encoded = link
            .split("?config=")
            .nth(1)
            .ok_or_else(|| Error::invalid_params().data("Invalid deeplink: missing ?config="))?;
        let recipe = recipe_deeplink::decode(encoded)
            .map_err(|_| Error::invalid_params().data("Failed to decode recipe deeplink"))?;
        recipe
            .to_yaml()
            .map_err(|e| Error::internal_error().data(e.to_string()))?
    } else if let Some(json) = &req.recipe_json {
        json.clone()
    } else {
        return Err(Error::invalid_params().data("Either deeplink or recipe_json is required"));
    };

    let create_req = CreateRecipeRequest {
        content,
        filename: req.filename.clone(),
        project_dir: req.project_dir.clone(),
    };
    let created = handle_create(create_req)?;

    Ok(ImportRecipeResponse {
        path: created.path,
        title: created.title,
        description: created.description,
    })
}

// ── Apply To Session ──────────────────────────────────────────────────

pub async fn handle_apply_to_session(
    req: ApplyRecipeToSessionRequest,
    session_manager: &SessionManager,
) -> Result<ApplyRecipeToSessionResponse, Error> {
    let path = resolve_recipe_path(&req.recipe_path, req.project_dir.as_deref())?;
    let recipe_file = load_local_recipe_file(&path.to_string_lossy())
        .map_err(|e| Error::invalid_params().data(e.to_string()))?;

    let param_values: Vec<(String, String)> = req
        .parameter_values
        .clone()
        .unwrap_or_default()
        .into_iter()
        .collect();

    let recipe = if let Some(trigger) = &req.activity_trigger {
        let working_dir = std::env::current_dir().unwrap_or_default();
        let discover_params = DiscoverExecuteParams {
            working_dir,
            activity_trigger: Some(ActivityTrigger {
                group: trigger.group.clone(),
                params: trigger.params.clone(),
            }),
        };
        match build_discovered_recipe(
            recipe_file.content.clone(),
            &recipe_file.parent_dir,
            param_values.clone(),
            Some(discover_params),
        )
        .await
        {
            Ok(r) => r,
            Err(BuildDiscoveredRecipeError::DiscoverFailed(errors)) => {
                return Ok(ApplyRecipeToSessionResponse {
                    title: String::new(),
                    description: String::new(),
                    instructions: None,
                    prompt: None,
                    resolved_extensions: vec![],
                    parameters: vec![],
                    recipe_path: None,
                    activities: None,
                    applied_activity_group: None,
                    discover_errors: Some(
                        errors
                            .into_iter()
                            .map(|e| DiscoverErrorDto {
                                code: e.code,
                                step: e.step,
                                step_type: e.step_type,
                                path: e.path,
                                message: e.message,
                            })
                            .collect(),
                    ),
                });
            }
            Err(e) => {
                return Err(Error::invalid_params().data(format!(
                    "Failed to build discovered recipe: {}",
                    e
                )))
            }
        }
    } else {
        build_recipe_from_template(
            recipe_file.content,
            &recipe_file.parent_dir,
            param_values.clone(),
            None::<fn(&str, &str) -> Result<String, anyhow::Error>>,
        )
        .map_err(|e| Error::invalid_params().data(e.to_string()))?
    };

    let resolved_path = path.to_string_lossy().to_string();
    let user_values: HashMap<String, String> = param_values.into_iter().collect();

    session_manager
        .update(&req.session_id)
        .recipe(Some(recipe.clone()))
        .applied_recipe_path(Some(resolved_path.clone()))
        .user_recipe_values(Some(user_values))
        .recipe_activity_context(req.activity_trigger.as_ref().map(|t| t.group.clone()))
        .apply()
        .await
        .map_err(|e| Error::internal_error().data(e.to_string()))?;

    info!(
        session_id = %req.session_id,
        recipe_title = %recipe.title,
        recipe_description = %recipe.description,
        instructions_len = recipe.instructions.as_ref().map_or(0, |s| s.len()),
        has_prompt = recipe.prompt.is_some(),
        "Recipe applied to session"
    );

    // Inject a signal into the conversation so the agent knows a recipe was applied.
    // Agent-only visibility: full instructions live in the system prompt via session.recipe.
    let apply_record = Message::assistant()
        .with_text(format!("Recipe applied: {}", recipe.title))
        .agent_only();
    let _ = session_manager.add_message(&req.session_id, &apply_record).await;

    let resolved_extensions: Vec<String> = recipe
        .extensions
        .as_ref()
        .map(|exts| exts.iter().map(|e| e.name()).collect())
        .unwrap_or_default();

    let parameters: Vec<cr::RecipeParameterDto> = recipe
        .parameters
        .unwrap_or_default()
        .into_iter()
        .map(|p| cr::RecipeParameterDto {
            key: p.key,
            input_type: format!("{:?}", p.input_type),
            requirement: format!("{:?}", p.requirement),
            description: p.description,
            default: p.default,
            options: p.options,
        })
        .collect();

    let activities: Option<Vec<cr::ActivityItemDto>> = recipe.activities.map(|acts| {
        acts.into_iter()
            .map(|a| match a {
                ActivityItem::Plain(s) => cr::ActivityItemDto::Plain(s),
                ActivityItem::Discover(d) => cr::ActivityItemDto::Discover(cr::DiscoverActivityDto {
                    label: d.label,
                    icon: d.icon,
                    hint: d.hint,
                    discover: d.discover.map(|dd| cr::ActivityDiscoverDto {
                        group: dd.group,
                        params: dd.params,
                    }),
                }),
            })
            .collect()
    });

    Ok(ApplyRecipeToSessionResponse {
        title: recipe.title,
        description: recipe.description,
        instructions: recipe.instructions,
        prompt: recipe.prompt,
        resolved_extensions,
        parameters,
        recipe_path: Some(resolved_path),
        discover_errors: None,
        activities,
        applied_activity_group: req.activity_trigger.as_ref().map(|t| t.group.clone()),
    })
}

// ── Generate From Session ──────────────────────────────────────────────
// Spawns a sub-agent that analyzes the session's conversation and produces
// a new recipe. The sub-agent receives the conversation transcript + recipe.md
// prompt and returns JSON. The handler parses the JSON, builds a Recipe, and
// saves it via handle_create().

pub async fn handle_generate_from_session(
    req: GenerateFromSessionRequest,
    session_manager: Arc<SessionManager>,
    permission_manager: Arc<PermissionManager>,
    goose_mode: GooseMode,
    goose_platform: GoosePlatform,
) -> Result<GenerateFromSessionResponse, Error> {
    let source_session = session_manager
        .get_session(&req.session_id, true)
        .await
        .map_err(|e| Error::internal_error().data(format!("Failed to get session: {e}")))?;

    let working_dir = source_session.working_dir.clone();
    let conversation = source_session
        .conversation
        .as_ref()
        .ok_or_else(|| Error::invalid_params().data("Session has no conversation"))?;

    // Format conversation as a text transcript
    let mut transcript = String::new();
    for msg in conversation.messages() {
        let role = match msg.role {
            Role::User => "User",
            Role::Assistant => "Assistant",
            _ => "System",
        };
        let text_parts: Vec<&str> = msg
            .content
            .iter()
            .filter_map(|c| match c {
                MessageContent::Text(t) => Some(t.text.as_str()),
                _ => None,
            })
            .collect();
        if !text_parts.is_empty() {
            transcript.push_str(&format!("## {role}\n\n{}\n\n", text_parts.join("\n")));
        }
    }

    // Render recipe.md as the sub-agent's system instructions
    let context: HashMap<&str, serde_json::Value> = HashMap::new();
    let recipe_prompt = prompt_template::render_template("recipe.md", &context)
        .map_err(|e| Error::internal_error().data(format!("Failed to render recipe prompt: {e}")))?;

    // Build task prompt with conversation + optional user instructions
    let extra = req
        .instructions
        .as_deref()
        .map(|i| format!("\n\nAdditional instructions: {i}"))
        .unwrap_or_default();
    let task_prompt = format!(
        "Generate a recipe based on the following conversation.\n\
         The recipe should capture the patterns and knowledge demonstrated.\n\
         Respond with a JSON object containing exactly these fields:\n\
         title, description, instructions, and activities.\n\n\
         ## Conversation Transcript\n\n{transcript}{extra}"
    );

    // Build sub-agent Recipe
    let sub_recipe = Recipe::builder()
        .version("1.0.0")
        .title("Recipe Generation")
        .description("Generate a recipe from session context")
        .instructions(&recipe_prompt)
        .prompt(&task_prompt)
        .settings(Settings {
            goose_provider: None,
            goose_model: None,
            temperature: None,
            max_turns: Some(10),
        })
        .build()
        .map_err(|e| Error::internal_error().data(format!("Failed to build sub-agent recipe: {e}")))?;

    // Create sub-agent session
    let subagent_session = session_manager
        .create_session(
            working_dir.clone(),
            "Recipe Generation".to_string(),
            SessionType::SubAgent,
            goose_mode,
        )
        .await
        .map_err(|e| Error::internal_error().data(format!("Failed to create sub-agent session: {e}")))?;

    // Resolve provider from source session or config
    let provider_name = source_session
        .provider_name
        .clone()
        .or_else(|| Config::global().get_goose_provider().ok())
        .unwrap_or_else(|| "openai".to_string());

    let model_config = source_session
        .model_config
        .clone()
        .unwrap_or_else(|| ModelConfig::new("default").unwrap_or_default());

    let provider = providers::create(&provider_name, model_config, Vec::new())
        .await
        .map_err(|e| Error::internal_error().data(format!("Failed to create provider: {e}")))?;

    // Build AgentConfig
    let agent_config = AgentConfig::new(
        session_manager.clone(),
        permission_manager.clone(),
        goose_mode,
        true,
        goose_platform,
    );

    // TaskConfig with developer + analyze extensions for code-aware recipe generation
    let extensions = vec![
        ExtensionConfig::Platform {
            name: "developer".to_string(),
            description: "Write and edit files, and execute shell commands".to_string(),
            display_name: None,
            bundled: None,
            available_tools: vec![],
        },
        ExtensionConfig::Platform {
            name: "analyze".to_string(),
            description: "Analyze code structure with tree-sitter".to_string(),
            display_name: None,
            bundled: None,
            available_tools: vec![],
        },
    ];

    let task_config =
        TaskConfig::new(provider, &subagent_session.id, &working_dir, extensions).with_max_turns(Some(10));

    // Spawn sub-agent
    let result = run_subagent_task(SubagentRunParams {
        config: agent_config,
        recipe: sub_recipe,
        task_config,
        return_last_only: true,
        session_id: subagent_session.id.clone(),
        cancellation_token: None,
        on_message: None,
        notification_tx: None,
    })
    .await
    .map_err(|e| Error::internal_error().data(format!("Sub-agent failed: {e}")))?;

    // Parse JSON from sub-agent output (strip markdown code fences if present)
    let clean = result
        .trim()
        .strip_prefix("```json")
        .or_else(|| result.trim().strip_prefix("```"))
        .and_then(|s| s.strip_suffix("```"))
        .map(|s| s.trim())
        .unwrap_or(result.trim());

    let json_value: serde_json::Value = serde_json::from_str(clean).map_err(|e| {
        Error::internal_error().data(format!(
            "Failed to parse sub-agent output as JSON: {e}\n\nRaw output:\n{result}"
        ))
    })?;

    let title = json_value
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| Error::invalid_params().data("Missing 'title' in generated recipe"))?
        .to_string();

    let description = json_value
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or(&title)
        .to_string();

    let instructions = json_value
        .get("instructions")
        .and_then(|v| v.as_str())
        .ok_or_else(|| Error::invalid_params().data("Missing 'instructions' in generated recipe"))?;

    let activities: Vec<ActivityItem> = json_value
        .get("activities")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    v.as_str()
                        .map(|s| ActivityItem::Plain(s.to_string()))
                        .or_else(|| {
                            serde_json::from_value::<DiscoverActivity>(v.clone())
                                .ok()
                                .map(ActivityItem::Discover)
                        })
                })
                .collect::<Vec<ActivityItem>>()
        })
        .unwrap_or_default();

    // Build and save recipe via handle_create
    let recipe = Recipe::builder()
        .title(&title)
        .description(&description)
        .instructions(instructions)
        .activities(activities)
        .settings(Settings {
            goose_provider: Some(provider_name),
            goose_model: source_session.model_config.as_ref().map(|m| m.model_name.clone()),
            temperature: None,
            max_turns: None,
        })
        .build()
        .map_err(|e| Error::internal_error().data(format!("Failed to build recipe: {e}")))?;

    let yaml = recipe
        .to_yaml()
        .map_err(|e| Error::internal_error().data(format!("Failed to serialize recipe: {e}")))?;

    let create_req = CreateRecipeRequest {
        content: yaml,
        filename: None,
        project_dir: req.project_dir,
    };

    let created = handle_create(create_req)?;
    Ok(GenerateFromSessionResponse {
        path: created.path,
        title: created.title,
        description: created.description,
    })
}

// ── Helpers ────────────────────────────────────────────────────────────

fn resolve_recipe_path(path_or_name: &str, project_dir: Option<&str>) -> Result<PathBuf, Error> {
    let candidate = Path::new(path_or_name);
    if candidate.exists() {
        return Ok(candidate.to_path_buf());
    }

    let mut search_dirs: Vec<PathBuf> = Vec::new();
    if let Some(project) = project_dir {
        search_dirs.push(Path::new(project).join(".agents").join("recipes"));
    }

    for dir in &search_dirs {
        for ext in ["yaml", "json"] {
            let p = dir.join(format!("{}.{}", path_or_name, ext));
            if p.exists() {
                return Ok(p);
            }
        }
    }

    Err(Error::invalid_params().data(format!(
        "Recipe '{}' not found in any recipe directory",
        path_or_name
    )))
}

fn slugify(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '-')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join("-")
}
