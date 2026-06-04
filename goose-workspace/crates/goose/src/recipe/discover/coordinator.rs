use std::collections::HashMap;
use std::path::Path;

use crate::recipe::discover::{
    scanners, ActivityTrigger, DiscoverError, DiscoverGroup, DiscoverStep, DiscoverType,
};
use crate::recipe::template_recipe::render_discover_path;

/// Phase 1: execute discovery for all enabled groups.
/// Returns a map of step names → their discovered values.
///
/// If a required step fails, returns Err(DiscoverError).
/// If a non-required step fails, the step is skipped
/// (template must use {% if %} guards).
pub async fn execute_discovery(
    discover_groups: &[DiscoverGroup],
    user_params: &HashMap<String, String>,
    activity_trigger: Option<&ActivityTrigger>,
    working_dir: &Path,
) -> Result<HashMap<String, serde_json::Value>, Vec<DiscoverError>> {
    let mut results = HashMap::new();
    let mut errors = Vec::new();

    let merged_params = merge_params(user_params, activity_trigger);

    for group in discover_groups {
        if !is_group_enabled(group, &merged_params, activity_trigger) {
            continue;
        }

        for step in &group.steps {
            match execute_step(step, &merged_params, working_dir).await {
                Ok(value) => {
                    results.insert(step.name.clone(), value);
                }
                Err(err) if step.required || group.required => {
                    errors.push(err);
                }
                Err(_) => {
                    // Non-required step — skip, variable stays undefined
                }
            }
        }
    }

    if errors.is_empty() {
        Ok(results)
    } else {
        Err(errors)
    }
}

fn is_group_enabled(
    group: &DiscoverGroup,
    params: &HashMap<String, String>,
    activity_trigger: Option<&ActivityTrigger>,
) -> bool {
    // If this group name matches the activity trigger, it's enabled
    if let Some(trigger) = activity_trigger {
        if trigger.group == group.group {
            return true;
        }
    }

    // If enabled_by is empty, group is always enabled
    if group.enabled_by.is_empty() {
        return true;
    }

    // Check if any param value matches any enabled_by keyword
    for keyword in &group.enabled_by {
        let keyword_lower = keyword.to_lowercase();
        for value in params.values() {
            if value.to_lowercase().contains(&keyword_lower) {
                return true;
            }
        }
    }

    false
}

fn merge_params(
    user_params: &HashMap<String, String>,
    activity_trigger: Option<&ActivityTrigger>,
) -> HashMap<String, String> {
    let mut merged = user_params.clone();
    if let Some(trigger) = activity_trigger {
        // Activity params override user params
        for (k, v) in &trigger.params {
            merged.insert(k.clone(), v.clone());
        }
    }
    merged
}

