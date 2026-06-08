pub mod coordinator;
pub mod scanners;

pub use coordinator::execute_discovery;
pub use scanners::{check_file, scan_folder, scan_skills_by_filter};

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A group of discovery steps that can be enabled/disabled by activity triggers
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiscoverGroup {
    /// Logical group name (matched by activity triggers)
    pub group: String,
    /// Keywords that enable this group when they match activity param values
    #[serde(default)]
    pub enabled_by: Vec<String>,
    /// Whether the whole group is required (fails if any required step fails)
    #[serde(default)]
    pub required: bool,
    /// Ordered list of discovery steps in this group
    pub steps: Vec<DiscoverStep>,
}

/// A single discovery operation
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiscoverStep {
    /// Variable name for template injection
    pub name: String,
    /// Type of discovery
    #[serde(rename = "type")]
    pub r#type: DiscoverType,
    /// Path for folder/file/skill types (supports Phase 1 template vars)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Glob filter for skill discovery (supports Phase 1 template vars)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    /// URL for url type
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Whether a failure blocks recipe loading
    #[serde(default)]
    pub required: bool,
    /// Max retries for url type
    #[serde(default)]
    pub retry: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub enum DiscoverType {
    Folder,
    File,
    Skill,
    Url,
}

/// Group enablement trigger from activity click
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityTrigger {
    /// Which discover group to enable
    pub group: String,
    /// The specific activity label (used on frontend to mark only this button as selected)
    pub label: String,
    /// Parameter values for discovery + template rendering
    pub params: HashMap<String, String>,
}

/// Parameters passed to the discover coordinator
#[derive(Debug, Clone)]
pub struct DiscoverExecuteParams {
    pub working_dir: std::path::PathBuf,
    pub activity_trigger: Option<ActivityTrigger>,
}

/// Result of a single successful discovery step
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum DiscoverResultValue {
    Folder(FolderResult),
    File(FileResult),
    SkillList(Vec<SkillResult>),
    Url(UrlResult),
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderResult {
    pub path: String,
    pub name: String,
    pub entries: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileResult {
    pub path: String,
    pub folder: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillResult {
    pub name: String,
    pub description: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UrlResult {
    pub content: String,
    pub status: u16,
    pub url: String,
}

/// Structured error from a required discovery step
#[derive(Debug, Clone, Serialize)]
pub struct DiscoverError {
    pub code: String,
    pub step: String,
    pub step_type: String,
    pub path: String,
    pub message: String,
}
