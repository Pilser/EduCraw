// core/error-handler.ts
//
// Centralized error classification and dispatch for the entire frontend.
// One file. One place. Every error flows through here.
//
// Usage:
//   import { handleError, classifyError, type AppError } from "../core/error-handler.js";
//
//   try { ... } catch (err) {
//     const e = handleError(err);
//     if (e.retryable) { /* retry */ }
//   }
// ── Error codes (mirror backend AppError) ──────────────────────────────────
export const ErrorCode = {
    // Auth (1xx)
    UNAUTHORIZED: "UNAUTHORIZED",
    JWT_EXPIRED: "JWT_EXPIRED",
    JWT_INVALID: "JWT_INVALID",
    WRONG_PASSWORD: "WRONG_PASSWORD",
    ACCOUNT_RESTRICTED: "ACCOUNT_RESTRICTED",
    // Authorization (2xx)
    FORBIDDEN: "FORBIDDEN",
    NOT_ADMIN: "NOT_ADMIN",
    NOT_STAFF: "NOT_STAFF",
    // Validation (3xx)
    BAD_REQUEST: "BAD_REQUEST",
    MISSING_FIELD: "MISSING_FIELD",
    INVALID_JSON: "INVALID_JSON",
    PATH_TRAVERSAL: "PATH_TRAVERSAL",
    USERNAME_TAKEN: "USERNAME_TAKEN",
    CODE_NOT_FOUND: "CODE_NOT_FOUND",
    // Not found (4xx)
    NOT_FOUND: "NOT_FOUND",
    SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
    STUDENT_NOT_FOUND: "STUDENT_NOT_FOUND",
    FILE_NOT_FOUND: "FILE_NOT_FOUND",
    MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
    // Session / Goose (5xx)
    SESSION_ERROR: "SESSION_ERROR",
    SESSION_NOT_ACTIVE: "SESSION_NOT_ACTIVE",
    GOOSE_DEAD: "GOOSE_DEAD",
    SESSION_EXPIRED: "SESSION_EXPIRED",
    BUFFER_TIMED_OUT: "BUFFER_TIMED_OUT",
    BUFFER_DRAINED: "BUFFER_DRAINED",
    GOOSE_SPAWN_FAILED: "GOOSE_SPAWN_FAILED",
    ACP_INIT_FAILED: "ACP_INIT_FAILED",
    ACP_SESSION_FAILED: "ACP_SESSION_FAILED",
    PROMPT_FAILED: "PROMPT_FAILED",
    RESTRICTED: "RESTRICTED",
    // Network / Infrastructure (6xx)
    NETWORK_ERROR: "NETWORK_ERROR",
    CONNECTION_RESET: "CONNECTION_RESET",
    TIMEOUT: "TIMEOUT",
    SERVER_ERROR: "SERVER_ERROR",
    IO_ERROR: "IO_ERROR",
    // Request Idempotency (7xx)
    REQUEST_IN_FLIGHT: "REQUEST_IN_FLIGHT",
    REQUEST_FAILED: "REQUEST_FAILED",
    // Unknown
    UNKNOWN: "UNKNOWN",
};
// ── Classification ─────────────────────────────────────────────────────────
/**
 * Classify any thrown value into a typed AppError.
 * Does NOT dispatch events — pure classification.
 */
