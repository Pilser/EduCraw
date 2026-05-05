// acp_bridge/mod.rs
//
// ACP bridge between the browser WebSocket and `goose acp` (stdio SACP).
//
// Module layout:
//   client        — sacp client bootstrap (connect, init, create session)
//   commands      — ACP command handlers (list_sessions, load_session, fork_session)
//   images        — parse base64 images from frontend, create ImageContent blocks
//   messages      — ClientMessage enum (browser → server WS messages)
//   model_poller  — background task: polls pending_model.txt → SetSessionModelRequest
//   notifications — SessionNotification → WS frames + DB token accounting
//   permissions   — auto-approve tool permission requests from goose
//   session       — run_acp_session: top-level orchestrator

mod client;
mod commands;
mod images;
mod messages;
mod model_poller;
mod notifications;
// pub mod stats;  // Deferred: tables to be planned later
mod permissions;
mod session;

pub use commands::{
    handle_fork_session, handle_list_sessions, handle_load_session, ControlMessage, ForkSessionResult,
    SessionListItem,
};

pub use session::run_acp_session;
