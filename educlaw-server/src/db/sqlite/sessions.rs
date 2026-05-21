use crate::db::{BackendResult, SqliteBackend, Session};

impl SqliteBackend {
    pub async fn _get_session(&self, id: &str) -> BackendResult<Option<Session>> {
        Ok(crate::db::sessions::get_session(&self.pool, id).await?)
    }
    pub async fn _list_active_sessions(&self) -> BackendResult<Vec<Session>> {
        Ok(crate::db::sessions::list_active_sessions(&self.pool).await?)
    }
    pub async fn _insert_session(&self, session: &Session) -> BackendResult<()> {
        Ok(crate::db::sessions::insert_session(&self.pool, session).await?)
    }
    pub async fn _set_session_model(&self, id: &str, model: &str) -> BackendResult<()> {
        Ok(crate::db::sessions::set_session_model(&self.pool, id, model).await?)
    }
    pub async fn _set_session_state(&self, id: &str, state: &str) -> BackendResult<()> {
        Ok(crate::db::sessions::set_session_state(&self.pool, id, state).await?)
    }
    pub async fn _set_namespace_pid(&self, id: &str, pid: i64) -> BackendResult<()> {
        Ok(crate::db::sessions::set_namespace_pid(&self.pool, id, pid).await?)
    }
    pub async fn _touch_last_input(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::sessions::touch_last_input(&self.pool, id).await?)
    }
    pub async fn _get_last_token_checkpoint(&self, id: &str) -> BackendResult<i64> {
        Ok(crate::db::sessions::get_last_token_checkpoint(&self.pool, id).await?)
    }
    pub async fn _update_last_token_checkpoint(&self, id: &str, checkpoint: i64) -> BackendResult<()> {
        Ok(crate::db::sessions::update_last_token_checkpoint(&self.pool, id, checkpoint).await?)
    }
}
