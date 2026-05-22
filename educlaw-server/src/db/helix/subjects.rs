use crate::db::{BackendResult, HelixBackend, Subject};
use educlaw_helix::DbBackend as HelixDb;

impl HelixBackend {
    pub async fn _get_subject(&self, id: &str) -> BackendResult<Option<Subject>> {
        Ok(HelixDb::get_subject(&self.client, id).await?)
    }
    pub async fn _get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> BackendResult<Option<Subject>> {
        Ok(HelixDb::get_subject_by_slug(&self.client, cohort_id, slug).await?)
    }
    pub async fn _list_subjects(&self, cohort_id: &str) -> BackendResult<Vec<Subject>> {
        Ok(HelixDb::list_subjects(&self.client, cohort_id).await?)
    }
    pub async fn _insert_subject(&self, subject: &Subject) -> BackendResult<()> {
        Ok(HelixDb::insert_subject(&self.client, subject).await?)
    }
    pub async fn _update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> BackendResult<()> {
        Ok(HelixDb::update_subject(&self.client, id, new_slug, new_title).await?)
    }
    pub async fn _delete_subject(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_subject(&self.client, id).await?)
    }
}
