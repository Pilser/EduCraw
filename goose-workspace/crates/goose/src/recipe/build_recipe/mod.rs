use crate::recipe::discover::{execute_discovery, DiscoverError, DiscoverExecuteParams};
use crate::recipe::read_recipe_file_content::read_parameter_file_content;
use crate::recipe::template_recipe::render_recipe_content_with_params;
use crate::recipe::validate_recipe::validate_recipe_template_for_discovery;
use crate::recipe::validate_recipe::validate_recipe_template_from_content;
use crate::recipe::{
    Recipe, RecipeParameter, RecipeParameterInputType, RecipeParameterRequirement,
    BUILT_IN_RECIPE_DIR_PARAM,
};
use anyhow::Result;
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum RecipeError {
    #[error("Missing required parameters: {parameters:?}")]
    MissingParams { parameters: Vec<String> },
    #[error("Invalid recipe: {source}")]
    Invalid { source: anyhow::Error },
}

fn render_recipe_template<F>(
    recipe_content: String,
    recipe_dir: &Path,
    params: Vec<(String, String)>,
    user_prompt_fn: Option<F>,
) -> Result<(String, Vec<String>)>
where
    F: Fn(&str, &str) -> Result<String, anyhow::Error>,
{
    let recipe_dir_str = recipe_dir.display().to_string();

    let recipe_parameters =
        validate_recipe_template_from_content(&recipe_content, Some(recipe_dir_str.clone()))?
            .parameters;

    let (params_for_template, missing_params) =
        apply_values_to_parameters(&params, recipe_parameters, &recipe_dir_str, user_prompt_fn)?;

    let params_for_template_value: HashMap<String, serde_json::Value> = params_for_template
        .into_iter()
        .map(|(k, v)| (k, serde_json::Value::String(v)))
        .collect();
    let rendered_content = if missing_params.is_empty() {
        render_recipe_content_with_params(&recipe_content, &params_for_template_value)?
    } else {
        String::new()
    };

    Ok((rendered_content, missing_params))
}

pub fn build_recipe_from_template<F>(
    recipe_content: String,
    recipe_dir: &Path,
    params: Vec<(String, String)>,
    user_prompt_fn: Option<F>,
) -> Result<Recipe, RecipeError>
where
    F: Fn(&str, &str) -> Result<String, anyhow::Error>,
{
    let (rendered_content, missing_params) =
        render_recipe_template(recipe_content, recipe_dir, params.clone(), user_prompt_fn)
            .map_err(|source| RecipeError::Invalid { source })?;

    if !missing_params.is_empty() {
        return Err(RecipeError::MissingParams {
            parameters: missing_params,
        });
    }

    let mut recipe = Recipe::from_content(&rendered_content)
        .map_err(|source| RecipeError::Invalid { source })?;

    if let Some(ref mut sub_recipes) = recipe.sub_recipes {
        for sub_recipe in sub_recipes {
            sub_recipe.path = resolve_sub_recipe_path(&sub_recipe.path, recipe_dir)?;
        }
    }

    Ok(recipe)
}

pub fn build_recipe_from_template_with_positional_params<F>(
    recipe_content: String,
    recipe_dir: &Path,
    params: Vec<String>,
    user_prompt_fn: Option<F>,
) -> Result<Recipe, RecipeError>
where
    F: Fn(&str, &str) -> Result<String, anyhow::Error>,
{
    let recipe_dir_str = recipe_dir.display().to_string();

    let recipe_parameters =
        validate_recipe_template_from_content(&recipe_content, Some(recipe_dir_str.clone()))
            .map_err(|source| RecipeError::Invalid { source })?
            .parameters;

    let param_pairs: Vec<(String, String)> = if let Some(recipe_params) = &recipe_parameters {
        let required_count = recipe_params.iter().filter(|p| p.default.is_none()).count();
        if params.len() < required_count {
            let required_keys: Vec<String> = recipe_params
                .iter()
                .filter(|p| p.default.is_none())
                .map(|p| p.key.clone())
                .collect();
            return Err(RecipeError::MissingParams {
                parameters: required_keys,
            });
        }
        recipe_params
            .iter()
            .zip(params.iter())
            .map(|(rp, p)| (rp.key.clone(), p.clone()))
            .collect()
    } else {
        vec![]
    };

    build_recipe_from_template(recipe_content, recipe_dir, param_pairs, user_prompt_fn)
}

