// acp_bridge/images.rs
//
// Utilities for handling image data received from the frontend and converting to ACP ImageContent.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use sacp::schema::ImageContent;

/// Extracts base64 from a data-URL (e.g., "data:image/png;base64,ABC...") or raw base64 string.
/// Returns (base64_str, mime_type).
pub fn parse_image_data(image_input: &str) -> Option<(String, String)> {
    // Try data-URL format first
    if image_input.starts_with("data:") {
        let parts: Vec<&str> = image_input.split(',').collect();
        if parts.len() == 2 {
            let header = parts[0]; // "data:image/png;base64"
            let data = parts[1];
            if header.contains("base64") {
                // Extract MIME type from header (e.g., "image/png")
                let mime = if let Some(m) = header.split(':').nth(1) {
                    m.split(';').next().unwrap_or("image/png").to_string()
                } else {
                    "image/png".to_string()
                };
                return Some((data.to_string(), mime));
            }
        }
    }

    // Otherwise treat as raw base64 with default MIME type
    // Validate it's valid base64
    if STANDARD.decode(image_input).is_ok() {
        return Some((image_input.to_string(), "image/png".to_string()));
    }

    None
}

/// Creates an ACP ImageContent block from base64-encoded image data and MIME type.
pub fn create_image_content(base64_data: &str, mime_type: &str) -> Option<ImageContent> {
    // ImageContent::new takes (data, mime_type)
    // The data should be the base64 string, sacp handles the encoding internally
    Some(ImageContent::new(base64_data, mime_type))
}
