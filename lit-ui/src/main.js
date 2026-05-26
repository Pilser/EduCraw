import "./app.css";
import "./pages/login-page.js";
import "./pages/chat-page.js";
import { html, render } from "lit";
import { SessionManager } from "./core/session-manager";
import { eduApi } from "./core/edu-api";
let currentView = { kind: "loading" };
function renderApp() {
    const app = document.getElementById("app");
    if (!app)
        return;
    let content;
    switch (currentView.kind) {
        case "loading":
            content = html `
        <div
          class="w-full h-screen flex items-center justify-center bg-background text-foreground"
        >
          <p class="text-muted-foreground">Loading…</p>
        </div>
      `;
            break;
        case "login":
            content = html `
        <login-page
          @login-success=${async (e) => {
                const auth = e.detail;
                try {
                    const sessionId = crypto.randomUUID();
                    const session = await eduApi.createSession(auth.student_id, auth.token, undefined, sessionId);
                    // Save auth and session
                    SessionManager.saveAuth(auth);
                    SessionManager.saveSession(session.session_id, session.token);
                    currentView = {
                        kind: "chat",
                        auth,
                        sessionId: session.session_id,
                        sessionToken: session.token,
                    };
                    renderApp();
                }
                catch (err) {
                    console.error("Failed to create session:", err);
                    currentView = {
                        kind: "login",
                    };
                    renderApp();
                }
            }}
        ></login-page>
      `;
            break;
        case "chat":
            content = html `
        <chat-page
          .auth=${currentView.auth}
          .sessionId=${currentView.sessionId}
          .sessionToken=${currentView.sessionToken}
          @logout=${() => {
                SessionManager.clearAuth();
                currentView = { kind: "login" };
                renderApp();
            }}
          @session-expired=${() => {
                // Session expired but JWT may still be valid
                // Try to create a new session before forcing re-login
                SessionManager.markSessionExpired();
                if (currentView.kind === "chat") {
                    const auth = currentView.auth;
                    // Try to refresh session in background
                    eduApi.createSession(auth.student_id, auth.token, undefined, crypto.randomUUID())
                        .then((session) => {
                        SessionManager.saveSession(session.session_id, session.token);
                        currentView = {
                            kind: "chat",
                            auth,
                            sessionId: session.session_id,
                            sessionToken: session.token,
                        };
                        renderApp();
                        // Auto-resume the most recent thread from HelixDB
                        document.querySelector("chat-page")?.tryResumeRecentThread();
                    })
                        .catch((err) => {
                        console.error("Failed to refresh session:", err);
                        // JWT may also be expired, force re-login
                        SessionManager.clearAuth();
                        currentView = { kind: "login" };
                        renderApp();
                    });
                }
            }}
          @new-session=${(e) => {
                console.log("[main] Handling new-session event", e.detail);
                if (currentView.kind === "chat") {
                    currentView = {
                        kind: "chat",
                        auth: currentView.auth,
                        sessionId: e.detail.sessionId,
                        sessionToken: e.detail.sessionToken,
                    };
                    renderApp();
                }
            }}
        ></chat-page>
      `;
            break;
    }
    render(content, app);
}
function makeChatView(auth, sessionId, sessionToken) {
    return { kind: "chat", auth, sessionId, sessionToken };
}
function startNewSession(auth) {
    return eduApi.createSession(auth.student_id, auth.token, undefined, crypto.randomUUID())
        .then((session) => {
        SessionManager.clearSession();
        SessionManager.saveSession(session.session_id, session.token);
        return makeChatView(auth, session.session_id, session.token);
    });
}
// Initialize
async function init() {
    const auth = SessionManager.loadAuth();
    if (auth) {
        const isJwtValid = SessionManager.isTokenValid(auth.token);
        if (!isJwtValid) {
            console.warn("[main] JWT token is expired - forcing re-login");
            SessionManager.clearAuth();
            currentView = { kind: "login" };
            renderApp();
            return;
        }
        // JWT is valid
        const sessionId = SessionManager.loadSessionId();
        const sessionToken = SessionManager.loadSessionToken();
        let isNewSession = false;
        if (sessionId && sessionToken && SessionManager.isTokenValid(sessionToken)) {
            try {
                await eduApi.getSessionModels(sessionId, auth.token);
                console.log("[main] Restoring existing session");
                currentView = makeChatView(auth, sessionId, sessionToken);
            }
            catch {
                // Session not found on backend — create new
                console.log("[main] Session not found on backend, creating new session...");
                try {
                    currentView = await startNewSession(auth);
                    isNewSession = true;
                }
                catch (createErr) {
                    console.error("Failed to create session:", createErr);
                    SessionManager.clearAuth();
                    currentView = { kind: "login" };
                }
            }
        }
        else {
            // Session token expired or no session stored — create new
            console.log("[main] Creating new session...");
            try {
                currentView = await startNewSession(auth);
                isNewSession = true;
            }
            catch (err) {
                console.error("Failed to create session:", err);
                SessionManager.clearAuth();
                currentView = { kind: "login" };
            }
        }
        renderApp();
        // Auto-resume recent thread when a new session was created
        if (isNewSession) {
            document.querySelector("chat-page")?.tryResumeRecentThread();
        }
    }
    else {
        currentView = { kind: "login" };
        renderApp();
    }
}
init();
