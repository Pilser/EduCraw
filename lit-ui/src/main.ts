import "./app.css";
import "./pages/login-page.js";
import "./pages/chat-page.js";
import { html, render } from "lit";
import { SessionManager } from "./core/session-manager";
import { eduApi } from "./core/edu-api";
import type { LoginResponse } from "./core/edu-types";

type View =
  | { kind: "loading" }
  | { kind: "login" }
  | {
      kind: "chat";
      auth: LoginResponse;
      sessionId: string;
      sessionToken: string;
    };

let currentView: View = { kind: "loading" };

function renderApp() {
  const app = document.getElementById("app");
  if (!app) return;

  let content;

  switch (currentView.kind) {
    case "loading":
      content = html`
        <div
          class="w-full h-screen flex items-center justify-center bg-background text-foreground"
        >
          <p class="text-muted-foreground">Loading…</p>
        </div>
      `;
      break;

    case "login":
      content = html`
        <login-page
          @login-success=${async (e: CustomEvent<LoginResponse>) => {
            const auth = e.detail;
            try {
              const session = await eduApi.createSession(
                auth.student_id,
                auth.token,
              );
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
            } catch (err) {
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
      content = html`
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
            SessionManager.markSessionExpired();
            currentView = { kind: "login" };
            renderApp();
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
    // Validate stored auth token with server (like educlaw-web does)
    const isValid = await SessionManager.validateSession(
      auth.student_id,
      auth.token,
    );

    if (!isValid) {
      console.warn("[main] Stored token is invalid - forcing re-login");
      SessionManager.clearAuth();
      currentView = { kind: "login" };
      renderApp();
      return;
    }

    const sessionId = SessionManager.loadSessionId();
    const sessionToken = SessionManager.loadSessionToken();
    if (sessionId && sessionToken) {
      currentView = {
        kind: "chat",
        auth,
        sessionId,
        sessionToken,
      };
    } else {
      try {
        const session = await eduApi.createSession(auth.student_id, auth.token);
        SessionManager.saveSession(session.session_id, session.token);
        currentView = {
          kind: "chat",
          auth,
          sessionId: session.session_id,
          sessionToken: session.token,
        };
      } catch (err) {
        console.error("Failed to create session on restore:", err);
        SessionManager.clearAuth();
        currentView = { kind: "login" };
      }
    }
  } else {
    currentView = { kind: "login" };
  }

  renderApp();
}

init();
