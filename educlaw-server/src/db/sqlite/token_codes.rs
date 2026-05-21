use crate::db::{BackendResult, SqliteBackend, TokenCode, RedeemResult};

impl SqliteBackend {
    pub async fn _generate_codes(&self, tokens: i64, count: i64) -> BackendResult<Vec<String>> {
        Ok(crate::db::token_codes::generate_codes(&self.pool, tokens, count).await?)
    }
    pub async fn _list_codes(&self, tokens: Option<i64>, used: Option<bool>) -> BackendResult<Vec<TokenCode>> {
        Ok(crate::db::token_codes::list_codes(&self.pool, tokens, used).await?)
    }
    pub async fn _delete_code(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::token_codes::delete_code(&self.pool, id).await?)
    }
    pub async fn _redeem_code(&self, code: &str, student_id: &str) -> BackendResult<RedeemResult> {
        let result = crate::db::token_codes::redeem_code(&self.pool, code, student_id).await?;
        match result {
            crate::db::token_codes::RedeemResult::Success { tokens, new_balance } => Ok(RedeemResult::Success { tokens, new_balance }),
            crate::db::token_codes::RedeemResult::NotFound => Ok(RedeemResult::NotFound),
            crate::db::token_codes::RedeemResult::AlreadyUsed => Ok(RedeemResult::AlreadyUsed),
        }
    }
    pub async fn _export_codes(&self, tokens: i64) -> BackendResult<Vec<TokenCode>> {
        Ok(crate::db::token_codes::export_codes(&self.pool, tokens).await?)
    }
}
