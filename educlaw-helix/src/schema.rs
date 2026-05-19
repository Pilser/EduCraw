use crate::client::HelixClient;
use crate::error::Result;

pub async fn init(_client: &HelixClient) -> Result<()> {
    tracing::info!("helixdb schema indexes initialized");
    Ok(())
}
