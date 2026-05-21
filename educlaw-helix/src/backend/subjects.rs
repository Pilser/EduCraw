use crate::client::QueryParams;
use crate::error::Result;
use crate::types::*;
use super::extract::{extract_array, extract_optional};

impl crate::client::HelixClient {
    pub async fn _get_subject(&self, id: &str) -> Result<Option<Subject>> {
        let resp = self.read("get_subject", QueryParams::new().add("id", id)).await?;
        extract_optional(&resp, "subject")
    }

    pub async fn _get_subject_by_slug(&self, cohort_id: &str, slug: &str) -> Result<Option<Subject>> {
        let resp = self.read("get_subject_by_slug", QueryParams::new().add("cohort_id", cohort_id).add("slug", slug)).await?;
        extract_optional(&resp, "subject")
    }

    pub async fn _list_subjects(&self, cohort_id: &str) -> Result<Vec<Subject>> {
        let resp = self.read("list_subjects", QueryParams::new().add("cohort_id", cohort_id)).await?;
        extract_array(&resp, "subjects")
    }

    pub async fn _insert_subject(&self, subject: &Subject) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.write("insert_subject", QueryParams::new()
            .add("id", subject.id.as_str())
            .add("cohort_id", subject.cohort_id.as_str())
            .add("slug", subject.slug.as_str())
            .add("title", subject.title.as_str())
            .add("created_at", now)).await?;
        Ok(())
    }

    pub async fn _update_subject(&self, id: &str, new_slug: &str, new_title: &str) -> Result<()> {
        self.write("update_subject", QueryParams::new().add("id", id).add("new_slug", new_slug).add("new_title", new_title)).await?;
        Ok(())
    }

    pub async fn _delete_subject(&self, id: &str) -> Result<()> {
        self.write("delete_subject", QueryParams::new().add("id", id)).await?;
        Ok(())
    }
}
