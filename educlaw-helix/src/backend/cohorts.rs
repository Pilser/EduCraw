use crate::client::QueryParams;
use crate::error::Result;
use crate::types::*;
use super::extract::{extract_array, extract_optional};

impl crate::client::HelixClient {
    pub async fn _get_cohort(&self, id: &str) -> Result<Option<Cohort>> {
        let resp = self.read("get_cohort", QueryParams::new().add("id", id)).await?;
        extract_optional(&resp, "cohort")
    }

    pub async fn _list_cohorts(&self) -> Result<Vec<Cohort>> {
        let resp = self.read("list_cohorts", QueryParams::new()).await?;
        extract_array(&resp, "cohorts")
    }

    pub async fn _insert_cohort(&self, cohort: &Cohort) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.write("insert_cohort", QueryParams::new()
            .add("id", cohort.id.as_str())
            .add("title", cohort.title.as_str())
            .add("created_at", now)).await?;
        Ok(())
    }

    pub async fn _rename_cohort(&self, old_id: &str, new_id: &str, new_title: &str) -> Result<()> {
        self.write("rename_cohort", QueryParams::new()
            .add("old_id", old_id)
            .add("new_id", new_id)
            .add("new_title", new_title)).await?;
        Ok(())
    }

    pub async fn _update_cohort_title(&self, id: &str, new_title: &str) -> Result<()> {
        self.write("update_cohort_title", QueryParams::new().add("id", id).add("new_title", new_title)).await?;
        Ok(())
    }

    pub async fn _delete_cohort(&self, id: &str) -> Result<()> {
        self.write("delete_cohort", QueryParams::new().add("id", id)).await?;
        Ok(())
    }
}
