use std::path::{Path, PathBuf};

use crate::recipe::discover::{
    DiscoverError, FileResult, FolderResult, SkillResult, UrlResult,
};

pub fn scan_folder(
    path_str: &str,
    step_name: &str,
    working_dir: &Path,
) -> Result<FolderResult, DiscoverError> {
    let abs_path = resolve_path(path_str, working_dir);

    if !abs_path.exists() || !abs_path.is_dir() {
        return Err(DiscoverError {
            code: "RESOURCE_NOT_FOUND".into(),
            step: step_name.into(),
            step_type: "folder".into(),
            path: abs_path.display().to_string(),
            message: format!("Folder not found: {}", abs_path.display()),
        });
    }

    let entries = std::fs::read_dir(&abs_path)
        .map_err(|e| DiscoverError {
            code: "READ_ERROR".into(),
            step: step_name.into(),
            step_type: "folder".into(),
            path: abs_path.display().to_string(),
            message: e.to_string(),
        })?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
        .collect::<Vec<_>>();

    let folder_name = abs_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    Ok(FolderResult {
        path: abs_path.display().to_string(),
        name: folder_name,
        entries,
    })
}

pub fn check_file(
    path_str: &str,
    step_name: &str,
    working_dir: &Path,
) -> Result<FileResult, DiscoverError> {
    let abs_path = resolve_path(path_str, working_dir);

    if !abs_path.exists() || !abs_path.is_file() {
        return Err(DiscoverError {
            code: "RESOURCE_NOT_FOUND".into(),
            step: step_name.into(),
            step_type: "file".into(),
            path: abs_path.display().to_string(),
            message: format!("File not found: {}", abs_path.display()),
        });
    }

    let folder = abs_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let name = abs_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    Ok(FileResult {
        path: abs_path.display().to_string(),
        folder,
        name,
    })
}

pub fn scan_skills_by_filter(
    skills_root_str: &str,
    filter: Option<&str>,
    step_name: &str,
    working_dir: &Path,
) -> Result<Vec<SkillResult>, DiscoverError> {
    let skills_root = resolve_path(skills_root_str, working_dir);

    if !skills_root.exists() || !skills_root.is_dir() {
        return Err(DiscoverError {
            code: "RESOURCE_NOT_FOUND".into(),
            step: step_name.into(),
            step_type: "skill".into(),
            path: skills_root.display().to_string(),
            message: format!("Skills directory not found: {}", skills_root.display()),
        });
    }

    let mut results = Vec::new();

    for entry in std::fs::read_dir(&skills_root).map_err(|e| DiscoverError {
        code: "READ_ERROR".into(),
        step: step_name.into(),
        step_type: "skill".into(),
        path: skills_root.display().to_string(),
        message: e.to_string(),
    })? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let folder_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        // Apply glob filter if specified
        if let Some(f) = filter {
            if !glob_match(f, &folder_name) {
                continue;
            }
        }

        let skill_md = path.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }

        // Use existing skills module to parse frontmatter
        if let Some((name, description)) = crate::skills::read_skill_frontmatter(&skill_md) {
            results.push(SkillResult {
                name,
                description,
                path: skill_md.display().to_string(),
            });
        }
    }

    Ok(results)
}

pub async fn fetch_url(
    url: &str,
    _retry: u32,
    step_name: &str,
) -> Result<UrlResult, DiscoverError> {
    Err(DiscoverError {
        code: "NOT_IMPLEMENTED".into(),
        step: step_name.into(),
        step_type: "url".into(),
        path: url.into(),
        message: "URL fetch not yet implemented — requires network allowlist configuration".into(),
    })
}

fn resolve_path(path_str: &str, working_dir: &Path) -> PathBuf {
    let path = Path::new(path_str);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        working_dir.join(path)
    }
}

fn glob_match(pattern: &str, name: &str) -> bool {
    if pattern == "*" {
        return true;
    }

    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == name;
    }

    let mut pos = 0;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            if !name.starts_with(part) {
                return false;
            }
            pos = part.len();
        } else if i == parts.len() - 1 {
            if !name[pos..].ends_with(part) {
                return false;
            }
        } else {
            match name[pos..].find(part) {
                Some(idx) => pos += idx + part.len(),
                None => return false,
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_match_exact() {
        assert!(glob_match("math-functions", "math-functions"));
        assert!(!glob_match("math-functions", "math-functions-extra"));
    }

    #[test]
    fn test_glob_match_wildcard() {
        assert!(glob_match("*", "anything"));
        assert!(glob_match("math-*", "math-functions"));
        assert!(glob_match("math-*", "math-fractions"));
        assert!(!glob_match("math-*", "science-physics"));
    }

    #[test]
    fn test_glob_match_prefix() {
        assert!(glob_match("math-*", "math-functions"));
        assert!(glob_match("math-*", "math-"));
        assert!(!glob_match("math-*", "math"));
    }

    #[test]
    fn test_glob_match_suffix() {
        assert!(glob_match("*-functions", "math-functions"));
        assert!(glob_match("*-functions", "science-functions"));
        assert!(!glob_match("*-functions", "math-functions-extra"));
    }

    #[test]
    fn test_glob_match_multi_wildcard() {
        assert!(glob_match("a*b*c", "aXbYc"));
        assert!(!glob_match("a*b*c", "aXbY"));
    }
}
