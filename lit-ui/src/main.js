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
                    const session = await eduApi.createSession(auth.student_id, auth.token);
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
                    eduApi.createSession(auth.student_id, auth.token)
                        .then((session) => {
                        SessionManager.saveSession(session.session_id, session.token);
                        currentView = {
                            kind: "chat",
                            auth,
                            sessionId: session.session_id,
                            sessionToken: session.token,
                        };
                        renderApp();
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
// Initialize
async function init() {
    const auth = SessionManager.loadAuth();
    if (auth) {
        // Check JWT expiry client-side (no server call, no side effects)
        const isJwtValid = SessionManager.isTokenValid(auth.token);
        if (!isJwtValid) {
            console.warn("[main] JWT token is expired - forcing re-login");
            SessionManager.clearAuth();
            currentView = { kind: "login" };
            renderApp();
            return;
        }
        // JWT is valid - try to use existing session
        const sessionId = SessionManager.loadSessionId();
        const sessionToken = SessionManager.loadSessionToken();
        if (sessionId && sessionToken) {
            // Check if session token is also valid
            const isSessionTokenValid = SessionManager.isTokenValid(sessionToken);
            if (isSessionTokenValid) {
                console.log("[main] Restoring existing session");
                currentView = {
                    kind: "chat",
                    auth,
                    sessionId,
                    sessionToken,
                };
            }
            else {
                // Session token expired but JWT is valid - try to refresh session
                console.log("[main] Session token expired, refreshing session...");
                try {
                    const session = await eduApi.createSession(auth.student_id, auth.token);
                    SessionManager.saveSession(session.session_id, session.token);
                    currentView = {
                        kind: "chat",
                        auth,
                        sessionId: session.session_id,
                        sessionToken: session.token,
                    };
                }
                catch (err) {
                    console.error("Failed to refresh session:", err);
                    SessionManager.clearAuth();
                    currentView = { kind: "login" };
                }
            }
        }
        else {
            // No session stored but JWT is valid - create new session
            console.log("[main] No session stored, creating new session...");
            try {
                const session = await eduApi.createSession(auth.student_id, auth.token);
                SessionManager.saveSession(session.session_id, session.token);
                currentView = {
                    kind: "chat",
                    auth,
                    sessionId: session.session_id,
                    sessionToken: session.token,
                };
            }
            catch (err) {
                console.error("Failed to create session:", err);
                SessionManager.clearAuth();
                currentView = { kind: "login" };
            }
        }
    }
    else {
        currentView = { kind: "login" };
    }
    renderApp();
}
init();
