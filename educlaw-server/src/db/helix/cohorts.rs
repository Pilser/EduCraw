use crate::db::{BackendResult, HelixBackend, Cohort};
use educlaw_helix::DbBackend as HelixDb;

impl HelixBackend {
    pub async fn _get_cohort(&self, id: &str) -> BackendResult<Option<Cohort>> {
        Ok(HelixDb::get_cohort(&self.client, id).await?)
    }
    pub async fn _list_cohorts(&self) -> BackendResult<Vec<Cohort>> {
        Ok(HelixDb::list_cohorts(&self.client).await?)
    }
    pub async fn _insert_cohort(&self, cohort: &Cohort) -> BackendResult<()> {
        Ok(HelixDb::insert_cohort(&self.client, cohort).await?)
    }
    pub async fn _rename_cohort(&self, old_id: &str, new_id: &str, new_title: &str) -> BackendResult<()> {
        Ok(HelixDb::rename_cohort(&self.client, old_id, new_id, new_title).await?)
    }
    pub async fn _update_cohort_title(&self, id: &str, new_title: &str) -> BackendResult<()> {
        Ok(HelixDb::update_cohort_title(&self.client, id, new_title).await?)
    }
    pub async fn _delete_cohort(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_cohort(&self.client, id).await?)
    }
}
