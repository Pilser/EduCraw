// educlaw-server/src/session/registry.rs
//
// Session registry for managing ACP sessions independently of WebSocket connections.
// Enables reconnection with grace period and message buffering.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::db::DbBackend;
use tokio::sync::mpsc::Sender;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// State machine for a single request_id in the dedupe table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestState {
    InFlight,
    Streaming,
    Completed,
    Failed,
}

/// Per-request entry in the in-memory dedupe table.
#[derive(Debug, Clone)]
pub struct RequestDedupeEntry {
    pub state: RequestState,
    pub started_at: Instant,
    pub final_frames: Vec<String>,
    pub buffer_start_index: Option<usize>,
    pub cancel_token: CancellationToken,
}

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
    pub total_buffer_bytes: Arc<AtomicU64>,
    pub frame_counter: Arc<AtomicU64>,
    pub buffer_last_written: Arc<Mutex<Instant>>,
    pub buffer_on_disconnect_only: Arc<AtomicBool>,

    // Grace period tracking
    pub disconnected_at: Arc<Mutex<Option<Instant>>>,
    pub disconnect_timeout: Duration,

    // Session metadata
    pub student_id: String,
    pub backend: Arc<dyn DbBackend>,

    // Path needed to restart the model-switch poller on reconnect
    pub session_config_dir: PathBuf,

    // ── Request idempotency ───────────────────────────────────
    pub request_dedupe: Arc<Mutex<HashMap<String, RequestDedupeEntry>>>,
    pub request_timeout: Duration,
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
        message_buffer: Arc<Mutex<VecDeque<String>>>,
        total_buffer_bytes: Arc<AtomicU64>,
        frame_counter: Arc<AtomicU64>,
        buffer_last_written: Arc<Mutex<Instant>>,
        buffer_on_disconnect_only: Arc<AtomicBool>,
        request_dedupe: Arc<Mutex<HashMap<String, RequestDedupeEntry>>>,
        request_timeout: Duration,
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
            message_buffer,
            total_buffer_bytes,
            frame_counter,
            buffer_last_written,
            buffer_on_disconnect_only,
            disconnected_at: Arc::new(Mutex::new(None)),
            disconnect_timeout,
            student_id,
            backend,
            session_config_dir,
            request_dedupe,
            request_timeout,
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
    /// Enforces both count (10 000) and size (5 MB) caps.
    pub async fn buffer_message(&self, msg: String) {
        let mut buf = self.message_buffer.lock().await;
        self.total_buffer_bytes.fetch_add(msg.len() as u64, Ordering::Relaxed);
        buf.push_back(msg);
        *self.buffer_last_written.lock().await = Instant::now();
        // Evict oldest frames when either cap is exceeded
        while buf.len() > 10_000 || self.total_buffer_bytes.load(Ordering::Relaxed) > 5 * 1024 * 1024 {
            if let Some(oldest) = buf.pop_front() {
                self.total_buffer_bytes.fetch_sub(oldest.len() as u64, Ordering::Relaxed);
            } else {
                break;
            }
        }
    }

    /// Drain and return all buffered messages.
    pub async fn take_buffered_messages(&self) -> Vec<String> {
        let msgs = self.message_buffer.lock().await.drain(..).collect::<Vec<_>>();
        self.total_buffer_bytes.store(0, Ordering::Relaxed);
        msgs
    }

    /// Clear buffered frames without returning them.
    pub async fn clear_buffer(&self) {
        self.message_buffer.lock().await.clear();
        self.total_buffer_bytes.store(0, Ordering::Relaxed);
    }

    /// Returns true when buffered frames are older than timeout seconds.
    pub async fn is_buffer_timed_out(&self, timeout: Duration) -> bool {
        let guard = self.buffer_last_written.lock().await;
        guard.elapsed() >= timeout
    }

    /// Number of currently buffered frames.
    pub async fn buffered_len(&self) -> usize {
        self.message_buffer.lock().await.len()
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
