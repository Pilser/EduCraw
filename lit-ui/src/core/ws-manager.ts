import type { SessionManager } from "./session-manager";

export type WsStatus = "connecting" | "connected" | "disconnected" | "error";

interface WsMessage {
  type: string;
  [key: string]: unknown;
}

interface WsManagerOptions {
  sessionId: string;
  token: string;
  onMessage?: (message: any) => void;
  onStatusChange?: (status: WsStatus) => void;
  onError?: (error: Error) => void;
  onReconnected?: () => void; // Called when reconnection succeeds within 5-min window
}

/**
 * Persistent WebSocket manager for lit-ui
 * Keeps connection alive and auto-reconnects on disconnect
 * (like educlaw-web's useWebSocket)
 */
export class WsManager {
  private static instances = new Map<string, WsManager>();

  private ws: WebSocket | null = null;
  private status: WsStatus = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isMounted = true;
  private reconnectKey = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private readonly maxReconnectTime = 5 * 60 * 1000; // 5 minutes
  private readonly heartbeatInterval = 30 * 1000; // 30 seconds
  private readonly sessionId: string;
  private readonly token: string;
  private onMessage?: (message: any) => void;
  private onStatusChange?: (status: WsStatus) => void;
  private onError?: (error: Error) => void;
  private onReconnected?: () => void;

  private constructor(options: WsManagerOptions) {
    this.sessionId = options.sessionId;
    this.token = options.token;
    this.onMessage = options.onMessage;
    this.onStatusChange = options.onStatusChange;
    this.onError = options.onError;
    this.onReconnected = options.onReconnected;
  }

  /** Get or create WsManager instance for a session */
  static getInstance(options: WsManagerOptions): WsManager {
    const key = `${options.sessionId}:${options.token}`;
    if (!this.instances.has(key)) {
      // Clean up any stale instances for the same sessionId with different tokens
      this.cleanupStaleInstances(options.sessionId);
      
      const manager = new WsManager(options);
      this.instances.set(key, manager);
      manager.connect();
    } else {
      // Update callbacks on existing instance
      const manager = this.instances.get(key)!;
      manager.updateCallbacks(options);
    }
    return this.instances.get(key)!;
  }

  /** Remove stale WsManager instances for a sessionId (different tokens) */
  private static cleanupStaleInstances(sessionId: string) {
    const keysToRemove: string[] = [];
    for (const [key, manager] of this.instances) {
      if (key.startsWith(`${sessionId}:`) && manager.isMounted === false) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      this.instances.delete(key);
    }
  }

  /** Update session ID and token on an existing instance (for session refresh) */
  updateSession(sessionId: string, token: string): void {
    const oldKey = `${this.sessionId}:${this.token}`;
    const newKey = `${sessionId}:${token}`;
    
    if (oldKey === newKey) return; // No change
    
    // Update internal state
    (this as any).sessionId = sessionId;
    (this as any).token = token;
    
    // Re-register under new key
    WsManager.instances.delete(oldKey);
    WsManager.instances.set(newKey, this);
    
    // Reconnect with new session
    this.reconnectAttempts = 0;
    this.connect();
  }

  /** Get existing WsManager instance (without creating) */
  static getExistingInstance(
    sessionId: string,
    token: string,
  ): WsManager | null {
    const key = `${sessionId}:${token}`;
    return this.instances.get(key) || null;
  }

  /** Update callbacks on existing instance (useful for reconnection handlers) */
  updateCallbacks(options: Partial<WsManagerOptions>): void {
    if (options.onMessage !== undefined) this.onMessage = options.onMessage;
    if (options.onStatusChange !== undefined)
      this.onStatusChange = options.onStatusChange;
    if (options.onError !== undefined) this.onError = options.onError;
    if (options.onReconnected !== undefined)
      this.onReconnected = options.onReconnected;
  }