export function classifyError(err) {
    // Already classified
    if (err && typeof err === "object" && "code" in err && "retryable" in err) {
        return err;
    }
    // TypeError from fetch — network failure
    if (err instanceof TypeError) {
        const msg = err.message || String(err);
        if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Network request failed")) {
            return makeError(ErrorCode.NETWORK_ERROR, "Network connection failed", { retryable: true, raw: err });
        }
        if (msg.includes("Load failed")) {
            return makeError(ErrorCode.CONNECTION_RESET, "Connection was reset", { retryable: true, raw: err });
        }
        if (msg.includes("Aborted") || msg.includes("abort")) {
            return makeError(ErrorCode.TIMEOUT, "Request was aborted", { retryable: false, raw: err });
        }
        return makeError(ErrorCode.NETWORK_ERROR, msg, { retryable: true, raw: err });
    }
    // Error with status property (fetch Response or API error)
    if (err && typeof err === "object") {
        const e = err;
        const status = typeof e.status === "number" ? e.status : typeof e.status === "string" ? parseInt(e.status, 10) : undefined;
        const message = (typeof e.message === "string" ? e.message : typeof e.error === "string" ? e.error : "");
        const code = typeof e.code === "string" ? e.code : undefined;
        // Check backend error code first
        if (code) {
            return classifyByCode(code, message, status, err);
        }
        // Classify by HTTP status
        if (status !== undefined) {
            return classifyByStatus(status, message, err);
        }
    }
    // String errors
    if (typeof err === "string") {
        return classifyByMessage(err, err);
    }
    // Error instances
    if (err instanceof Error) {
        return classifyByMessage(err.message, err);
    }
    return makeError(ErrorCode.UNKNOWN, "Unknown error", { retryable: false, raw: err });
}
// ── Internal classifiers ───────────────────────────────────────────────────
function classifyByCode(code, message, status, raw) {
    switch (code) {
        case "UNAUTHORIZED": return makeError(ErrorCode.UNAUTHORIZED, message || "Unauthorized", { status, retryable: false, raw });
        case "FORBIDDEN": return makeError(ErrorCode.FORBIDDEN, message || "Forbidden", { status, retryable: false, raw });
        case "NOT_FOUND": return makeError(ErrorCode.NOT_FOUND, message || "Not found", { status, retryable: false, raw });
        case "SESSION_NOT_FOUND": return makeError(ErrorCode.SESSION_NOT_FOUND, message || "Session not found", { status, retryable: true, raw });
        case "SESSION_NOT_ACTIVE": return makeError(ErrorCode.SESSION_NOT_ACTIVE, message || "Session not active", { status, retryable: true, raw });
        case "SESSION_EXPIRED": return makeError(ErrorCode.SESSION_EXPIRED, message || "Session expired", { status, retryable: true, raw });
        case "GOOSE_DEAD": return makeError(ErrorCode.GOOSE_DEAD, message || "Goose process ended", { status, retryable: true, raw });
        case "BUFFER_TIMED_OUT": return makeError(ErrorCode.BUFFER_TIMED_OUT, message || "Replay buffer timed out", { status, retryable: true, raw });
        case "BUFFER_DRAINED": return makeError(ErrorCode.BUFFER_DRAINED, message || "Replay buffer drained", { status, retryable: true, raw });
        case "SESSION_ERROR": return makeError(ErrorCode.SESSION_ERROR, message || "Session error", { status, retryable: false, raw });
        case "BAD_REQUEST": return makeError(ErrorCode.BAD_REQUEST, message || "Bad request", { status, retryable: false, raw });
        case "CONFLICT": return makeError(ErrorCode.USERNAME_TAKEN, message || "Conflict", { status, retryable: false, raw });
        case "RESTRICTED": return makeError(ErrorCode.RESTRICTED, message || "Account restricted", { status, retryable: false, raw });
        case "REQUEST_IN_FLIGHT": return makeError(ErrorCode.REQUEST_IN_FLIGHT, message || "Request still in-flight", { status, retryable: true, raw });
        case "REQUEST_FAILED": return makeError(ErrorCode.REQUEST_FAILED, message || "Request previously failed", { status, retryable: false, raw });
        default: return makeError(ErrorCode.UNKNOWN, message || `Unknown code: ${code}`, { status, retryable: false, raw });
    }
}
function classifyByStatus(status, message, raw) {
    if (status === 401) {
        if (message.toLowerCase().includes("expired") || message.toLowerCase().includes("jwt")) {
            return makeError(ErrorCode.JWT_EXPIRED, message, { status, retryable: false, raw });
        }
        return makeError(ErrorCode.UNAUTHORIZED, message || "Unauthorized", { status, retryable: false, raw });
    }
    if (status === 403) {
        if (message.toLowerCase().includes("restricted")) {
            return makeError(ErrorCode.ACCOUNT_RESTRICTED, message, { status, retryable: false, raw });
        }
        return makeError(ErrorCode.FORBIDDEN, message || "Forbidden", { status, retryable: false, raw });
    }
    if (status === 404) {
        if (message.includes("session")) {
            return makeError(ErrorCode.SESSION_NOT_FOUND, message, { status, retryable: true, raw });
        }
        return makeError(ErrorCode.NOT_FOUND, message || "Not found", { status, retryable: false, raw });
    }
    if (status === 400) {
        if (message.toLowerCase().includes("not active")) {
            return makeError(ErrorCode.SESSION_NOT_ACTIVE, message || "Session not active", { status, retryable: true, raw });
        }
        return makeError(ErrorCode.BAD_REQUEST, message || "Bad request", { status, retryable: false, raw });
    }
    if (status === 409) {
        if (message.toLowerCase().includes("in-flight") || message.toLowerCase().includes("in_flight")) {
            return makeError(ErrorCode.REQUEST_IN_FLIGHT, message || "Request in-flight", { status, retryable: true, raw });
        }
        if (message.toLowerCase().includes("request") && message.toLowerCase().includes("fail")) {
            return makeError(ErrorCode.REQUEST_FAILED, message || "Request failed", { status, retryable: false, raw });
        }
        return makeError(ErrorCode.USERNAME_TAKEN, message || "Conflict", { status, retryable: false, raw });
    }
    if (status >= 500)
        return makeError(ErrorCode.SERVER_ERROR, message || "Server error", { status, retryable: true, raw });
    return makeError(ErrorCode.UNKNOWN, message || `HTTP ${status}`, { status, retryable: false, raw });
}
function classifyByMessage(message, raw) {
    const lower = message.toLowerCase();
    // Auth
    if (lower.includes("unauthorized"))
        return makeError(ErrorCode.UNAUTHORIZED, message, { retryable: false, raw });
    if (lower.includes("jwt") && lower.includes("expired"))
        return makeError(ErrorCode.JWT_EXPIRED, message, { retryable: false, raw });
    // Session death
    if (lower.includes("not found") && lower.includes("session"))
        return makeError(ErrorCode.SESSION_NOT_FOUND, message, { retryable: false, raw });
    if (lower.includes("not active"))
        return makeError(ErrorCode.SESSION_NOT_ACTIVE, message, { retryable: false, raw });
    if (lower.includes("session") && lower.includes("ended"))
        return makeError(ErrorCode.SESSION_NOT_ACTIVE, message, { retryable: false, raw });
    if (lower.includes("not found"))
        return makeError(ErrorCode.NOT_FOUND, message, { retryable: false, raw });
    // Network
    if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network request failed")) {
        return makeError(ErrorCode.NETWORK_ERROR, message, { retryable: true, raw });
    }
    if (lower.includes("load failed") || lower.includes("connection reset")) {
        return makeError(ErrorCode.CONNECTION_RESET, message, { retryable: true, raw });
    }
    if (lower.includes("timeout"))
        return makeError(ErrorCode.TIMEOUT, message, { retryable: true, raw });
    // Goose
    if (lower.includes("goose_dead") || lower.includes("goose dead"))
        return makeError(ErrorCode.GOOSE_DEAD, message, { retryable: false, raw });
    if (lower.includes("goose") && lower.includes("spawn"))
        return makeError(ErrorCode.GOOSE_SPAWN_FAILED, message, { retryable: false, raw });
    if (lower.includes("acp") && lower.includes("init"))
        return makeError(ErrorCode.ACP_INIT_FAILED, message, { retryable: false, raw });
    // Restricted
    if (lower.includes("restricted"))
        return makeError(ErrorCode.RESTRICTED, message, { retryable: false, raw });
    return makeError(ErrorCode.UNKNOWN, message, { retryable: false, raw });
}
// ── Dispatch ───────────────────────────────────────────────────────────────
/**
 * Classify + dispatch the appropriate window event.
 * Call this from any catch block. Returns the classified error.
 */
