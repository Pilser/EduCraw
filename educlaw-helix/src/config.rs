use url::Url;

#[derive(Debug, Clone)]
pub struct HelixConfig {
    pub base_url: String,
    pub timeout_secs: u64,
}

impl HelixConfig {
    pub fn from_env() -> Result<Self, String> {
        let base_url = std::env::var("HELIX_URL")
            .map_err(|_| "HELIX_URL environment variable is not set".to_string())?;

        // Validate URL and extract port for logging
        let parsed = Url::parse(&base_url)
            .map_err(|e| format!("HELIX_URL is not a valid URL: {e}"))?;

        let port = parsed.port_or_known_default()
            .map(|p| p.to_string())
            .unwrap_or_else(|| "default".to_string());

        let host = parsed.host_str().unwrap_or("unknown");

        tracing::info!(
            helix_url = %base_url,
            helix_host = %host,
            helix_port = %port,
            "HelixDB configuration loaded"
        );

        let timeout_secs = std::env::var("HELIX_TIMEOUT")
            .map_err(|_| "HELIX_TIMEOUT environment variable is not set".to_string())?
            .parse::<u64>()
            .map_err(|e| format!("HELIX_TIMEOUT is not a valid number: {e}"))?;

        Ok(Self {
            base_url,
            timeout_secs,
        })
    }
}
