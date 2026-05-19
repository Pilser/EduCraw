mod read;
mod write;

pub fn get_read(name: &str) -> crate::error::Result<&'static str> {
    read::get(name).ok_or_else(|| crate::error::HelixError::QueryNotFound(name.into()))
}

pub fn get_write(name: &str) -> crate::error::Result<&'static str> {
    write::get(name).ok_or_else(|| crate::error::HelixError::QueryNotFound(name.into()))
}

pub fn validate() -> crate::error::Result<()> {
    for name in read::ALL_NAMES {
        let template = get_read(name)?;
        serde_json::from_str::<serde_json::Value>(template)?;
    }
    for name in write::ALL_NAMES {
        let template = get_write(name)?;
        serde_json::from_str::<serde_json::Value>(template)?;
    }
    tracing::info!(
        "all {} helix queries validated",
        read::ALL_NAMES.len() + write::ALL_NAMES.len()
    );
    Ok(())
}