export function handleError(err) {
    const e = classifyError(err);
    switch (e.code) {
        // Auth errors → session-expired (main.ts listens)
        case ErrorCode.UNAUTHORIZED:
        case ErrorCode.JWT_EXPIRED:
        case ErrorCode.JWT_INVALID:
        case ErrorCode.WRONG_PASSWORD:
            dispatch("session-expired", e);
            break;
        // Session death → session-dead (chat-page.ts listens)
        case ErrorCode.NOT_FOUND:
        case ErrorCode.SESSION_NOT_FOUND:
        case ErrorCode.SESSION_NOT_ACTIVE:
        case ErrorCode.SESSION_EXPIRED:
        case ErrorCode.STUDENT_NOT_FOUND:
        case ErrorCode.GOOSE_DEAD:
            dispatch("session-dead", e);
            break;
        case ErrorCode.BUFFER_TIMED_OUT:
        case ErrorCode.BUFFER_DRAINED:
            dispatch("buffer-drained", e);
            break;
        // Restricted → session-expired with restriction info
        case ErrorCode.ACCOUNT_RESTRICTED:
        case ErrorCode.RESTRICTED:
            dispatch("session-expired", e);
            break;
        // Network errors → network-error (optional listener)
        case ErrorCode.NETWORK_ERROR:
        case ErrorCode.CONNECTION_RESET:
        case ErrorCode.TIMEOUT:
            dispatch("network-error", e);
            break;
        // Request idempotency errors → dispatched for chat-page retry logic
        case ErrorCode.REQUEST_IN_FLIGHT:
        case ErrorCode.REQUEST_FAILED:
            dispatch("request-idempotency", e);
            break;
        // Server errors → server-error (optional listener)
        case ErrorCode.SERVER_ERROR:
            dispatch("server-error", e);
            break;
        // Everything else: no event, just return
        default:
            break;
    }
    return e;
}
/**
 * Convenience: classify + dispatch + check if session is dead.
 * Useful in catch blocks where you want to know "should I redirect to login?"
 */
