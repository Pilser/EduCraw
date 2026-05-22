use crate::db::{BackendResult, HelixBackend, TokenCode, RedeemResult};
use educlaw_helix::DbBackend as HelixDb;

impl HelixBackend {
    pub async fn _generate_codes(&self, tokens: i64, count: i64) -> BackendResult<Vec<String>> {
        Ok(HelixDb::generate_codes(&self.client, tokens, count).await?)
    }
    pub async fn _list_codes(&self, tokens: Option<i64>, used: Option<bool>) -> BackendResult<Vec<TokenCode>> {
        Ok(HelixDb::list_codes(&self.client, tokens, used).await?)
    }
    pub async fn _delete_code(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_code(&self.client, id).await?)
    }
    pub async fn _redeem_code(&self, code: &str, student_id: &str) -> BackendResult<RedeemResult> {
        Ok(HelixDb::redeem_code(&self.client, code, student_id).await?)
    }
    pub async fn _export_codes(&self, tokens: i64) -> BackendResult<Vec<TokenCode>> {
        Ok(HelixDb::export_codes(&self.client, tokens).await?)
    }
}
