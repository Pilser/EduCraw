import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Loader2, RefreshCw, XOctagon } from "lucide";
import { adminApi } from "../core/admin-api";
import type { AdminSession } from "../core/admin-types";

@customElement("sessions-tab")
export class SessionsTab extends LitElement {
  @property({ type: String }) token = "";
  @property({ type: String }) role = "";

  @state() private sessions: AdminSession[] = [];
  @state() private loading = false;
  @state() private error = "";
  @state() private success = "";

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.load();
  }

  private async load() {
    this.loading = true;
    this.error = "";
    try {
      this.sessions = await adminApi.listSessions(this.token);
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load sessions";
    } finally {
      this.loading = false;
    }
  }

  private async terminate(sessionId: string) {
    if (!confirm("Force-terminate this session? The student will be disconnected.")) return;
    this.error = "";
    this.success = "";
    try {
      await adminApi.terminateSession(this.token, sessionId);
      this.success = "Session terminated";
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Terminate failed";
    }
  }

  render() {
    const isAdmin = this.role === "admin";
    return html`
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-foreground">Live Sessions</h2>
          ${Button({
            variant: "ghost",
            size: "sm",
            children: html`${icon(RefreshCw, "xs")} Refresh`,
            onClick: () => this.load(),
          })}
        </div>

        ${this.error
          ? html`<div class="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">${this.error}</div>`
          : ""}
        ${this.success
          ? html`<div class="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">${this.success}</div>`
          : ""}

        ${this.loading && this.sessions.length === 0
          ? html`<div class="flex items-center justify-center py-12">
              ${icon(Loader2, "md", "animate-spin text-muted-foreground")}
            </div>`
          : this.sessions.length === 0
            ? html`<p class="text-center text-muted-foreground py-12">No active sessions.</p>`
            : html`
                <div class="border border-border rounded-lg overflow-hidden">
                  <table class="w-full text-sm">
                    <thead class="bg-muted/50 border-b border-border">
                      <tr class="text-left text-muted-foreground">
                        <th class="py-2.5 px-4 font-medium">Student ID</th>
                        <th class="py-2.5 px-4 font-medium">State</th>
                        <th class="py-2.5 px-4 font-medium">Idle Time</th>
                        <th class="py-2.5 px-4 font-medium">Started</th>
                        ${isAdmin
                          ? html`<th class="py-2.5 px-4 font-medium">Actions</th>`
                          : ""}
                      </tr>
                    </thead>
                    <tbody>
                      ${this.sessions.map(
                        (s) => html`
                          <tr class="border-b border-border hover:bg-muted/30">
                            <td class="py-2.5 px-4">
                              <code class="text-xs bg-muted px-1.5 py-0.5 rounded">${s.student_id.slice(0, 8)}…</code>
                            </td>
                            <td class="py-2.5 px-4">
                              <span
                                class="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${s
                                  .state === "active"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"}"
                              >
                                <span
                                  class="w-1.5 h-1.5 rounded-full ${s.state ===
                                "active"
                                  ? "bg-green-500"
                                  : "bg-yellow-500"}"
                                ></span>
                                ${s.state}
                              </span>
                            </td>
                            <td class="py-2.5 px-4 text-muted-foreground text-xs">
                              ${s.idle_secs != null
                                ? `${Math.floor(s.idle_secs / 60)}m ${s.idle_secs % 60}s`
                                : "—"}
                            </td>
                            <td class="py-2.5 px-4 text-muted-foreground text-xs">
                              ${new Date(s.started_at).toLocaleString()}
                            </td>
                            ${isAdmin
                              ? html`
                                  <td class="py-2.5 px-4">
                                    ${Button({
                                      variant: "destructive",
                                      size: "sm",
                                      children: html`${icon(XOctagon, "xs")} Terminate`,
                                      onClick: () => this.terminate(s.id),
                                    })}
                                  </td>
                                `
                              : ""}
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `}
      </div>
    `;
  }
}
