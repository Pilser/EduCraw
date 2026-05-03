// acp_bridge/permissions.rs
//
// Auto-approval of tool-permission requests from goose.
// Prefers AllowAlways, falls back to AllowOnce, otherwise cancels.

use sacp::schema::{
    PermissionOptionKind, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome,
};

pub fn auto_approve(req: &RequestPermissionRequest) -> RequestPermissionResponse {
    let opt_id = req
        .options
        .iter()
        .find(|o| o.kind == PermissionOptionKind::AllowAlways)
        .or_else(|| {
            req.options
                .iter()
                .find(|o| o.kind == PermissionOptionKind::AllowOnce)
        })
        .map(|o| o.option_id.clone());

    if let Some(id) = opt_id {
        RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new(id),
        ))
    } else {
        RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled)
    }
}
