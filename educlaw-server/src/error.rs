// educlaw-server/src/error.rs

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden")]
    Forbidden,

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("session error: {0}")]
    Session(String),

    #[error("restricted: {0}")]
    Restricted(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("internal: {0}")]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    #[cfg(feature = "helix")]
    pub fn from_helix(err: educlaw_helix::HelixError) -> Self {
        match err {
            educlaw_helix::HelixError::QueryNotFound(msg) => AppError::NotFound(msg),
            educlaw_helix::HelixError::ApiError { status, body } => {
                AppError::Internal(anyhow::anyhow!("Helix API error {}: {}", status, body))
            }
            educlaw_helix::HelixError::Http(e) => {
                AppError::Internal(anyhow::anyhow!("HTTP error: {}", e))
            }
            educlaw_helix::HelixError::InvalidJson(e) => {
                AppError::Internal(anyhow::anyhow!("Invalid JSON: {}", e))
            }
            educlaw_helix::HelixError::MissingParam(msg) => {
                AppError::BadRequest(format!("Missing parameter: {}", msg))
            }
            educlaw_helix::HelixError::ParseError(msg) => {
                AppError::Internal(anyhow::anyhow!("Parse error: {}", msg))
            }
            educlaw_helix::HelixError::ConnectionError(msg) => {
                AppError::Internal(anyhow::anyhow!("HelixDB connection error: {}", msg))
            }
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized".to_string()),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "Forbidden".to_string()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            AppError::Session(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::Restricted(msg) => (StatusCode::FORBIDDEN, msg.clone()),
            AppError::Db(e) => {
                tracing::error!("db error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Database error".to_string(),
                )
            }
            AppError::Session(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::Io(e) => {
                tracing::error!("io error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "IO error".to_string())
            }
            AppError::Internal(e) => {
                tracing::error!("internal error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".to_string(),
                )
            }
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
