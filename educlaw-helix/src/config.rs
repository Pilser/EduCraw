#[derive(Debug, Clone)]
pub struct HelixConfig {
    pub base_url: String,
    pub timeout_secs: u64,
}

impl HelixConfig {
    pub fn from_env() -> Self {
        Self {
            base_url: std::env::var("HELIX_URL").unwrap_or_else(|_| "http://localhost:8000".into()),
            timeout_secs: std::env::var("HELIX_TIMEOUT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(30),
        }
    }
}
