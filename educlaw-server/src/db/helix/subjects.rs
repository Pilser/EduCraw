use crate::db::{BackendResult, HelixBackend, Subject};
use educlaw_helix::DbBackend as HelixDb;
use super::conv::*;

impl HelixBackend {
    pub async fn _get_subject(&self, id: &str) -> BackendResult<Option<Subject>> {
        Ok(HelixDb::get_subject(&self.client, id).await?.map(helix_subject_to_local))
    }
    pub async fn _get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> BackendResult<Option<Subject>> {
        Ok(HelixDb::get_subject_by_slug(&self.client, cohort_id, slug).await?.map(helix_subject_to_local))
    }
    pub async fn _list_subjects(&self, cohort_id: &str) -> BackendResult<Vec<Subject>> {
        let s = HelixDb::list_subjects(&self.client, cohort_id).await?;
        Ok(s.into_iter().map(helix_subject_to_local).collect())
    }
    pub async fn _insert_subject(&self, subject: &Subject) -> BackendResult<()> {
        let h = local_subject_to_helix(subject);
        Ok(HelixDb::insert_subject(&self.client, &h).await?)
    }
    pub async fn _update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> BackendResult<()> {
        Ok(HelixDb::update_subject(&self.client, id, new_slug, new_title).await?)
    }
    pub async fn _delete_subject(&self, id: &str) -> BackendResult<()> {
        Ok(HelixDb::delete_subject(&self.client, id).await?)
    }
}
