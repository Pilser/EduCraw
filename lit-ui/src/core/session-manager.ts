import type { LoginResponse } from "./edu-types";

const AUTH_STORAGE_KEY = "educlaw_auth";
const SESSION_STORAGE_KEY = "educlaw_session";
const THREAD_STORAGE_KEY = "educlaw_last_thread";

interface StoredAuth extends LoginResponse {}

interface StoredSession {
  session_id: string;
  session_token: string;
}

interface StoredThread {
  thread_id: string;
  session_id: string; // Associate thread with session
}

export class SessionManager {
  /** Save auth to localStorage */
  static saveAuth(auth: LoginResponse): void {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
    } catch {
      // localStorage might be unavailable
    }
  }

  /** Load auth from localStorage */
  static loadAuth(): StoredAuth | null {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      return stored ? (JSON.parse(stored) as StoredAuth) : null;
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
  }

  /** Clear all stored auth and session data */
  static clearAuth(): void {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(THREAD_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }

  /** Save session ID and session-scoped WS token */
  static saveSession(sessionId: string, sessionToken: string): void {
    try {
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ session_id: sessionId, session_token: sessionToken }),
      );
    } catch {
      // Ignore
    }
  }

  /** Alias for saveSession */
  static storeSession(sessionId: string, sessionToken: string): void {
    this.saveSession(sessionId, sessionToken);
  }

  /** Load session ID */
  static loadSessionId(): string | null {
    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      return stored ? (JSON.parse(stored) as StoredSession).session_id : null;
    } catch {
      return null;
    }
  }

  /** Load session-scoped WS token */
  static loadSessionToken(): string | null {
    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      return stored
        ? (JSON.parse(stored) as StoredSession).session_token
        : null;
    } catch {
      return null;
    }
  }

  /** Check if user is authenticated */
  static isAuthenticated(): boolean {
    return this.loadAuth() !== null;
  }

  /**
   * Validate session by attempting to create a new session
   * This matches educlaw-web's approach and detects expired tokens
   */
  static async validateSession(
    studentId: string,
    token: string,
  ): Promise<boolean> {
    try {
      const res = await fetch("/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ student_id: studentId }),
      });

      if (res.status === 401 || res.status === 403) {
        console.warn("[SessionManager] Token expired or unauthorized");
        return false;
      }

      if (!res.ok) {
        console.warn("[SessionManager] Validation failed:", res.status);
        return false;
      }

      return true;
    } catch (err) {
      console.error("[SessionManager] Validation error:", err);
      return false;
    }
  }

  /** Mark session as expired and clear storage */
  static markSessionExpired(): void {
    console.warn("[SessionManager] Session expired - clearing storage");
    this.clearAuth();
  }

  /** Save last loaded thread ID (Goose session) */
  static saveLastThreadId(threadId: string, sessionId: string): void {
    try {
      localStorage.setItem(
        THREAD_STORAGE_KEY,
        JSON.stringify({ thread_id: threadId, session_id: sessionId }),
      );
    } catch {
      // Ignore
    }
  }

  /** Load last loaded thread ID for current session */
  static loadLastThreadId(sessionId: string): string | null {
    try {
      const stored = localStorage.getItem(THREAD_STORAGE_KEY);
      if (!stored) return null;
      const data = JSON.parse(stored) as StoredThread;
      // Only return if it matches current session
      return data.session_id === sessionId ? data.thread_id : null;
    } catch {
      return null;
    }
  }
}
