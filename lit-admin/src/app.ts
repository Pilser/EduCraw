import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LoginResponse } from "./core/admin-types";
import { SessionManager } from "./core/session-manager";

@customElement("admin-app")
export class AdminApp extends LitElement {
  @state() view: "login" | "dashboard" = "login";
  @state() token = "";
  @state() role = "";
  @state() displayName = "";

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.restoreSession();
  }

  private async restoreSession() {
    const auth = SessionManager.loadAuth();
    if (!auth) {
      this.view = "login";
      return;
    }
    if (auth.role !== "admin" && auth.role !== "teacher") {
      SessionManager.clearAuth();
      this.view = "login";
      return;
    }
    const valid = await SessionManager.validateToken(auth.token);
    if (!valid) {
      SessionManager.clearAuth();
      this.view = "login";
      return;
    }
    this.token = auth.token;
    this.role = auth.role;
    this.displayName = auth.display_name;
    this.view = "dashboard";
  }

  private handleLogin(e: CustomEvent<LoginResponse>) {
    const auth = e.detail;
    SessionManager.saveAuth(auth);
    this.token = auth.token;
    this.role = auth.role;
    this.displayName = auth.display_name;
    this.view = "dashboard";
  }

  private handleLogout() {
    SessionManager.clearAuth();
    this.token = "";
    this.role = "";
    this.displayName = "";
    this.view = "login";
  }

  render() {
    if (this.view === "login") {
      return html`
        <admin-login-page
          @admin-login=${this.handleLogin}
        ></admin-login-page>
      `;
    }
    return html`
      <admin-dashboard
        .token=${this.token}
        .role=${this.role}
        .displayName=${this.displayName}
        .onLogout=${() => this.handleLogout()}
      ></admin-dashboard>
    `;
  }
}
