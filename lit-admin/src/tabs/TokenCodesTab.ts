import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Download, Loader2, Plus, Trash2 } from "lucide";
import { adminApi } from "../core/admin-api";
import type { TokenCode } from "../core/admin-types";

@customElement("token-codes-tab")
export class TokenCodesTab extends LitElement {
  @property({ type: String }) token = "";
  @property({ type: String }) role = "";

  @state() private codes: TokenCode[] = [];
  @state() private loading = false;
  @state() private error = "";
  @state() private success = "";

  @state() private generating = false;
  @state() private genTokens = "10000";
  @state() private genCount = "5";

  @state() private filterTokens = "";
  @state() private filterUsed = "";

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.load();
  }

  private buildUrl(): string {
    const params = new URLSearchParams();
    const ft = parseInt(this.filterTokens);
    if (!isNaN(ft) && ft > 0) params.set("tokens", String(ft));
    if (this.filterUsed === "true") params.set("used", "true");
    else if (this.filterUsed === "false") params.set("used", "false");
    return params.toString();
  }

  private async load() {
    this.loading = true;
    this.error = "";
    try {
      const ft = parseInt(this.filterTokens);
      const used = this.filterUsed === "true" ? true : this.filterUsed === "false" ? false : undefined;
      this.codes = await adminApi.listTokenCodes(
        this.token,
        !isNaN(ft) && ft > 0 ? ft : undefined,
        used,
      );
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load codes";
    } finally {
      this.loading = false;
    }
  }

  private async generate() {
    const tokens = parseInt(this.genTokens);
    const count = parseInt(this.genCount);
    if (!tokens || tokens <= 0 || !count || count <= 0) return;
    this.error = "";
    this.success = "";
    this.loading = true;
    try {
      const res = await adminApi.generateTokenCodes(this.token, tokens, count);
      this.success = `Generated ${res.codes.length} codes × ${this.genTokens} tokens`;
      this.genTokens = "10000";
      this.genCount = "5";
      this.generating = false;
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Generate failed";
    } finally {
      this.loading = false;
    }
  }

  private async deleteCode(id: string) {
    if (!confirm("Delete this code?")) return;
    this.loading = true;
    try {
      await adminApi.deleteTokenCode(this.token, id);
      this.success = "Code deleted";
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Delete failed";
    } finally {
      this.loading = false;
    }
  }

  private async exportCodes() {
    const tokens = parseInt(this.filterTokens);
    if (!tokens || tokens <= 0) return;
    try {
      const csv = await adminApi.exportTokenCodes(this.token, tokens);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `token-codes-${tokens}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Export failed";
    }
  }

  render() {
    const isAdmin = this.role === "admin";
    return html`
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-foreground">Token Codes</h2>
          <div class="flex gap-2">
            ${Button({ variant: "ghost", size: "sm", children: "Refresh", onClick: () => this.load() })}
            ${isAdmin
              ? Button({
                  variant: "default",
                  size: "sm",
                  children: html`${icon(Plus, "xs")} Generate Codes`,
                  onClick: () => { this.generating = !this.generating; },
                })
              : ""}
          </div>
        </div>

        ${this.error
          ? html`<div class="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">${this.error}</div>`
          : ""}
        ${this.success
          ? html`<div class="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">${this.success}</div>`
          : ""}

        ${this.generating
          ? html`
              <div class="border border-border rounded-lg p-4 bg-card space-y-3 max-w-sm">
                <h3 class="text-sm font-medium text-foreground">Generate Token Codes</h3>
                <div class="space-y-3">
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Tokens per code</label>
                    ${Input({ type: "number", value: this.genTokens, placeholder: "10000", className: "w-full",
                      onChange: (e: Event) => { this.genTokens = (e.target as HTMLInputElement).value; } })}
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Number of codes</label>
                    ${Input({ type: "number", value: this.genCount, placeholder: "5", className: "w-full",
                      onChange: (e: Event) => { this.genCount = (e.target as HTMLInputElement).value; } })}
                  </div>
                </div>
                <div class="flex gap-2">
                  ${Button({ variant: "default", size: "sm", children: html`${icon(Plus, "xs")} Generate`, disabled: this.loading,
                    onClick: () => this.generate() })}
                  ${Button({ variant: "ghost", size: "sm", children: "Cancel",
                    onClick: () => { this.generating = false; } })}
                </div>
              </div>
            `
          : ""}

        <div class="flex items-center gap-3 flex-wrap">
          <div class="flex items-center gap-2">
            <label class="text-xs text-muted-foreground">Token value:</label>
            ${Input({ type: "number", value: this.filterTokens, placeholder: "e.g. 10000", className: "w-28",
              onChange: (e: Event) => {
                this.filterTokens = (e.target as HTMLInputElement).value;
                this.load();
              } })}
          </div>
          <div class="flex items-center gap-2">
            <label class="text-xs text-muted-foreground">Status:</label>
            <select class="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
              @change=${(e: Event) => {
                this.filterUsed = (e.target as HTMLSelectElement).value;
                this.load();
              }}>
              <option value="">All</option>
              <option value="false">Unused</option>
              <option value="true">Used</option>
            </select>
          </div>
          ${this.filterTokens
            ? Button({ variant: "ghost", size: "sm", children: html`${icon(Download, "xs")} Export CSV`,
                onClick: () => this.exportCodes() })
            : ""}
        </div>

        ${this.loading && this.codes.length === 0
          ? html`<div class="flex items-center justify-center py-12">${icon(Loader2, "md", "animate-spin text-muted-foreground")}</div>`
          : this.codes.length === 0
            ? html`<p class="text-center text-muted-foreground py-12">No token codes yet.</p>`
            : html`
                <div class="border border-border rounded-lg overflow-hidden">
                  <table class="w-full text-sm">
                    <thead class="bg-muted/50 border-b border-border">
                      <tr class="text-left text-muted-foreground">
                        <th class="py-2.5 px-3 font-medium">Code</th>
                        <th class="py-2.5 px-3 font-medium">Tokens</th>
                        <th class="py-2.5 px-3 font-medium">Status</th>
                        <th class="py-2.5 px-3 font-medium">Used By</th>
                        <th class="py-2.5 px-3 font-medium">Used At</th>
                        <th class="py-2.5 px-3 font-medium">Created</th>
                        ${isAdmin ? html`<th class="py-2.5 px-3 font-medium">Actions</th>` : ""}
                      </tr>
                    </thead>
                    <tbody>
                      ${this.codes.map((c) => html`
                        <tr class="border-b border-border hover:bg-muted/30">
                          <td class="py-2 px-3">
                            <code class="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">${c.code}</code>
                          </td>
                          <td class="py-2 px-3 font-medium">${c.tokens.toLocaleString()}</td>
                          <td class="py-2 px-3">
                            <span class="inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${c.used_by
                              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"}">
                              ${c.used_by ? "Used" : "Available"}
                            </span>
                          </td>
                          <td class="py-2 px-3 text-xs text-muted-foreground">${c.used_by || "—"}</td>
                          <td class="py-2 px-3 text-xs text-muted-foreground">${c.used_at ? new Date(c.used_at).toLocaleString() : "—"}</td>
                          <td class="py-2 px-3 text-xs text-muted-foreground">${new Date(c.created_at).toLocaleDateString()}</td>
                          ${isAdmin
                            ? html`
                                <td class="py-2 px-3">
                                  ${Button({ variant: "ghost", size: "sm", children: html`${icon(Trash2, "xs")}`,
                                    onClick: () => this.deleteCode(c.id) })}
                                </td>
                              `
                            : ""}
                        </tr>
                      `)}
                    </tbody>
                  </table>
                </div>
              `}
      </div>
    `;
  }
}
