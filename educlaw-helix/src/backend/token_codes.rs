use crate::client::QueryParams;
use crate::error::Result;
use crate::types::*;
use super::extract::{extract_array, try_extract_array};

impl crate::client::HelixClient {
    pub async fn _generate_codes(&self, tokens: i64, count: i64) -> Result<Vec<String>> {
        fn generate_code() -> String {
            let raw = uuid::Uuid::new_v4().to_string().replace('-', "").to_uppercase();
            format!("EDU-{}-{}-{}", &raw[0..4], &raw[4..8], &raw[8..12])
        }
        let now = chrono::Utc::now().to_rfc3339();
        let codes_json: serde_json::Value = (0..count).map(|_| {
            let id = uuid::Uuid::new_v4().to_string();
            let code = generate_code();
            serde_json::json!({"id": id, "code": code, "tokens": tokens, "created_at": now})
        }).collect();
        let resp = self.write("generate_codes", QueryParams::new().add("codes", codes_json)).await?;
        let codes: Vec<String> = resp.get("created").and_then(|v| v.get("properties")).and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.get("code").and_then(|c| c.as_str()).map(String::from)).collect())
            .unwrap_or_default();
        Ok(codes)
    }

    pub async fn _list_codes(&self, tokens: Option<i64>, used: Option<bool>) -> Result<Vec<TokenCode>> {
        let mut params = QueryParams::new().add("tokens", tokens.unwrap_or(0));
        if tokens.is_some() { params.insert("tokens_filter", "true"); } else { params.insert("tokens_filter", ""); }
        if let Some(u) = used {
            if u { params.insert("show_used", "true"); } else { params.insert("show_unused", "true"); }
        }
        let resp = self.read("list_codes", params).await?;
        let mut codes = Vec::new();
        codes.append(&mut try_extract_array(&resp, "codes"));
        codes.append(&mut try_extract_array(&resp, "codes_all"));
        codes.append(&mut try_extract_array(&resp, "codes_used"));
        codes.append(&mut try_extract_array(&resp, "codes_unused"));
        Ok(codes)
    }

    pub async fn _delete_code(&self, id: &str) -> Result<()> {
        self.write("delete_code", QueryParams::new().add("id", id)).await?;
        Ok(())
    }

    pub async fn _redeem_code(&self, code: &str, student_id: &str) -> Result<RedeemResult> {
        let lookup = self.read("redeem_code_lookup", QueryParams::new().add("code", code).add("student_id", student_id)).await?;
        let code_data = lookup.get("code").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).and_then(|arr| arr.first());
        let code_data = match code_data { Some(c) => c, None => return Ok(RedeemResult::NotFound), };
        if code_data.get("used_by").and_then(|v| v.as_str()).is_some() { return Ok(RedeemResult::AlreadyUsed); }
        let code_tokens = code_data.get("tokens").and_then(|v| v.as_i64()).unwrap_or(0);
        let used_at = chrono::Utc::now().to_rfc3339();
        let _ = self.write("redeem_code", QueryParams::new()
            .add("code", code)
            .add("student_id", student_id)
            .add("code_tokens", code_tokens)
            .add("used_at", used_at)).await?;
        let new_balance = self._get_token_balance(student_id).await?;
        Ok(RedeemResult::Success { tokens: code_tokens, new_balance })
    }

    pub async fn _export_codes(&self, tokens: i64) -> Result<Vec<TokenCode>> {
        let resp = self.read("export_codes", QueryParams::new().add("tokens", tokens)).await?;
        extract_array(&resp, "codes")
    }
}