async fn execute_step(
    step: &DiscoverStep,
    params: &HashMap<String, String>,
    working_dir: &Path,
) -> Result<serde_json::Value, DiscoverError> {
    match step.r#type {
        DiscoverType::Folder => {
            let path = step
                .path
                .as_deref()
                .map(|p| render_discover_path(p, params))
                .transpose()
                .map_err(|e| DiscoverError {
                    code: "RENDER_ERROR".into(),
                    step: step.name.clone(),
                    step_type: "folder".into(),
                    path: step.path.clone().unwrap_or_default(),
                    message: e.to_string(),
                })?
                .unwrap_or_default();
            scanners::scan_folder(&path, &step.name, working_dir)
                .map(|r| serde_json::to_value(r).unwrap())
        }
        DiscoverType::File => {
            let path = step
                .path
                .as_deref()
                .map(|p| render_discover_path(p, params))
                .transpose()
                .map_err(|e| DiscoverError {
                    code: "RENDER_ERROR".into(),
                    step: step.name.clone(),
                    step_type: "file".into(),
                    path: step.path.clone().unwrap_or_default(),
                    message: e.to_string(),
                })?
                .unwrap_or_default();
            scanners::check_file(&path, &step.name, working_dir)
                .map(|r| serde_json::to_value(r).unwrap())
        }
        DiscoverType::Skill => {
            let path = step
                .path
                .as_deref()
                .map(|p| render_discover_path(p, params))
                .transpose()
                .map_err(|e| DiscoverError {
                    code: "RENDER_ERROR".into(),
                    step: step.name.clone(),
                    step_type: "skill".into(),
                    path: step.path.clone().unwrap_or_default(),
                    message: e.to_string(),
                })?
                .unwrap_or_default();
            let filter = step
                .filter
                .as_deref()
                .map(|f| render_discover_path(f, params).ok())
                .flatten();
            scanners::scan_skills_by_filter(&path, filter.as_deref(), &step.name, working_dir)
                .map(|r| serde_json::to_value(r).unwrap())
        }
        DiscoverType::Url => {
            let url = step
                .url
                .as_deref()
                .map(|u| render_discover_path(u, params))
                .transpose()
                .map_err(|e| DiscoverError {
                    code: "RENDER_ERROR".into(),
                    step: step.name.clone(),
                    step_type: "url".into(),
                    path: step.url.clone().unwrap_or_default(),
                    message: e.to_string(),
                })?
                .unwrap_or_default();
            scanners::fetch_url(&url, step.retry, &step.name)
                .await
                .map(|r| serde_json::to_value(r).unwrap())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_group(group: &str, enabled_by: Vec<&str>, required: bool) -> DiscoverGroup {
        DiscoverGroup {
            group: group.to_string(),
            enabled_by: enabled_by.into_iter().map(|s| s.to_string()).collect(),
            required,
            steps: vec![],
        }
    }

    #[test]
    fn test_group_enabled_by_keyword() {
        let group = make_group("math", vec!["Mathematics", "algebra"], false);
        let mut params = HashMap::new();
        params.insert("subject".to_string(), "Mathematics".to_string());
        assert!(is_group_enabled(&group, &params, None));
    }

    #[test]
    fn test_group_enabled_by_trigger() {
        let group = make_group("math", vec![], false);
        let params = HashMap::new();
        let trigger = ActivityTrigger {
            group: "math".to_string(),
            params: HashMap::new(),
        };
        assert!(is_group_enabled(&group, &params, Some(&trigger)));
    }

    #[test]
    fn test_group_always_enabled() {
        let group = make_group("default", vec![], false);
        let params = HashMap::new();
        assert!(is_group_enabled(&group, &params, None));
    }

    #[test]
    fn test_group_not_enabled() {
        let group = make_group("science", vec!["Science"], false);
        let mut params = HashMap::new();
        params.insert("subject".to_string(), "Mathematics".to_string());
        assert!(!is_group_enabled(&group, &params, None));
    }

    #[test]
    fn test_case_insensitive_match() {
        let group = make_group("math", vec!["mathematics"], false);
        let mut params = HashMap::new();
        params.insert("subject".to_string(), "MATHEMATICS".to_string());
        assert!(is_group_enabled(&group, &params, None));
    }

    #[test]
    fn test_partial_match() {
        let group = make_group("math", vec!["math"], false);
        let mut params = HashMap::new();
        params.insert("subject".to_string(), "Mathematics".to_string());
        assert!(is_group_enabled(&group, &params, None));
    }

    #[test]
    fn test_merge_params_user_only() {
        let mut user = HashMap::new();
        user.insert("a".to_string(), "1".to_string());
        let merged = merge_params(&user, None);
        assert_eq!(merged.get("a").unwrap(), "1");
    }

    #[test]
    fn test_merge_params_activity_overrides() {
        let mut user = HashMap::new();
        user.insert("a".to_string(), "1".to_string());
        user.insert("b".to_string(), "2".to_string());
        let trigger = ActivityTrigger {
            group: "test".to_string(),
            params: HashMap::from([("b".to_string(), "99".to_string())]),
        };
        let merged = merge_params(&user, Some(&trigger));
        assert_eq!(merged.get("a").unwrap(), "1");
        assert_eq!(merged.get("b").unwrap(), "99");
    }
}
