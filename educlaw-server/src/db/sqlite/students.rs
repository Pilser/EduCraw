use crate::db::{BackendResult, SqliteBackend, Student};

impl SqliteBackend {
    pub async fn _get_student(&self, id: &str) -> BackendResult<Option<Student>> {
        Ok(crate::db::students::get_student(&self.pool, id).await?)
    }
    pub async fn _get_student_by_username(&self, username: &str) -> BackendResult<Option<Student>> {
        Ok(crate::db::students::get_student_by_username(&self.pool, username).await?)
    }
    pub async fn _list_students(&self) -> BackendResult<Vec<Student>> {
        Ok(crate::db::students::list_students(&self.pool).await?)
    }
    pub async fn _insert_student(&self, student: &Student) -> BackendResult<()> {
        Ok(crate::db::students::insert_student(&self.pool, student).await?)
    }
    pub async fn _touch_last_seen(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::students::touch_last_seen(&self.pool, id).await?)
    }
    pub async fn _update_display_name(&self, id: &str, display_name: &str) -> BackendResult<()> {
        Ok(crate::db::students::update_student(&self.pool, id, Some(display_name), None, None).await?)
    }
    pub async fn _update_cohort(&self, id: &str, cohort_id: &str) -> BackendResult<()> {
        Ok(crate::db::students::update_student(&self.pool, id, None, Some(cohort_id), None).await?)
    }
    pub async fn _update_password(&self, id: &str, password_hash: &str) -> BackendResult<()> {
        Ok(crate::db::students::update_student(&self.pool, id, None, None, Some(password_hash)).await?)
    }
    pub async fn _delete_student(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::students::delete_student(&self.pool, id).await?)
    }
    pub async fn _set_uid_slot(&self, id: &str, slot: Option<i64>) -> BackendResult<()> {
        Ok(crate::db::students::set_uid_slot(&self.pool, id, slot).await?)
    }
    pub async fn _ban_student(&self, id: &str, message: Option<&str>) -> BackendResult<()> {
        Ok(crate::db::students::ban_student(&self.pool, id, message).await?)
    }
    pub async fn _unban_student(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::students::unban_student(&self.pool, id).await?)
    }
    pub async fn _set_last_model(&self, id: &str, model: &str) -> BackendResult<()> {
        Ok(crate::db::students::set_last_model(&self.pool, id, model).await?)
    }
    pub async fn _get_token_balance(&self, id: &str) -> BackendResult<i64> {
        Ok(crate::db::students::get_token_balance(&self.pool, id).await?)
    }
    pub async fn _deduct_tokens(&self, id: &str, amount: i64) -> BackendResult<i64> {
        Ok(crate::db::students::deduct_tokens(&self.pool, id, amount).await?)
    }
    pub async fn _topup_tokens(&self, id: &str, amount: i64) -> BackendResult<i64> {
        Ok(crate::db::students::topup_tokens(&self.pool, id, amount).await?)
    }
}