  /** Check if the JWT token is expired (client-side decode) */
  private isTokenExpired(): boolean {
    try {
      const parts = this.token.split('.');
      if (parts.length !== 3) return true;
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now() / 1000);
      return payload.exp < now;
    } catch {
      return true;
    }
  }

  /** Get remaining time until token expiry (in seconds), or 0 if expired/invalid */
  getTokenExpirySeconds(): number {
    try {
      const parts = this.token.split('.');
      if (parts.length !== 3) return 0;
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now() / 1000);
      return Math.max(0, payload.exp - now);
    } catch {
      return 0;
    }
  }

  /** Connect or reconnect to WebSocket */
  private connect() {
    if (this.status === "connecting" || this.status === "connected") {
      return; // Already connecting or connected
    }

    // Check token expiry before attempting connection
    if (this.isTokenExpired()) {
      console.warn("[WsManager] Token is expired - not connecting");
      this.setStatus("error");
      if (this.onError) {
        this.onError(new Error("Token expired"));
      }
      return;
    }

    this.setStatus("connecting");
    const wsBase =
      import.meta.env.VITE_WS_TARGET ||
      `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    const wsUrl = `${wsBase}/sessions/${this.sessionId}/ws?token=${encodeURIComponent(this.token)}`;

    console.log(`[WsManager] Connecting to ${this.sessionId}...`);

    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      console.log(`[WsManager] Connected to session ${this.sessionId}`);
      const wasReconnecting = this.reconnectAttempts > 0;
      this.setStatus("connected");
      this.reconnectAttempts = 0; // Reset on successful connection
      
      // Start heartbeat to detect silent disconnections
      this.startHeartbeat();
      
      // Notify about successful reconnection (not initial connection)
      if (wasReconnecting && this.onReconnected) {
        console.log(`[WsManager] Reconnection successful - firing callback`);
        this.onReconnected();
      }
    };

    this.ws.onmessage = (event) => {
      if (this.onMessage) {
        try {
          if (event.data instanceof ArrayBuffer) {
            // Binary frame - pass through
            this.onMessage({ type: "binary", data: event.data });
          } else {
            // JSON frame
            const frame = JSON.parse(event.data as string);
            this.onMessage(frame);
          }
        } catch (err) {
          console.error("[WsManager] Error parsing message:", err);
        }
      }
    };

    this.ws.onerror = (err) => {
      console.error("[WsManager] WebSocket error:", err);
      // Don't set status to error here immediately - onclose will handle it
    };

    this.ws.onclose = (event) => {
      console.log(
        `[WsManager] WebSocket closed for session ${this.sessionId} - code: ${event.code}, reason: ${event.reason || "none"}`,
      );
      this.stopHeartbeat();
      this.setStatus("disconnected");

      if (!this.isMounted) return;

      // Check if close code indicates session is gone/expired
      // 1000 = Normal closure
      // 1001 = Going away
      // 1006 = Abnormal closure (network issue, server restart, proxy timeout) — NOT auth failure
      // 1008 = Policy violation (auth failure)
      // 4401 = Custom: Unauthorized
      // 4403 = Custom: Forbidden
      const isAuthOrSessionExpired =
        event.code === 1008 || // Policy violation (auth failure)
        event.code === 4401 || // Custom: Unauthorized
        event.code === 4403;   // Custom: Forbidden

      // 1006 with no prior successful connection may indicate server rejected the handshake
      // (e.g., JWT expired before WS upgrade completed). Check token to differentiate.
      const isPossibleAuthFailure = event.code === 1006 && this.reconnectAttempts === 0;

      if (isAuthOrSessionExpired) {
        console.warn(
          `[WsManager] Session expired or authentication failed (code ${event.code}) - not reconnecting`,
        );
        this.setStatus("error");
        if (this.onError) {
          // Differentiate between JWT expiry (needs re-login) and session expiry (needs new session)
          const tokenExpired = this.isTokenExpired();
          if (tokenExpired) {
            this.onError(new Error("JWT token expired"));
          } else {
            this.onError(new Error("Session expired"));
          }
        }
        return; // Don't attempt reconnection
      }

      // 1006 on first attempt: server may have rejected handshake (e.g., expired token)
      // Check token to decide whether to retry or report auth failure
      if (isPossibleAuthFailure) {
        if (this.isTokenExpired()) {
          console.warn("[WsManager] Connection failed (1006) and token is expired - not reconnecting");
          this.setStatus("error");
          if (this.onError) {
            this.onError(new Error("JWT token expired"));
          }
          return;
        }
        // Token is still valid, 1006 is likely a transient network issue — attempt reconnect
        console.log("[WsManager] Connection failed (1006) but token is valid — attempting reconnect");
      }

      // Attempt reconnection with exponential backoff (only for network issues)
      const elapsedTime = this.reconnectAttempts * 1000;
      if (elapsedTime < this.maxReconnectTime) {
        const delay = Math.min(
          1000 * Math.pow(2, this.reconnectAttempts),
          30000,
        );
        console.log(
          `[WsManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`,
        );
        this.reconnectTimer = setTimeout(() => {
          if (this.isMounted) {
            this.reconnectAttempts += 1;
            this.connect(); // Try to reconnect to the SAME session
          }
        }, delay);
      } else {
        console.log(
          `[WsManager] Max reconnection time (5 min) exceeded for session ${this.sessionId}`,
        );
        this.setStatus("error");
        if (this.onError) {
          this.onError(
            new Error("Session expired - could not reconnect within 5 minutes"),
          );
        }
      }
    };
  }

  /** Send a message over the WebSocket */
  send(message: WsMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    console.warn(
      `[WsManager] Cannot send - WebSocket not open (status: ${this.status})`,
    );
    return false;
  }

  /** Get current connection status */
  getStatus(): WsStatus {
    return this.status;
  }

  /** Check if connected */
  isConnected(): boolean {
    return this.status === "connected";
  }

  /** Wait for connection to be ready (with timeout) */
  async waitForConnection(timeoutMs: number = 10000): Promise<boolean> {
    if (this.status === "connected") {
      return true;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        console.warn(
          `[WsManager] Connection timeout after ${timeoutMs}ms - status: ${this.status}`,
        );
        resolve(false);
      }, timeoutMs);

      const checkInterval = setInterval(() => {
        if (this.status === "connected") {
          cleanup();
          resolve(true);
        } else if (this.status === "error") {
          cleanup();
          resolve(false);
        }
      }, 100);

      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(checkInterval);
      };
    });
  }

  /** Start heartbeat to detect silent disconnections */
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, this.heartbeatInterval);
  }

  /** Stop heartbeat timer */
  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Disconnect and cleanup */
  disconnect() {
    this.isMounted = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Update status and notify listeners */
  private setStatus(status: WsStatus) {
    if (this.status !== status) {
      this.status = status;
      console.log(`[WsManager] Status changed to: ${status}`);
      if (this.onStatusChange) {
        this.onStatusChange(status);
      }
    }
  }
}
