use crate::db::{BackendResult, SqliteBackend, Subject};

impl SqliteBackend {
    pub async fn _get_subject(&self, id: &str) -> BackendResult<Option<Subject>> {
        Ok(crate::db::subjects::get_subject(&self.pool, id).await?)
    }
    pub async fn _get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> BackendResult<Option<Subject>> {
        Ok(crate::db::subjects::get_subject_by_slug(&self.pool, cohort_id, slug).await?)
    }
    pub async fn _list_subjects(&self, cohort_id: &str) -> BackendResult<Vec<Subject>> {
        Ok(crate::db::subjects::list_subjects(&self.pool, cohort_id).await?)
    }
    pub async fn _insert_subject(&self, subject: &Subject) -> BackendResult<()> {
        Ok(crate::db::subjects::insert_subject(&self.pool, subject).await?)
    }
    pub async fn _update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> BackendResult<()> {
        Ok(crate::db::subjects::update_subject(&self.pool, id, new_slug, new_title).await?)
    }
    pub async fn _delete_subject(&self, id: &str) -> BackendResult<()> {
        Ok(crate::db::subjects::delete_subject(&self.pool, id).await?)
    }
}
