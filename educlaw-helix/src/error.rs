#[derive(Debug, thiserror::Error)]
pub enum HelixError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Query not found: {0}")]
    QueryNotFound(String),
    #[error("Invalid query JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("Helix API error: {status} - {body}")]
    ApiError { status: u16, body: String },
    #[error("Missing parameter: {0}")]
    MissingParam(String),
    #[error("Parse error: {0}")]
    ParseError(String),
}

pub type Result<T> = std::result::Result<T, HelixError>;