pub fn apply_values_to_parameters<F>(
    user_params: &[(String, String)],
    recipe_parameters: Option<Vec<RecipeParameter>>,
    recipe_dir: &str,
    user_prompt_fn: Option<F>,
) -> Result<(HashMap<String, String>, Vec<String>)>
where
    F: Fn(&str, &str) -> Result<String, anyhow::Error>,
{
    let mut param_map: HashMap<String, String> = user_params.iter().cloned().collect();
    param_map.insert(
        BUILT_IN_RECIPE_DIR_PARAM.to_string(),
        recipe_dir.to_string(),
    );
    let mut missing_params: Vec<String> = Vec::new();
    for param in recipe_parameters.unwrap_or_default() {
        if !param_map.contains_key(&param.key) {
            match (&param.default, &param.requirement) {
                (Some(default), _) => param_map.insert(param.key.clone(), default.clone()),
                (None, RecipeParameterRequirement::UserPrompt) if user_prompt_fn.is_some() => {
                    let input_value =
                        user_prompt_fn.as_ref().unwrap()(&param.key, &param.description)?;
                    param_map.insert(param.key.clone(), input_value)
                }
                _ => {
                    missing_params.push(param.key.clone());
                    None
                }
            };
        } else if matches!(param.input_type, RecipeParameterInputType::File) {
            let file_path = param_map.get(&param.key).unwrap();
            let file_content = read_parameter_file_content(file_path)?;
            param_map.insert(param.key.clone(), file_content);
        }
    }
    Ok((param_map, missing_params))
}

pub fn resolve_sub_recipe_path(
    sub_recipe_path: &str,
    parent_recipe_dir: &Path,
) -> Result<String, RecipeError> {
    let path = if Path::new(sub_recipe_path).is_absolute() {
        Path::new(sub_recipe_path).to_path_buf()
    } else {
        parent_recipe_dir.join(sub_recipe_path)
    };
    if !path.exists() {
        return Err(RecipeError::Invalid {
            source: anyhow::anyhow!("Sub-recipe file does not exist: {}", path.display()),
        });
    }

    Ok(path.display().to_string())
}

/// Two-phase recipe builder:
/// Phase 1 — Run discover steps for enabled groups
/// Phase 2 — Full template render with all variables (Strict mode)
pub async fn build_discovered_recipe(
    recipe_content: String,
    recipe_dir: &Path,
    user_params: Vec<(String, String)>,
    discover_params: Option<DiscoverExecuteParams>,
) -> Result<Recipe, BuildDiscoveredRecipeError> {
    let flat_params: HashMap<String, String> = user_params.into_iter().collect();

    let mut render_params: HashMap<String, serde_json::Value> = flat_params
        .iter()
        .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
        .collect();
    render_params.insert(
        BUILT_IN_RECIPE_DIR_PARAM.to_string(),
        serde_json::Value::String(recipe_dir.display().to_string()),
    );

    let step_names: HashSet<String> = discover_params
        .as_ref()
        .map(|_| extract_discover_step_names(&recipe_content))
        .transpose()
        .map_err(|e| {
            BuildDiscoveredRecipeError::Invalid(RecipeError::Invalid { source: e })
        })?
        .unwrap_or_default();

    let recipe_template = validate_recipe_template_for_discovery(
        &recipe_content,
        Some(recipe_dir.display().to_string()),
        &step_names,
    )
    .map_err(|source| {
        BuildDiscoveredRecipeError::Invalid(RecipeError::Invalid { source })
    })?;

    if let Some(dp) = discover_params {
        let discovery_results = execute_discovery(
            recipe_template.discover.as_deref().unwrap_or(&[]),
            &flat_params,
            dp.activity_trigger.as_ref(),
            &dp.working_dir,
        )
        .await
        .map_err(BuildDiscoveredRecipeError::DiscoverFailed)?;

        render_params.extend(discovery_results);
    }

    let rendered = render_recipe_content_with_params(&recipe_content, &render_params)
        .map_err(BuildDiscoveredRecipeError::RenderFailed)?;

    let recipe = Recipe::from_content(&rendered)
        .map_err(|e| BuildDiscoveredRecipeError::RenderFailed(e))?;

    Ok(recipe)
}

/// Extract all discover step names from raw recipe YAML content.
fn extract_discover_step_names(content: &str) -> anyhow::Result<HashSet<String>> {
    let yaml_value: serde_yaml::Value = serde_yaml::from_str(content)?;
    let mut names = HashSet::new();
    if let Some(discover) = yaml_value.get("discover").and_then(|v| v.as_sequence()) {
        for group in discover {
            if let Some(steps) = group.get("steps").and_then(|v| v.as_sequence()) {
                for step in steps {
                    if let Some(name) = step.get("name").and_then(|v| v.as_str()) {
                        names.insert(name.to_string());
                    }
                }
            }
        }
    }
    Ok(names)
}

#[derive(Debug, thiserror::Error)]
pub enum BuildDiscoveredRecipeError {
    #[error("Discovery failed: {0:?}")]
    DiscoverFailed(Vec<DiscoverError>),
    #[error("Template render failed: {0}")]
    RenderFailed(anyhow::Error),
    #[error("Invalid recipe: {0}")]
    Invalid(#[from] RecipeError),
}

#[cfg(test)]
mod tests;
