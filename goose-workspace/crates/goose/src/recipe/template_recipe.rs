use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use crate::recipe::{Recipe, BUILT_IN_RECIPE_DIR_PARAM};
use anyhow::Result;
use minijinja::{Environment, UndefinedBehavior};
use regex::Regex;

const CURRENT_TEMPLATE_NAME: &str = "recipe";
const OPEN_BRACE: &str = "{{";
const CLOSE_BRACE: &str = "}}";

fn preprocess_template_variables(content: &str) -> Result<String> {
    let all_template_variables = extract_template_variables(content);
    let complex_template_variables = filter_complex_variables(&all_template_variables);
    let unparsable_template_variables = filter_unparseable_variables(&complex_template_variables)?;
    replace_unparseable_vars_with_raw(content, &unparsable_template_variables)
}

fn extract_template_variables(content: &str) -> Vec<String> {
    let template_var_re = Regex::new(r"\{\{(.*?)\}\}").unwrap();
    template_var_re
        .captures_iter(content)
        .map(|cap| cap[1].to_string())
        .collect()
}

// filter out variables that are not only alphanumeric and underscores
fn filter_complex_variables(template_variables: &[String]) -> Vec<String> {
    let valid_var_re = Regex::new(r"^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*$").unwrap();
    template_variables
        .iter()
        .filter(|var| !valid_var_re.is_match(var))
        .cloned()
        .collect()
}

fn filter_unparseable_variables(template_variables: &[String]) -> Result<Vec<String>> {
    let mut vars_to_convert = Vec::new();

    for var in template_variables {
        let trimmed = var.trim();

        if trimmed.starts_with('\'') || trimmed.starts_with('"') {
            continue;
        }

        let mut env = Environment::new();
        env.set_undefined_behavior(UndefinedBehavior::Lenient);

        let test_template = format!(
            "{open}{content}{close}",
            open = OPEN_BRACE,
            content = var,
            close = CLOSE_BRACE
        );
        if env.template_from_str(&test_template).is_err() {
            vars_to_convert.push(var.clone());
        }
    }

    Ok(vars_to_convert)
}

fn replace_unparseable_vars_with_raw(
    content: &str,
    unparsable_template_variables: &[String],
) -> Result<String> {
    let mut result = content.to_string();

    for var in unparsable_template_variables {
        let pattern = format!(
            "{open}{content}{close}",
            open = OPEN_BRACE,
            content = var,
            close = CLOSE_BRACE
        );
        let replacement = format!(
            "{{% raw %}}{open}{content}{close}{{% endraw %}}",
            open = OPEN_BRACE,
            close = CLOSE_BRACE,
            content = var
        );
        result = result.replace(&pattern, &replacement);
    }

    Ok(result)
}

