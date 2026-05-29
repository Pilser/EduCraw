use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("session error: {0}")]
    Session(String),

    #[error("session not found: {0}")]
    SessionNotFound(String),

    #[error("session not active: {0}")]
    SessionNotActive(String),

    #[error("session expired: {0}")]
    SessionExpired(String),

    #[error("buffer timed out: {0}")]
    BufferTimedOut(String),

    #[error("buffer drained: {0}")]
    BufferDrained(String),

    #[error("restricted: {0}")]
    Restricted(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("helix error: {0}")]
    Helix(educlaw_helix::HelixError),

    #[error("internal: {0}")]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    /// Machine-readable error code for frontend classification.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound(_) => "NOT_FOUND",
            Self::BadRequest(_) => "BAD_REQUEST",
            Self::Unauthorized => "UNAUTHORIZED",
            Self::Forbidden(_) => "FORBIDDEN",
            Self::Conflict(_) => "CONFLICT",
            Self::Session(_) => "SESSION_ERROR",
            Self::SessionNotFound(_) => "SESSION_NOT_FOUND",
            Self::SessionNotActive(_) => "SESSION_NOT_ACTIVE",
            Self::SessionExpired(_) => "SESSION_EXPIRED",
            Self::BufferTimedOut(_) => "BUFFER_TIMED_OUT",
            Self::BufferDrained(_) => "BUFFER_DRAINED",
            Self::Restricted(_) => "RESTRICTED",
            Self::Io(_) => "IO_ERROR",
            Self::Helix(_) => "HELIX_ERROR",
            Self::Internal(_) => "INTERNAL_ERROR",
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized".to_string()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            AppError::Session(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::SessionNotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::SessionNotActive(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::SessionExpired(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::BufferTimedOut(msg) => (StatusCode::CONFLICT, msg.clone()),
            AppError::BufferDrained(msg) => (StatusCode::CONFLICT, msg.clone()),
            AppError::Restricted(msg) => (StatusCode::FORBIDDEN, msg.clone()),
            AppError::Io(e) => {
                tracing::error!("io error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "IO error".to_string())
            }
            AppError::Helix(e) => {
                tracing::error!("helix error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Helix database error".to_string())
            }
            AppError::Internal(e) => {
                tracing::error!("internal error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string())
            }
        };

        (status, Json(json!({ "error": message, "code": self.code() }))).into_response()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