export function isSessionFatal(err) {
    const e = classifyError(err);
    return !e.retryable && [
        ErrorCode.UNAUTHORIZED,
        ErrorCode.JWT_EXPIRED,
        ErrorCode.JWT_INVALID,
        ErrorCode.SESSION_NOT_FOUND,
        ErrorCode.SESSION_NOT_ACTIVE,
        ErrorCode.SESSION_EXPIRED,
        ErrorCode.GOOSE_DEAD,
        ErrorCode.ACCOUNT_RESTRICTED,
        ErrorCode.RESTRICTED,
        ErrorCode.FORBIDDEN,
    ].includes(e.code);
}
// ── Helpers ────────────────────────────────────────────────────────────────
function makeError(code, message, opts) {
    return { code, message, status: opts.status, retryable: opts.retryable, raw: opts.raw };
}
function dispatch(eventName, error) {
    window.dispatchEvent(new CustomEvent(eventName, {
        detail: { error: error.message, code: error.code, status: error.status },
        bubbles: true,
        composed: true,
    }));
}
// ── SSE frame classifier (for frames from backend stream) ──────────────────
/**
 * Classify an SSE frame type into an error (if it's an error frame).
 * Returns null for non-error frames.
 */
export function classifySseFrame(frameType, frame) {
    const code = typeof frame.code === "string" ? frame.code : undefined;
    const message = frame.error || frame.message || frame.reason || "";
    switch (frameType) {
        case "chat_error": {
            if (code)
                return classifyByCode(code, message, undefined, frame);
            return makeError(ErrorCode.SESSION_ERROR, message || "Chat error", { retryable: false, raw: frame });
        }
        case "session_terminated": {
            if (code)
                return classifyByCode(code, message || `Session terminated: ${frame.reason || "unknown"}`, undefined, frame);
            return makeError(ErrorCode.GOOSE_DEAD, `Session terminated: ${frame.reason || "unknown"}`, { retryable: false, raw: frame });
        }
        case "restriction": {
            if (code)
                return classifyByCode(code, message || "Account restricted", undefined, frame);
            return makeError(ErrorCode.RESTRICTED, message || "Account restricted", { retryable: false, raw: frame });
        }
        case "buffer_drained": {
            if (code)
                return classifyByCode(code, message || "Replay buffer drained", undefined, frame);
            return makeError(ErrorCode.BUFFER_DRAINED, message || "Replay buffer drained", { retryable: true, raw: frame });
        }
        case "error": {
            if (code)
                return classifyByCode(code, message || "Stream error", undefined, frame);
            return makeError(ErrorCode.SESSION_ERROR, message || "Stream error", { retryable: false, raw: frame });
        }
        default:
            return null; // not an error frame
    }
}
