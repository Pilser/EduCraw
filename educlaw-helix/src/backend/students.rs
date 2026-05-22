use crate::client::QueryParams;
use crate::error::{HelixError, Result};
use crate::types::*;
use super::extract::{extract_array, extract_optional};

impl crate::client::HelixClient {
    pub async fn _get_student(&self, id: &str) -> Result<Option<Student>> {
        let resp = self.read("get_student", QueryParams::new().add("student_id", id)).await?;
        extract_optional(&resp, "student")
    }

    pub async fn _get_student_by_username(&self, username: &str) -> Result<Option<Student>> {
        let resp = self.read("get_student_by_username", QueryParams::new().add("username", username)).await?;
        extract_optional(&resp, "student")
    }

    pub async fn _list_students(&self) -> Result<Vec<Student>> {
        let resp = self.read("list_students", QueryParams::new()).await?;
        extract_array(&resp, "students")
    }

    pub async fn _insert_student(&self, student: &Student) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.write("insert_student", QueryParams::new()
            .add("id", student.id.as_str())
            .add("username", student.username.as_str())
            .add("password_hash", student.password_hash.as_str())
            .add("display_name", student.display_name.as_str())
            .add("role", student.role.as_str())
            .add("cohort_id", student.cohort_id.as_str())
            .add("uid_slot", student.uid_slot.unwrap_or(0))
            .add("home_dir", student.home_dir.as_deref().unwrap_or(""))
            .add("token_limit", student.token_limit.unwrap_or(0))
            .add("created_at", now)).await?;
        Ok(())
    }

    pub async fn _touch_last_seen(&self, id: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.write("touch_last_seen", QueryParams::new().add("student_id", id).add("last_seen", now)).await?;
        Ok(())
    }

    pub async fn _update_display_name(&self, id: &str, display_name: &str) -> Result<()> {
        self.write("update_display_name", QueryParams::new().add("student_id", id).add("display_name", display_name)).await?;
        Ok(())
    }

    pub async fn _update_cohort(&self, id: &str, cohort_id: &str) -> Result<()> {
        self.write("update_cohort", QueryParams::new().add("student_id", id).add("cohort_id", cohort_id)).await?;
        Ok(())
    }

    pub async fn _update_password(&self, id: &str, password_hash: &str) -> Result<()> {
        self.write("update_password", QueryParams::new().add("student_id", id).add("password_hash", password_hash)).await?;
        Ok(())
    }

    pub async fn _delete_student(&self, id: &str) -> Result<()> {
        self.write("delete_student", QueryParams::new().add("student_id", id)).await?;
        Ok(())
    }

    pub async fn _set_uid_slot(&self, id: &str, slot: Option<i64>) -> Result<()> {
        self.write("set_uid_slot", QueryParams::new().add("student_id", id).add("uid_slot", slot.unwrap_or(0))).await?;
        Ok(())
    }

    pub async fn _ban_student(&self, id: &str, message: Option<&str>) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.write("ban_student", QueryParams::new().add("student_id", id).add("message", message.unwrap_or("")).add("restriction_status", now)).await?;
        Ok(())
    }

    pub async fn _unban_student(&self, id: &str) -> Result<()> {
        self.write("unban_student", QueryParams::new().add("student_id", id)).await?;
        Ok(())
    }

    pub async fn _set_last_model(&self, id: &str, model: &str) -> Result<()> {
        self.write("set_last_model", QueryParams::new().add("student_id", id).add("model", model)).await?;
        Ok(())
    }

    pub async fn _get_token_balance(&self, id: &str) -> Result<i64> {
        let resp = self.read("get_token_balance", QueryParams::new().add("student_id", id)).await?;
        resp.get("student").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).and_then(|arr| arr.first()).and_then(|v| v.get("token_balance")).and_then(|v| v.as_i64())
            .ok_or_else(|| HelixError::ParseError("missing token_balance in response".into()))
    }

    pub async fn _deduct_tokens(&self, id: &str, amount: i64) -> Result<i64> {
        let resp = self.write("deduct_tokens", QueryParams::new().add("student_id", id).add("amount", amount)).await?;
        resp.get("student").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).and_then(|arr| arr.first()).and_then(|v| v.get("token_balance")).and_then(|v| v.as_i64())
            .ok_or_else(|| HelixError::ParseError("missing new_balance in deduct response".into()))
    }

    pub async fn _topup_tokens(&self, id: &str, amount: i64) -> Result<i64> {
        let resp = self.write("topup_tokens", QueryParams::new().add("student_id", id).add("amount", amount)).await?;
        resp.get("student").and_then(|v| v.get("properties")).and_then(|v| v.as_array()).and_then(|arr| arr.first()).and_then(|v| v.get("token_balance")).and_then(|v| v.as_i64())
            .ok_or_else(|| HelixError::ParseError("missing new_balance in topup response".into()))
    }
}
