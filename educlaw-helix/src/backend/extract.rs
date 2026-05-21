use crate::error::{HelixError, Result};

pub fn extract_array<T: serde::de::DeserializeOwned>(
    body: &serde_json::Value,
    key: &str,
) -> Result<Vec<T>> {
    let arr = body
        .get(key)
        .and_then(|v| {
            if let Some(obj) = v.as_object() {
                obj.get("properties").and_then(|p| p.as_array())
                    .or_else(|| obj.get("ids").and_then(|p| p.as_array()))
                    .or_else(|| v.as_array())
            } else {
                v.as_array()
            }
        });
    let arr = match arr {
        Some(a) => a,
        None => {
            tracing::error!(
                key = key,
                response_keys = ?body.as_object().map(|o| o.keys().collect::<Vec<_>>()),
                full_response = %body,
                "extract_array: key not found in HelixDB response"
            );
            return Err(HelixError::ParseError(format!("missing '{}' array in response", key)));
        }
    };
    Ok(arr
        .iter()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect())
}

pub fn try_extract_array<T: serde::de::DeserializeOwned>(
    body: &serde_json::Value,
    key: &str,
) -> Vec<T> {
    body.get(key)
        .and_then(|v| {
            if let Some(obj) = v.as_object() {
                obj.get("properties").and_then(|p| p.as_array())
                    .or_else(|| obj.get("ids").and_then(|p| p.as_array()))
                    .or_else(|| v.as_array())
            } else {
                v.as_array()
            }
        })
        .map(|arr| {
            arr.iter()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

pub fn extract_optional<T: serde::de::DeserializeOwned>(
    body: &serde_json::Value,
    key: &str,
) -> Result<Option<T>> {
    let arr = body
        .get(key)
        .and_then(|v| {
            if let Some(obj) = v.as_object() {
                obj.get("properties").and_then(|p| p.as_array())
                    .or_else(|| v.as_array())
            } else {
                v.as_array()
            }
        });
    let arr = match arr {
        Some(a) => a,
        None => {
            return Err(HelixError::ParseError(format!("missing '{}' array in response", key)));
        }
    };
    if arr.is_empty() {
        Ok(None)
    } else {
        Ok(serde_json::from_value(arr[0].clone()).ok())
    }
}

pub fn extract_i64(body: &serde_json::Value, key: &str) -> Result<i64> {
    body.get(key)
        .and_then(|v| v.as_i64())
        .ok_or_else(|| HelixError::ParseError(format!("missing '{}' i64 in response", key)))
}

pub fn extract_f64(body: &serde_json::Value, key: &str) -> Result<f64> {
    body.get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| HelixError::ParseError(format!("missing '{}' f64 in response", key)))
}
