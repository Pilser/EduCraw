use crate::db::{BackendResult, HelixBackend, Session};
use educlaw_helix::DbBackend as HelixDb;
use super::conv::*;

impl HelixBackend {
    pub async fn _get_session(&self, id: &str) -> BackendResult<Option<Session>> {
        Ok(HelixDb::get_session(&self.client, id).await?.map(helix_session_to_local))
    }
    pub async fn _list_active_sessions(&self) -> BackendResult<Vec<Session>> {
        let s = HelixDb::list_active_sessions(&self.client).await?;
        Ok(s.into_iter().map(helix_session_to_local).collect())
    }
    pub async fn _insert_session(&self, session: &Session) -> BackendResult<()> {
        let h = local_session_to_helix(session);
        Ok(HelixDb::insert_session(&self.client, &h).await?)
    }
    pub async fn _set_session_model(&self, id: &str, model: &str) -> BackendResult<()> {
        Ok(HelixDb::set_session_model(&self.client, id, model).await?)
    }
    pub async fn _set_session_state(&self, id: &str, state: &str) -> BackendResult<()> {
        Ok(HelixDb::set_session_state(&self.client, id, state).await?)
    }
    pub async fn _set_namespace_pid(&self, id: &str, pid: i64) -> BackendResult<()> {
        Ok(HelixDb::set_namespace_pid(&self.client, id, pid).await?)
    }
    pub async fn _touch_last_input(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::touch_last_input(&self.client, id).await?)
    }
    pub async fn _get_last_token_checkpoint(&self, id: &str) -> BackendResult<i64> {
        Ok(HelixDb::get_last_token_checkpoint(&self.client, id).await?)
    }
    pub async fn _update_last_token_checkpoint(&self, id: &str, checkpoint: i64) -> BackendResult<()> {
        Ok(HelixDb::update_last_token_checkpoint(&self.client, id, checkpoint).await?)
    }
}
