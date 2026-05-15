import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Check, Edit3, Loader2, Plus, Save, Trash2, X } from "lucide";
import { adminApi } from "../core/admin-api";
import type { Cohort } from "../core/admin-types";

@customElement("cohorts-tab")
export class CohortsTab extends LitElement {
  @property({ type: String }) token = "";
  @property({ type: String }) role = "";

  @state() private cohorts: Cohort[] = [];
  @state() private loading = false;
  @state() private error = "";
  @state() private success = "";

  @state() private creating = false;
  @state() private newSlug = "";
  @state() private newTitle = "";

  @state() private editId = "";
  @state() private editSlug = "";
  @state() private editTitle = "";

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
      this.cohorts = await adminApi.listCohorts(this.token);
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load cohorts";
    } finally {
      this.loading = false;
    }
  }

  private async create() {
    if (!this.newSlug.trim() || !this.newTitle.trim()) return;
    this.error = "";
    this.success = "";
    this.loading = true;
    try {
      await adminApi.createCohort(this.token, this.newSlug.trim(), this.newTitle.trim());
      this.success = "Cohort created";
      this.newSlug = "";
      this.newTitle = "";
      this.creating = false;
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Create failed";
    } finally {
      this.loading = false;
    }
  }

  private startEdit(c: Cohort) {
    this.editId = c.id;
    this.editSlug = c.id;
    this.editTitle = c.title;
  }

  private cancelEdit() {
    this.editId = "";
  }

  private async saveEdit() {
    if (!this.editSlug.trim() || !this.editTitle.trim()) return;
    this.error = "";
    this.loading = true;
    try {
      await adminApi.updateCohort(
        this.token,
        this.editId,
        this.editSlug.trim(),
        this.editTitle.trim(),
      );
      this.editId = "";
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Update failed";
    } finally {
      this.loading = false;
    }
  }

  private async deleteCohort(id: string) {
    if (!confirm("Delete this cohort? This will also delete all its subjects and files.")) return;
    this.error = "";
    this.loading = true;
    try {
      await adminApi.deleteCohort(this.token, id);
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Delete failed";
    } finally {
      this.loading = false;
    }
  }

  render() {
    const isAdmin = this.role === "admin";
    return html`
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-foreground">Cohorts</h2>
          <div class="flex gap-2">
            ${Button({
              variant: "ghost",
              size: "sm",
              children: "Refresh",
              onClick: () => this.load(),
            })}
            ${isAdmin
              ? Button({
                  variant: "default",
                  size: "sm",
                  children: html`${icon(Plus, "xs")} New Cohort`,
                  onClick: () => {
                    this.creating = !this.creating;
                  },
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

        ${this.creating
          ? html`
              <div class="border border-border rounded-lg p-4 bg-card space-y-3 max-w-xl">
                <h3 class="text-sm font-medium text-foreground">Create Cohort</h3>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Slug</label>
                    ${Input({
                      type: "text",
                      value: this.newSlug,
                      placeholder: "e.g. primary-2b",
                      className: "w-full",
                      onChange: (e: Event) => {
                        this.newSlug = (e.target as HTMLInputElement).value;
                      },
                    })}
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Title</label>
                    ${Input({
                      type: "text",
                      value: this.newTitle,
                      placeholder: "e.g. Primary 2B",
                      className: "w-full",
                      onChange: (e: Event) => {
                        this.newTitle = (e.target as HTMLInputElement).value;
                      },
                    })}
                  </div>
                </div>
                <div class="flex gap-2">
                  ${Button({
                    variant: "default",
                    size: "sm",
                    children: html`${icon(Plus, "xs")} Create`,
                    disabled: this.loading,
                    onClick: () => this.create(),
                  })}
                  ${Button({
                    variant: "ghost",
                    size: "sm",
                    children: "Cancel",
                    onClick: () => {
                      this.creating = false;
                    },
                  })}
                </div>
              </div>
            `
          : ""}

        ${this.loading && this.cohorts.length === 0
          ? html`<div class="flex items-center justify-center py-12">
              ${icon(Loader2, "md", "animate-spin text-muted-foreground")}
            </div>`
          : this.cohorts.length === 0
            ? html`<p class="text-center text-muted-foreground py-12">No cohorts yet.</p>`
            : html`
                <div class="border border-border rounded-lg overflow-hidden">
                  <table class="w-full text-sm">
                    <thead class="bg-muted/50 border-b border-border">
                      <tr class="text-left text-muted-foreground">
                        <th class="py-2.5 px-4 font-medium">Slug</th>
                        <th class="py-2.5 px-4 font-medium">Title</th>
                        <th class="py-2.5 px-4 font-medium">Created</th>
                        ${isAdmin
                          ? html`<th class="py-2.5 px-4 font-medium">Actions</th>`
                          : ""}
                      </tr>
                    </thead>
                    <tbody>
                      ${this.cohorts.map(
                        (c) => html`
                          <tr class="border-b border-border hover:bg-muted/30">
                            <td class="py-2.5 px-4">
                              ${this.editId === c.id
                                ? Input({
                                    type: "text",
                                    value: this.editSlug,
                                    className: "w-full text-sm",
                                    onChange: (e: Event) => {
                                      this.editSlug = (e.target as HTMLInputElement).value;
                                    },
                                  })
                                : html`<code class="text-xs bg-muted px-1.5 py-0.5 rounded">${c.id}</code>`}
                            </td>
                            <td class="py-2.5 px-4">
                              ${this.editId === c.id
                                ? Input({
                                    type: "text",
                                    value: this.editTitle,
                                    className: "w-full text-sm",
                                    onChange: (e: Event) => {
                                      this.editTitle = (e.target as HTMLInputElement).value;
                                    },
                                  })
                                : c.title}
                            </td>
                            <td class="py-2.5 px-4 text-muted-foreground text-xs">
                              ${new Date(c.created_at).toLocaleDateString()}
                            </td>
                            ${isAdmin
                              ? html`
                                  <td class="py-2.5 px-4">
                                    <div class="flex gap-1">
                                      ${this.editId === c.id
                                        ? html`
                                            ${Button({
                                              variant: "default",
                                              size: "sm",
                                              children: html`${icon(Save, "xs")}`,
                                              onClick: () => this.saveEdit(),
                                            })}
                                            ${Button({
                                              variant: "ghost",
                                              size: "sm",
                                              children: html`${icon(X, "xs")}`,
                                              onClick: () => this.cancelEdit(),
                                            })}
                                          `
                                        : html`
                                            ${Button({
                                              variant: "ghost",
                                              size: "sm",
                                              children: html`${icon(Edit3, "xs")}`,
                                              onClick: () => this.startEdit(c),
                                            })}
                                            ${Button({
                                              variant: "ghost",
                                              size: "sm",
                                              children: html`${icon(Trash2, "xs")} `,
                                              onClick: () => this.deleteCohort(c.id),
                                            })}
                                          `}
                                    </div>
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
