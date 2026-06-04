// acp_bridge/mod.rs
//
// ACP bridge between the browser (SSE) and `goose acp` (stdio SACP).
//
// Module layout:
//   client        — sacp client bootstrap (connect, init, create session)
//   commands      — ACP command handlers (list_sessions, load_session, fork_session)
//   images        — parse base64 images from frontend, create ImageContent blocks
//   model_poller  — background task: polls pending_model.txt → SetSessionModelRequest
//   notifications — SessionNotification → SSE frames + DB token accounting
//   permissions   — auto-approve tool permission requests from goose
//   session       — SSE session orchestrator (init, input, replay, cancel)

mod client;
mod commands;
mod custom_requests;
mod images;
mod model_poller;
mod notifications;
mod permissions;
mod session;
mod token_calculator;

pub use commands::{
    handle_apply_recipe_to_session, handle_create_recipe, handle_delete_recipe,
    handle_delete_session, handle_export_recipe, handle_export_session, handle_fork_session,
    handle_generate_from_session, handle_import_recipe, handle_import_session,
    handle_list_recipes, handle_list_sessions, handle_load_session, handle_read_recipe,
    ForkSessionResult, SessionListItem,
};

pub use custom_requests::{ActivityTriggerDto, DiscoverErrorDto, ImportSessionResponse};

pub use session::{
    handle_cancel, handle_input_sse, handle_replay_sse, init_acp_session,
    SseEvent, SseEventStream,
};
