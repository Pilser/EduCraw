import { handleError } from "./error-handler.js";
const AUTH_STORAGE_KEY = "educlaw_auth";
const SESSION_STORAGE_KEY = "educlaw_session";
const THREAD_STORAGE_KEY = "educlaw_last_thread";
export class SessionManager {
    /** Save auth to localStorage */
    static saveAuth(auth) {
        try {
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
        }
        catch {
            // localStorage might be unavailable
        }
    }
    /** Load auth from localStorage */
    static loadAuth() {
        try {
            const stored = localStorage.getItem(AUTH_STORAGE_KEY);
            return stored ? JSON.parse(stored) : null;
        }
        catch {
            localStorage.removeItem(AUTH_STORAGE_KEY);
            return null;
        }
    }
    /** Clear all stored auth and session data */
    static clearAuth() {
        try {
            localStorage.removeItem(AUTH_STORAGE_KEY);
            localStorage.removeItem(SESSION_STORAGE_KEY);
            localStorage.removeItem(THREAD_STORAGE_KEY);
        }
        catch {
            // Ignore
        }
    }
    /** Save session ID and session-scoped WS token */
    static saveSession(sessionId, sessionToken) {
        try {
            localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ session_id: sessionId, session_token: sessionToken }));
        }
        catch {
            // Ignore
        }
    }
    /** Alias for saveSession */
    static storeSession(sessionId, sessionToken) {
        this.saveSession(sessionId, sessionToken);
    }
    /** Load session ID */
    static loadSessionId() {
        try {
            const stored = localStorage.getItem(SESSION_STORAGE_KEY);
            return stored ? JSON.parse(stored).session_id : null;
        }
        catch {
            return null;
        }
    }
    /** Load session-scoped WS token */
    static loadSessionToken() {
        try {
            const stored = localStorage.getItem(SESSION_STORAGE_KEY);
            return stored
                ? JSON.parse(stored).session_token
                : null;
        }
        catch {
            return null;
        }
    }
    /** Clear only session data (keep auth for session refresh) */
    static clearSession() {
        try {
            localStorage.removeItem(SESSION_STORAGE_KEY);
            localStorage.removeItem(THREAD_STORAGE_KEY);
        }
        catch {
            // Ignore
        }
    }
    /** Check if user is authenticated */
    static isAuthenticated() {
        return this.loadAuth() !== null;
    }
    /**
     * Check if the JWT token is expired (client-side decode, no server call)
     * Returns true if token is valid, false if expired or invalid
     */
    static isTokenValid(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3)
                return false;
            const payload = JSON.parse(atob(parts[1]));
            const now = Math.floor(Date.now() / 1000);
            return payload.exp > now;
        }
        catch {
            return false;
        }
    }
    /**
     * Get remaining time until JWT expiry (in seconds), or 0 if expired/invalid
     */
    static getTokenExpirySeconds(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3)
                return 0;
            const payload = JSON.parse(atob(parts[1]));
            const now = Math.floor(Date.now() / 1000);
            return Math.max(0, payload.exp - now);
        }
        catch {
            return 0;
        }
    }
    /**
     * Validate session by checking JWT expiry client-side
     * Does NOT create a new session (no side effects)
     * Returns true if JWT is still valid
     */
    static async validateSession(_studentId, token) {
        const isValid = this.isTokenValid(token);
        if (!isValid) {
            console.warn("[SessionManager] JWT token is expired");
        }
        return isValid;
    }
    /**
     * Refresh session: create a new session on the server using valid JWT
     * Call this when session expired but JWT is still valid
     */
    static async refreshSession(studentId, token) {
        try {
            const res = await fetch("/sessions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ student_id: studentId }),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => "Unknown error");
                let parsed = {};
                try {
                    parsed = JSON.parse(text);
                }
                catch { /* not JSON */ }
                handleError({ status: res.status, message: parsed.error || text, code: parsed.code });
                return null;
            }
            const data = await res.json();
            return { session_id: data.session_id, session_token: data.token };
        }
        catch (err) {
            handleError(err);
            return null;
        }
    }
    /** Mark session as expired - only clears session data, NOT auth */
    static markSessionExpired() {
        console.warn("[SessionManager] Session expired - clearing session data only");
        this.clearSession();
    }
    /** Mark auth as expired - clears everything (forces re-login) */
    static markAuthExpired() {
        console.warn("[SessionManager] Auth expired - clearing all storage");
        this.clearAuth();
    }
    /** Save last loaded thread ID (Goose session) */
    static saveLastThreadId(threadId, sessionId) {
        try {
            localStorage.setItem(THREAD_STORAGE_KEY, JSON.stringify({ thread_id: threadId, session_id: sessionId }));
        }
        catch {
            // Ignore
        }
    }
    /** Load last loaded thread ID for current session */
    static loadLastThreadId(sessionId) {
        try {
            const stored = localStorage.getItem(THREAD_STORAGE_KEY);
            if (!stored)
                return null;
            const data = JSON.parse(stored);
            // Only return if it matches current session
            return data.session_id === sessionId ? data.thread_id : null;
        }
        catch {
            return null;
        }
    }
}
