// educlaw-server/src/session/registry.rs
//
// Session registry for managing ACP sessions independently of WebSocket connections.
// Enables reconnection with grace period and message buffering.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::db::backend::DbBackend;
use tokio::sync::mpsc::Sender;
use tokio::sync::Mutex;

/// A session that can survive multiple WebSocket connections.
/// Stored in the registry and accessed when WebSocket connects/disconnects.
pub struct ManagedSession {
    // SACP connection handle — reused on reconnect (Clone-able)
    pub cx: sacp::ConnectionTo<sacp::Agent>,

    // Goose subprocess — kept alive during grace period, killed when expired
    pub child: Arc<Mutex<Option<tokio::process::Child>>>,

    // Pid of the unshare wrapper process — used for process-group kill during cleanup
    pub pid: u32,

    // Replaceable notification sender — swapped to a new channel on each WS reconnect
    // The sacp client callback holds an Arc clone and always sends to the current Sender.
    pub notif_tx_shared: Arc<Mutex<Sender<(Option<serde_json::Value>, Option<Vec<u8>>)>>>,

    // Shared state — reused across reconnects
    pub acp_session_id: Arc<Mutex<Option<sacp::schema::SessionId>>>,
    pub model_arc: Arc<Mutex<Option<String>>>,
    pub available_models_arc: Arc<Mutex<Vec<String>>>,
    pub loading_flag: Arc<AtomicBool>,

    // Message buffer for in-flight text frames at the moment of disconnect
    pub message_buffer: Arc<Mutex<VecDeque<String>>>,

    // Grace period tracking
    pub disconnected_at: Arc<Mutex<Option<Instant>>>,
    pub disconnect_timeout: Duration,

    // Session metadata
    pub student_id: String,
    pub backend: Arc<dyn DbBackend>,

    // Path needed to restart the model-switch poller on reconnect
    pub session_config_dir: PathBuf,
}

impl ManagedSession {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        cx: sacp::ConnectionTo<sacp::Agent>,
        child: tokio::process::Child,
        pid: u32,
        // The SAME Arc that was passed to spawn_sacp_client — must be shared so
        // swapping the inner Sender on reconnect reaches the sacp callback.
        notif_tx_shared: Arc<Mutex<Sender<(Option<serde_json::Value>, Option<Vec<u8>>)>>>,
        acp_session_id: Arc<Mutex<Option<sacp::schema::SessionId>>>,
        model_arc: Arc<Mutex<Option<String>>>,
        available_models_arc: Arc<Mutex<Vec<String>>>,
        loading_flag: Arc<AtomicBool>,
        student_id: String,
        backend: Arc<dyn DbBackend>,
        disconnect_timeout: Duration,
        session_config_dir: PathBuf,
    ) -> Self {
        Self {
            cx,
            child: Arc::new(Mutex::new(Some(child))),
            pid,
            notif_tx_shared,
            acp_session_id,
            model_arc,
            available_models_arc,
            loading_flag,
            message_buffer: Arc::new(Mutex::new(VecDeque::new())),
            disconnected_at: Arc::new(Mutex::new(None)),
            disconnect_timeout,
            student_id,
            backend,
            session_config_dir,
        }
    }

    /// Check if the session is within the 5-minute grace period.
    pub async fn is_in_grace_period(&self) -> bool {
        let guard = self.disconnected_at.lock().await;
        match *guard {
            Some(instant) => instant.elapsed() < self.disconnect_timeout,
            None => false,
        }
    }

    /// Mark session as disconnected (start grace period timer).
    pub async fn start_grace_period(&self) {
        *self.disconnected_at.lock().await = Some(Instant::now());
    }

    /// Clear the grace period (called when WS reconnects).
    pub async fn clear_grace_period(&self) {
        *self.disconnected_at.lock().await = None;
    }

    /// Buffer a text message for delivery on reconnect.
    pub async fn buffer_message(&self, msg: String) {
        let mut buf = self.message_buffer.lock().await;
        buf.push_back(msg);
        if buf.len() > 1000 {
            buf.pop_front(); // cap memory usage
        }
    }

    /// Drain and return all buffered messages.
    pub async fn take_buffered_messages(&self) -> Vec<String> {
        self.message_buffer.lock().await.drain(..).collect()
    }

    /// True when the grace period has elapsed (session should be killed).
    pub async fn is_expired(&self) -> bool {
        let guard = self.disconnected_at.lock().await;
        match *guard {
            Some(instant) => instant.elapsed() >= self.disconnect_timeout,
            None => false,
        }
    }
}

/// Registry for managing active sessions keyed by educlaw session_id.
pub struct SessionRegistry {
    sessions: Mutex<HashMap<String, Arc<ManagedSession>>>,
    pub disconnect_timeout: Duration,
}

impl SessionRegistry {
    pub fn new(disconnect_timeout: Duration) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            disconnect_timeout,
        }
    }

    /// Insert a new managed session.
    pub async fn register(&self, session_id: String, session: ManagedSession) {
        self.sessions
            .lock()
            .await
            .insert(session_id, Arc::new(session));
    }

    /// Look up a session by ID.
    pub async fn get(&self, session_id: &str) -> Option<Arc<ManagedSession>> {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .map(Arc::clone)
    }

    /// Remove a session from the registry (does NOT kill the child — caller's responsibility).
    pub async fn remove(&self, session_id: &str) {
        self.sessions.lock().await.remove(session_id);
    }

    /// Periodically called to remove sessions whose grace period has expired.
    /// Note: child killing is done by the per-session timeout task in session.rs.
    pub async fn cleanup_expired(&self) {
        let mut sessions = self.sessions.lock().await;
        let expired: Vec<String> = sessions
            .iter()
            .filter_map(|(id, s)| {
                // Use try_lock to avoid blocking inside the map
                if let Ok(guard) = s.disconnected_at.try_lock() {
                    if let Some(instant) = *guard {
                        if instant.elapsed() >= s.disconnect_timeout {
                            return Some(id.clone());
                        }
                    }
                }
                None
            })
            .collect();

        for id in expired {
            sessions.remove(&id);
            tracing::info!(session_id = %id, "registry: removed expired session entry");
        }
    }
}