pub fn render_recipe_content_with_params(
    content: &str,
    params: &HashMap<String, serde_json::Value>,
) -> Result<String> {
    // Pre-process content to replace empty double quotes with single quotes
    // This prevents MiniJinja from escaping "" to "\"\"" which would break YAML parsing
    let re = Regex::new(r#":\s*"""#).unwrap();
    let content_with_empty_quotes_replaced = re.replace_all(content, ": ''");

    // Pre-process template variables to convert invalid variable names to raw content
    let content_with_safe_variables =
        preprocess_template_variables(&content_with_empty_quotes_replaced)?;

    let recipe_dir = params
        .get(BUILT_IN_RECIPE_DIR_PARAM)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let env = add_template_in_env(
        &content_with_safe_variables,
        recipe_dir,
        UndefinedBehavior::Strict,
    )?;
    let template = env.get_template(CURRENT_TEMPLATE_NAME).unwrap();
    let rendered_content = template
        .render(params)
        .map_err(|e| anyhow::anyhow!("Failed to render the recipe {}", e))?;
    Ok(rendered_content)
}

/// Phase 1 render: resolve only the path/url fields in discover steps.
/// Uses Lenient undefined behavior — missing params produce empty string
/// instead of errors (so optional steps can have optional path segments).
pub fn render_discover_path(
    template_str: &str,
    params: &HashMap<String, String>,
) -> Result<String> {
    use minijinja::Environment;
    let mut env = Environment::new();
    env.set_undefined_behavior(UndefinedBehavior::Lenient);
    let tmpl = env
        .template_from_str(template_str)
        .map_err(|e| anyhow::anyhow!("Failed to parse discover path template: {}", e))?;
    tmpl.render(params)
        .map_err(|e| anyhow::anyhow!("Failed to render discover path: {}", e))
}

fn add_template_in_env(
    content: &str,
    recipe_dir: Option<String>,
    undefined_behavior: UndefinedBehavior,
) -> Result<Environment<'_>> {
    let mut env = minijinja::Environment::new();
    env.set_undefined_behavior(undefined_behavior);

    if let Some(recipe_dir) = recipe_dir {
        env.set_loader(move |name| {
            let path = Path::new(recipe_dir.as_str()).join(name);
            match std::fs::read_to_string(&path) {
                Ok(content) => Ok(Some(content)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(minijinja::Error::new(
                    minijinja::ErrorKind::InvalidOperation,
                    "could not read template",
                )
                .with_source(e)),
            }
        });
    }

    env.add_template(CURRENT_TEMPLATE_NAME, content)?;
    Ok(env)
}

fn get_env_with_template_variables(
    content: &str,
    recipe_dir: Option<String>,
    undefined_behavior: UndefinedBehavior,
) -> Result<(Environment<'_>, HashSet<String>)> {
    let env = add_template_in_env(content, recipe_dir, undefined_behavior)?;
    let template_variables = {
        let template = env.get_template(CURRENT_TEMPLATE_NAME).unwrap();
        let captured = template.render_captured(())?;
        let state = captured.state();
        let mut vars = HashSet::new();
        for (_, tmpl) in state.env().templates() {
            vars.extend(tmpl.undeclared_variables(false));
        }
        vars
    };
    Ok((env, template_variables))
}

fn uses_template_inheritance(content: &str) -> bool {
    let re = Regex::new(r"\{%-?\s*(extends|include)").unwrap();
    re.is_match(content)
}

pub fn parse_recipe_content(
    content: &str,
    recipe_dir: Option<String>,
) -> Result<(Recipe, HashSet<String>)> {
    // Pre-process template variables to handle invalid variable names
    let preprocessed_content = preprocess_template_variables(content)?;

    let (env, template_variables) = get_env_with_template_variables(
        &preprocessed_content,
        recipe_dir,
        UndefinedBehavior::Lenient,
    )?;
    let template = env.get_template(CURRENT_TEMPLATE_NAME).unwrap();

    // Detect if template uses inheritance or includes
    let recipe_content = if uses_template_inheritance(&preprocessed_content) {
        // Must render to resolve inheritance
        template
            .render(())
            .map_err(|e| anyhow::anyhow!("Failed to parse the recipe {}", e))?
    } else {
        // Preserve conditionals and variables as-is
        preprocessed_content
    };

    let recipe = Recipe::from_content(&recipe_content)?;
    // return recipe (without loading any variables) and the variable names that are in the recipe
    Ok((recipe, template_variables))
}

#[cfg(test)]
mod tests {
    mod render_content_with_params_tests {
        use std::collections::HashMap;

        use crate::recipe::template_recipe::render_recipe_content_with_params;

        fn string_param(key: &str, value: &str) -> (String, serde_json::Value) {
            (key.to_string(), serde_json::Value::String(value.to_string()))
        }

        #[test]
        fn test_render_content_with_params() {
            // Test basic parameter substitution
            let content = "Hello {{ name }}!";
            let params = HashMap::from([
                string_param("recipe_dir", "some_dir"),
                string_param("name", "World"),
            ]);
            let result = render_recipe_content_with_params(content, &params).unwrap();
            assert_eq!(result, "Hello World!");

            // Test empty parameter substitution
            let content = "Hello {{ empty }}!";
            let params = HashMap::from([
                string_param("recipe_dir", "some_dir"),
                string_param("empty", ""),
            ]);
            let result = render_recipe_content_with_params(content, &params).unwrap();
            assert_eq!(result, "Hello !");

            // Test multiple parameters
            let content = "{{ greeting }} {{ name }}!";
            let params = HashMap::from([
                string_param("recipe_dir", "some_dir"),
                string_param("greeting", "Hi"),
                string_param("name", "Alice"),
            ]);
            let result = render_recipe_content_with_params(content, &params).unwrap();
            assert_eq!(result, "Hi Alice!");

            // Test missing parameter results in error
            let content = "Hello {{ missing }}!";
            let params = HashMap::from([
                string_param("recipe_dir", "some_dir"),
            ]);
            let err = render_recipe_content_with_params(content, &params).unwrap_err();
            let error_msg = err.to_string();
            assert!(error_msg.contains("Failed to render the recipe"));

            // Test invalid template syntax results in error
            let content = "Hello {{ unclosed";
            let params = HashMap::from([
                string_param("recipe_dir", "some_dir"),
            ]);
            let err = render_recipe_content_with_params(content, &params).unwrap_err();
            assert!(err.to_string().contains("unexpected end of input"));
        }

        #[test]
        fn test_render_content_with_spaced_variables() {
            let content = "Hello {{hf model org}}_{{hf model name}}!";
            let params = HashMap::from([
                string_param("recipe_dir", "some_dir"),
            ]);
            let result = render_recipe_content_with_params(content, &params).unwrap();
            assert_eq!(result, "Hello {{hf model org}}_{{hf model name}}!");

            let content = "Hello {{hf model org}_{hf model name}}!";
            let params = HashMap::from([
                string_param("recipe_dir", "some_dir"),
            ]);
            let result = render_recipe_content_with_params(content, &params).unwrap();
            assert_eq!(result, "Hello {{hf model org}_{hf model name}}!");

            let content = "Hello {{valid_var}}!";
            let params = HashMap::from([
                string_param("recipe_dir", "some_dir"),
                string_param("valid_var", "World"),
            ]);
            let result = render_recipe_content_with_params(content, &params).unwrap();
            assert_eq!(result, "Hello World!");

            let content = "{{valid_var}} and {{invalid var}}";
            let params = HashMap::from([
                string_param("recipe_dir", "some_dir"),
                string_param("valid_var", "Hello"),
            ]);
            let result = render_recipe_content_with_params(content, &params).unwrap();
            assert_eq!(result, "Hello and {{invalid var}}");
        }

        #[test]
        fn test_empty_prompt() {
            let content = r#"
prompt: ""
name: "Simple Recipe"
description: "A test recipe"
"#;
            let params = HashMap::from([
                string_param("recipe_dir", "test_dir"),
            ]);
            let result = render_recipe_content_with_params(content, &params).unwrap();

            assert!(result.contains("prompt: ''"));
            assert!(!result.contains(r#"prompt: "\"\"""#));

            assert!(result.contains(r#"name: "Simple Recipe""#));
        }

        #[test]
        fn test_jinja_escape_syntax() {
            let content = r#"{{'{{param_key}}'}}"#;
            let params = HashMap::from([
                string_param("recipe_dir", "test_dir"),
            ]);
            let result = render_recipe_content_with_params(content, &params).unwrap();
            assert_eq!(result, "{{param_key}}");
        }

        #[test]
        fn test_render_with_structured_value() {
            let content = "Path: {{ materials.path }}, Files: {% for f in materials.entries %}{{ f }},{% endfor %}";
            let mut params: HashMap<String, serde_json::Value> = HashMap::new();
            params.insert("recipe_dir".to_string(), serde_json::Value::String(".".to_string()));
            params.insert("materials".to_string(), serde_json::json!({
                "path": "/study/math",
                "entries": ["a.pdf", "b.pdf"]
            }));
            let result = render_recipe_content_with_params(content, &params).unwrap();
            assert_eq!(result, "Path: /study/math, Files: a.pdf,b.pdf,");
        }
    }
}
