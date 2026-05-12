import type { LoginResponse } from "./edu-types";

const AUTH_STORAGE_KEY = "educlaw_auth";
const SESSION_STORAGE_KEY = "educlaw_session";

interface StoredAuth extends LoginResponse {}

interface StoredSession {
  session_id: string;
  session_token: string;
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
}
