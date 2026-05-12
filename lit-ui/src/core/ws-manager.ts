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

  private readonly maxReconnectTime = 5 * 60 * 1000; // 5 minutes
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

  /** Connect or reconnect to WebSocket */
  private connect() {
    if (this.status === "connecting" || this.status === "connected") {
      return; // Already connecting or connected
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
      this.setStatus("error");
      if (this.onError) {
        this.onError(new Error("WebSocket error"));
      }
    };

    this.ws.onclose = () => {
      console.log(`[WsManager] WebSocket closed for session ${this.sessionId}`);
      this.setStatus("disconnected");

      if (!this.isMounted) return;

      // Attempt reconnection with exponential backoff
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

  /** Disconnect and cleanup */
  disconnect() {
    this.isMounted = false;
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
