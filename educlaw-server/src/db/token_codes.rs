// educlaw-server/src/db/token_codes.rs

use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct TokenCode {
    pub id: String,
    pub code: String,
    pub tokens: i64,
    pub used_by: Option<String>,
    pub used_at: Option<String>,
    pub created_at: String,
}

fn generate_code() -> String {
    let raw = Uuid::new_v4().to_string().replace('-', "").to_uppercase();
    format!(
        "EDU-{}-{}-{}",
        &raw[0..4],
        &raw[4..8],
        &raw[8..12]
    )
}

pub async fn generate_codes(
    pool: &SqlitePool,
    tokens: i64,
    count: i64,
) -> Result<Vec<String>, sqlx::Error> {
    let mut codes = Vec::new();
    for _ in 0..count {
        let id = Uuid::new_v4().to_string();
        let code = generate_code();
        sqlx::query("INSERT INTO token_codes (id, code, tokens) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(&code)
            .bind(tokens)
            .execute(pool)
            .await?;
        codes.push(code);
    }
    Ok(codes)
}

pub async fn list_codes(
    pool: &SqlitePool,
    tokens: Option<i64>,
    used: Option<bool>,
) -> Result<Vec<TokenCode>, sqlx::Error> {
    let mut query = String::from("SELECT * FROM token_codes WHERE 1=1");
    if tokens.is_some() {
        query.push_str(" AND tokens = ?");
    }
    if let Some(u) = used {
        if u {
            query.push_str(" AND used_by IS NOT NULL");
        } else {
            query.push_str(" AND used_by IS NULL");
        }
    }
    query.push_str(" ORDER BY created_at DESC LIMIT 500");

    let mut q = sqlx::query_as::<_, TokenCode>(&query);
    if let Some(t) = tokens {
        q = q.bind(t);
    }
    q.fetch_all(pool).await
}

pub async fn delete_code(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM token_codes WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Debug)]
pub enum RedeemResult {
    Success { tokens: i64, new_balance: i64 },
    NotFound,
    AlreadyUsed,
}

pub async fn redeem_code(
    pool: &SqlitePool,
    code: &str,
    student_id: &str,
) -> Result<RedeemResult, sqlx::Error> {
    let row = sqlx::query_as::<_, TokenCode>(
        "SELECT * FROM token_codes WHERE code = ?",
    )
    .bind(code)
    .fetch_optional(pool)
    .await?;

    let tc = match row {
        Some(r) if r.used_by.is_none() => r,
        Some(_) => return Ok(RedeemResult::AlreadyUsed),
        None => return Ok(RedeemResult::NotFound),
    };

    sqlx::query(
        "UPDATE token_codes SET used_by = ?, used_at = datetime('now') WHERE id = ?",
    )
    .bind(student_id)
    .bind(&tc.id)
    .execute(pool)
    .await?;

    sqlx::query("UPDATE students SET token_balance = token_balance + ? WHERE id = ?")
        .bind(tc.tokens)
        .bind(student_id)
        .execute(pool)
        .await?;

    let new_balance = crate::db::students::get_token_balance(pool, student_id).await?;

    Ok(RedeemResult::Success {
        tokens: tc.tokens,
        new_balance,
    })
}

pub async fn export_codes(
    pool: &SqlitePool,
    tokens: i64,
) -> Result<Vec<TokenCode>, sqlx::Error> {
    sqlx::query_as::<_, TokenCode>(
        "SELECT * FROM token_codes WHERE tokens = ? ORDER BY created_at ASC",
    )
    .bind(tokens)
    .fetch_all(pool)
    .await
}
