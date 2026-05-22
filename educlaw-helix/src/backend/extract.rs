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

/// Extract a Sum aggregate from an `AggregateBy: ["Sum", field]` query result.
/// Response shape: `{query_key: {properties: [{field_Sum: float}]}}`
pub fn extract_aggregate_sum(body: &serde_json::Value, query_key: &str, field: &str) -> Result<i64> {
    let sum_key = format!("{field}_Sum");
    let val = body.get(query_key)
        .and_then(|v| v.get("properties"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.get(&sum_key))
        .and_then(|v| v.as_f64())
        .ok_or_else(|| HelixError::ParseError(format!("missing '{query_key}' aggregate '{}' in response", sum_key)))?;
    Ok(val as i64)
}

/// Extract a `Count` result from a query with a `"Count"` step.
/// Response shape: `{query_key: {count: i64}}`
pub fn extract_count(body: &serde_json::Value, query_key: &str) -> Result<i64> {
    body.get(query_key)
        .and_then(|v| v.get("count"))
        .and_then(|v| v.as_i64())
        .ok_or_else(|| HelixError::ParseError(format!("missing '{}' count in response", query_key)))
}
