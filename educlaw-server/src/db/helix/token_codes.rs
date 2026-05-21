use crate::db::{BackendResult, HelixBackend, TokenCode, RedeemResult};
use educlaw_helix::DbBackend as HelixDb;
use super::conv::*;

impl HelixBackend {
    pub async fn _generate_codes(&self, tokens: i64, count: i64) -> BackendResult<Vec<String>> {
        Ok(HelixDb::generate_codes(&self.client, tokens, count).await?)
    }
    pub async fn _list_codes(&self, tokens: Option<i64>, used: Option<bool>) -> BackendResult<Vec<TokenCode>> {
        let c = HelixDb::list_codes(&self.client, tokens, used).await?;
        Ok(c.into_iter().map(helix_token_code_to_local).collect())
    }
    pub async fn _delete_code(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_code(&self.client, id).await?)
    }
    pub async fn _redeem_code(&self, code: &str, student_id: &str) -> BackendResult<RedeemResult> {
        let r = HelixDb::redeem_code(&self.client, code, student_id).await?;
        match r {
            educlaw_helix::RedeemResult::Success { tokens, new_balance } => Ok(RedeemResult::Success { tokens, new_balance }),
            educlaw_helix::RedeemResult::NotFound => Ok(RedeemResult::NotFound),
            educlaw_helix::RedeemResult::AlreadyUsed => Ok(RedeemResult::AlreadyUsed),
        }
    }
    pub async fn _export_codes(&self, tokens: i64) -> BackendResult<Vec<TokenCode>> {
        let c = HelixDb::export_codes(&self.client, tokens).await?;
        Ok(c.into_iter().map(helix_token_code_to_local).collect())
    }
}
