use crate::db::{BackendResult, SqliteBackend, Cohort};

impl SqliteBackend {
    pub async fn _get_cohort(&self, id: &str) -> BackendResult<Option<Cohort>> {
        Ok(crate::db::cohorts::get_cohort(&self.pool, id).await?)
    }
    pub async fn _list_cohorts(&self) -> BackendResult<Vec<Cohort>> {
        Ok(crate::db::cohorts::list_cohorts(&self.pool).await?)
    }
    pub async fn _insert_cohort(&self, cohort: &Cohort) -> BackendResult<()> {
        Ok(crate::db::cohorts::insert_cohort(&self.pool, cohort).await?)
    }
    pub async fn _rename_cohort(&self, old_id: &str, new_id: &str, new_title: &str) -> BackendResult<()> {
        Ok(crate::db::cohorts::rename_cohort(&self.pool, old_id, new_id, new_title).await?)
    }
    pub async fn _update_cohort_title(&self, id: &str, new_title: &str) -> BackendResult<()> {
        Ok(crate::db::cohorts::update_cohort_title(&self.pool, id, new_title).await?)
    }
    pub async fn _delete_cohort(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::cohorts::delete_cohort(&self.pool, id).await?)
    }
}
