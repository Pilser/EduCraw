use crate::error::Result;

impl crate::client::HelixClient {
    /// Check whether a subnet is currently claimed by any active session.
    pub async fn _check_subnet(&self, subnet: &str) -> Result<bool> {
        let resp = self
            .raw_query(serde_json::json!({
                "request_type": "read",
                "query": {
                    "queries": [{
                        "Query": {
                            "name": "check",
                            "steps": [
                                {"NWhere": {"Eq": ["$label", {"String": "IpamReservation"}]}},
                                {"Where": {"Compare": {"left": {"Property": "subnet"}, "op": "Eq", "right": {"Param": "subnet"}}}},
                                "Count"
                            ],
                            "condition": null
                        }
                    }],
                    "returns": ["check"]
                },
                "parameters": {"subnet": subnet},
                "parameter_types": {"subnet": "String"}
            }))
            .await?;

        let count = resp["check"]["count"].as_i64().unwrap_or(0);
        Ok(count > 0)
    }

    /// Claim a subnet for a session.
    ///
    /// Returns `true` on success, `false` if the subnet was already taken.
    pub async fn _claim_subnet(&self, subnet: &str, session_id: &str) -> Result<bool> {
        // 1. Check if already taken
        if self._check_subnet(subnet).await? {
            return Ok(false);
        }

        // 2. Claim
        let now = chrono::Utc::now().to_rfc3339();
        self.raw_query(serde_json::json!({
            "request_type": "write",
            "query": {
                "queries": [{
                    "Query": {
                        "name": "claim",
                        "steps": [{
                            "AddN": {
                                "label": "IpamReservation",
                                "properties": [
                                    ["subnet", {"Expr": {"Param": "subnet"}}],
                                    ["session_id", {"Expr": {"Param": "session_id"}}],
                                    ["claimed_at", {"Expr": {"Param": "claimed_at"}}]
                                ]
                            }
                        }],
                        "condition": null
                    }
                }],
                "returns": ["claim"]
            },
            "parameters": {
                "subnet": subnet,
                "session_id": session_id,
                "claimed_at": now
            },
            "parameter_types": {
                "subnet": "String",
                "session_id": "String",
                "claimed_at": "String"
            }
        }))
        .await?;

        Ok(true)
    }

    /// Release a subnet (delete the reservation node).
    pub async fn _release_subnet(&self, subnet: &str) -> Result<()> {
        self.raw_query(serde_json::json!({
            "request_type": "write",
            "query": {
                "queries": [{
                    "Query": {
                        "name": "release",
                        "steps": [
                            {"NWhere": {"Eq": ["$label", {"String": "IpamReservation"}]}},
                            {"Where": {"Compare": {"left": {"Property": "subnet"}, "op": "Eq", "right": {"Param": "subnet"}}}},
                            {"Limit": 1},
                            "Drop"
                        ],
                        "condition": null
                    }
                }],
                "returns": ["release"]
            },
            "parameters": {"subnet": subnet},
            "parameter_types": {"subnet": "String"}
        }))
        .await?;

        Ok(())
    }

    /// Release all subnets claimed by a given session (used during session cleanup).
    pub async fn _release_session_subnets(&self, session_id: &str) -> Result<()> {
        self.raw_query(serde_json::json!({
            "request_type": "write",
            "query": {
                "queries": [{
                    "Query": {
                        "name": "release_all",
                        "steps": [
                            {"NWhere": {"Eq": ["$label", {"String": "IpamReservation"}]}},
                            {"Where": {"Compare": {"left": {"Property": "session_id"}, "op": "Eq", "right": {"Param": "session_id"}}}},
                            "Drop"
                        ],
                        "condition": null
                    }
                }],
                "returns": ["release_all"]
            },
            "parameters": {"session_id": session_id},
            "parameter_types": {"session_id": "String"}
        }))
        .await?;

        Ok(())
    }
}
