use crate::db::{BackendResult, HelixBackend, Student};
use educlaw_helix::DbBackend as HelixDb;

impl HelixBackend {
    pub async fn _get_student(&self, id: &str) -> BackendResult<Option<Student>> {
        Ok(HelixDb::get_student(&self.client, id).await?)
    }
    pub async fn _get_student_by_username(&self, username: &str) -> BackendResult<Option<Student>> {
        Ok(HelixDb::get_student_by_username(&self.client, username).await?)
    }
    pub async fn _list_students(&self) -> BackendResult<Vec<Student>> {
        Ok(HelixDb::list_students(&self.client).await?)
    }
    pub async fn _insert_student(&self, student: &Student) -> BackendResult<()> {
        Ok(HelixDb::insert_student(&self.client, student).await?)
    }
    pub async fn _touch_last_seen(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::touch_last_seen(&self.client, id).await?)
    }
    pub async fn _update_display_name(&self, id: &str, display_name: &str) -> BackendResult<()> {
        Ok(HelixDb::update_display_name(&self.client, id, display_name).await?)
    }
    pub async fn _update_cohort(&self, id: &str, cohort_id: &str) -> BackendResult<()> {
        Ok(HelixDb::update_cohort(&self.client, id, cohort_id).await?)
    }
    pub async fn _update_password(&self, id: &str, password_hash: &str) -> BackendResult<()> {
        Ok(HelixDb::update_password(&self.client, id, password_hash).await?)
    }
    pub async fn _delete_student(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_student(&self.client, id).await?)
    }
    pub async fn _set_uid_slot(&self, id: &str, slot: Option<i64>) -> BackendResult<()> {
        Ok(HelixDb::set_uid_slot(&self.client, id, slot).await?)
    }
    pub async fn _ban_student(&self, id: &str, message: Option<&str>) -> BackendResult<()> {
        Ok(HelixDb::ban_student(&self.client, id, message).await?)
    }
    pub async fn _unban_student(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::unban_student(&self.client, id).await?)
    }
    pub async fn _set_last_model(&self, id: &str, model: &str) -> BackendResult<()> {
        Ok(HelixDb::set_last_model(&self.client, id, model).await?)
    }
    pub async fn _set_recent_thread_id(&self, id: &str, thread_id: &str) -> BackendResult<()> {
        Ok(HelixDb::set_recent_thread_id(&self.client, id, thread_id).await?)
    }
    pub async fn _get_recent_thread_id(&self, id: &str) -> BackendResult<Option<String>> {
        Ok(HelixDb::get_recent_thread_id(&self.client, id).await?)
    }
    pub async fn _get_token_balance(&self, id: &str) -> BackendResult<i64> {
        Ok(HelixDb::get_token_balance(&self.client, id).await?)
    }
    pub async fn _deduct_tokens(&self, id: &str, amount: i64) -> BackendResult<i64> {
        Ok(HelixDb::deduct_tokens(&self.client, id, amount).await?)
    }
    pub async fn _topup_tokens(&self, id: &str, amount: i64) -> BackendResult<i64> {
        Ok(HelixDb::topup_tokens(&self.client, id, amount).await?)
    }
}
