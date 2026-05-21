use crate::client::QueryParams;
use crate::error::Result;
use crate::types::*;
use super::extract::{extract_array, extract_optional, extract_i64};

impl crate::client::HelixClient {
    pub async fn _get_session(&self, id: &str) -> Result<Option<Session>> {
        let resp = self.read("get_session", QueryParams::new().add("session_id", id)).await?;
        extract_optional(&resp, "session")
    }

    pub async fn _list_active_sessions(&self) -> Result<Vec<Session>> {
        let resp = self.read("list_active_sessions", QueryParams::new()).await?;
        extract_array(&resp, "sessions")
    }

    pub async fn _insert_session(&self, session: &Session) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.write("insert_session", QueryParams::new()
            .add("id", session.id.as_str())
            .add("student_id", session.student_id.as_str())
            .add("state", session.state.as_str())
            .add("overlay_mount", session.overlay_mount.as_str())
            .add("model", session.model.as_deref().unwrap_or(""))
            .add("created_at", now)).await?;
        Ok(())
    }

    pub async fn _set_session_model(&self, id: &str, model: &str) -> Result<()> {
        self.write("set_session_model", QueryParams::new().add("session_id", id).add("model", model)).await?;
        Ok(())
    }

    pub async fn _set_session_state(&self, id: &str, state: &str) -> Result<()> {
        self.write("set_session_state", QueryParams::new().add("session_id", id).add("state", state)).await?;
        Ok(())
    }

    pub async fn _set_namespace_pid(&self, id: &str, pid: i64) -> Result<()> {
        self.write("set_namespace_pid", QueryParams::new().add("session_id", id).add("pid", pid)).await?;
        Ok(())
    }

    pub async fn _touch_last_input(&self, id: &str) -> Result<()> {
        self.write("touch_last_input", QueryParams::new().add("session_id", id)).await?;
        Ok(())
    }

    pub async fn _get_last_token_checkpoint(&self, id: &str) -> Result<i64> {
        let resp = self.read("get_last_token_checkpoint", QueryParams::new().add("session_id", id)).await?;
        extract_i64(&resp, "checkpoint")
    }

    pub async fn _update_last_token_checkpoint(&self, id: &str, checkpoint: i64) -> Result<()> {
        self.write("update_last_token_checkpoint", QueryParams::new().add("session_id", id).add("checkpoint", checkpoint)).await?;
        Ok(())
    }
}
