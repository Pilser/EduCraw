use crate::client::HelixClient;
use crate::error::Result;

async fn create_index(client: &HelixClient, name: &str, label: &str, property: &str, unique: bool) -> Result<()> {
    client
        .raw_query(serde_json::json!({
            "request_type": "write",
            "query": {
                "queries": [{
                    "Query": {
                        "name": name,
                        "steps": [{
                            "CreateIndex": {
                                "spec": {
                                    "NodeEquality": {
                                        "label": label,
                                        "property": property,
                                        "unique": unique
                                    }
                                },
                                "if_not_exists": true
                            }
                        }],
                        "condition": null
                    }
                }],
                "returns": [name]
            }
        }))
        .await?;
    Ok(())
}

pub async fn init(client: &HelixClient) -> Result<()> {
    // Equality indexes for direct ID lookups — without these every query
    // scans all nodes of the label then filters by property.
    create_index(client, "idx_session_id", "Session", "id", true).await?;
    create_index(client, "idx_student_id", "Student", "id", true).await?;
    create_index(client, "idx_ipam_subnet", "IpamReservation", "subnet", false).await?;

    tracing::info!("helixdb schema indexes initialized");
    Ok(())
}
