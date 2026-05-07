# Session Reconnection — Implementation Reference

## What it does
WS disconnect no longer kills goose. Session survives 5 minutes. Frontend reconnects and continues.

---

## Files Changed

### 1. `educlaw-server/src/session/registry.rs`
`ManagedSession` new fields:
- `cx: sacp::ConnectionTo<sacp::Agent>` — live SACP handle, reused on reconnect
- `child: Arc<Mutex<Option<tokio::process::Child>>>` — keeps goose process alive
- `notif_tx_shared: Arc<Mutex<Sender<...>>>` — SAME Arc held by sacp callback; swap inner Sender on reconnect to redirect notifications to new WS
- `loading_flag: Arc<AtomicBool>` — shared state for token accounting skip
- `session_config_dir: PathBuf` — needed to restart model poller on reconnect

`ManagedSession::new()` now takes `notif_tx_shared: Arc<Mutex<Sender<...>>>` (the Arc, not the raw Sender). Caller must pass the exact same Arc that was given to `spawn_sacp_client`.

### 2. `educlaw-server/src/acp_bridge/client.rs`
`spawn_sacp_client` signature change:
```
notif_tx: Arc<Mutex<mpsc::Sender<(Option<Value>, Option<Vec<u8>>)>>>
```
Callback does: `let s = tx.lock().await.clone(); s.send(frames).await`

### 3. `educlaw-server/src/acp_bridge/session.rs`
`run_acp_session` two new params at the end:
```rust
registry: Option<Arc<SessionRegistry>>,
existing_session: Option<Arc<ManagedSession>>,
```

**Fresh session path** (existing_session = None):
1. Spawns goose, creates `notif_tx_shared = Arc::new(Mutex::new(notif_tx))`
2. Passes `notif_tx_shared.clone()` to `spawn_sacp_client`
3. Registers `ManagedSession` with that same Arc in registry

**Reconnect path** (existing_session = Some):
1. `managed.clear_grace_period()`
2. `*managed.notif_tx_shared.lock().await = notif_tx_new` — redirects sacp notifications to new WS
3. Flushes buffered messages via new `ctrl_tx`
4. Restarts model poller with new `ctrl_tx`
5. Reuses `managed.cx`, `managed.acp_session_id`, `managed.model_arc`, etc.

**On WS disconnect** (end of function):
- Writer task buffers the in-flight message then breaks
- `managed.start_grace_period()`
- Spawns timeout task: after 5 min, if still in grace period → kills child, sets child slot to None
- If reconnect happened before 5 min, timeout task exits without killing

### 4. `educlaw-server/src/api/ws.rs`
Before calling `run_acp_session`, checks registry:
```
let existing = registry.get(&sid).await;
  Some + is_in_grace_period() => pass as existing_session (reconnect)
  Some + expired             => registry.remove(), pass None (fresh)
  None                       => pass None (fresh)
```
Always passes `Some(registry.clone())` as the registry param.
Does NOT remove from registry at the end — the timeout task owns cleanup.

### 5. `educlaw-server/src/main.rs`
Added background cleanup task (every 60s):
```rust
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop { interval.tick().await; registry_cleanup.cleanup_expired().await; }
});
```

---

## How the notif_tx_shared Arc swap works

```
Fresh session:
  notif_tx_shared (Arc) ──────────────────────────────┐
                          sacp callback holds clone ──►│ inner Sender → WS writer Rx
                          registry holds clone      ──►│
                                                       └─ same Arc, same Sender

On reconnect:
  *managed.notif_tx_shared.lock() = new_notif_tx  ← swaps inner Sender
  new WS writer uses new_notif_rx                 ← new channel receiver
  sacp callback still holds same Arc              ← now sends to new_notif_rx
```

---

## Known Limitations (MVP)
- Notifications generated AFTER the writer task exits but BEFORE reconnect are lost (sacp callback send fails silently). Session conversation state in goose is preserved.
- Binary frames (images) are not buffered on disconnect.
- Two model-poller instances run briefly after reconnect until the old ctrl_rx is dropped and the old poller exits naturally.

---

## Failure Scenarios & Fixes

| Symptom | Likely cause | Where to look |
|---------|-------------|---------------|
| Session still dies on disconnect | `existing_session` not found in registry | `ws.rs` registry lookup; check `registry.get()` returns correctly |
| Reconnect spawns new goose instead of reusing | Grace period already expired | Increase `Duration::from_secs(300)` in `main.rs` or check system clock |
| Notifications not showing after reconnect | `notif_tx_shared` Arc mismatch | Verify `notif_tx_shared.clone()` is passed to both `spawn_sacp_client` AND `ManagedSession::new()` |
| Child not killed after 5 min | Timeout task panicked or grace period was cleared unexpectedly | Check tracing logs for `grace period expired` message |
| Buffered messages not delivered on reconnect | `take_buffered_messages()` not called or `ctrl_tx` send fails | Reconnect path in `session.rs` around `flush buffered messages` |
| Build error on `notif_tx` type mismatch | Something passes raw `Sender` instead of `Arc<Mutex<Sender>>` | `client.rs` param and all call sites in `session.rs` |