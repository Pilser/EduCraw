import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Edit3, Info, Loader2, Plus, Save, Trash2, X } from "lucide";
import { adminApi } from "../core/admin-api";
import type { Cohort, Subject } from "../core/admin-types";

@customElement("subjects-tab")
export class SubjectsTab extends LitElement {
  @property({ type: String }) token = "";
  @property({ type: String }) role = "";

  @state() private subjects: Subject[] = [];
  @state() private cohorts: Cohort[] = [];
  @state() private loading = false;
  @state() private error = "";
  @state() private success = "";
  @state() private filterCohortId = "";

  @state() private creating = false;
  @state() private newCohortId = "";
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
    this.loadCohorts().then(() => this.load());
  }

  private async load() {
    this.loading = true;
    this.error = "";
    try {
      this.subjects = await adminApi.listSubjects(
        this.token,
        this.filterCohortId || undefined,
      );
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load subjects";
    } finally {
      this.loading = false;
    }
  }

  private async loadCohorts() {
    try {
      this.cohorts = await adminApi.listCohorts(this.token);
    } catch {
      // Non-fatal
    }
  }

  private onFilterChange(e: Event) {
    this.filterCohortId = (e.target as HTMLSelectElement).value;
    this.load();
  }

  private async create() {
    if (!this.newCohortId || !this.newSlug.trim() || !this.newTitle.trim()) return;
    this.error = "";
    this.success = "";
    this.loading = true;
    try {
      await adminApi.createSubject(
        this.token,
        this.newCohortId,
        this.newSlug.trim(),
        this.newTitle.trim(),
      );
      this.success = "Subject created";
      this.newCohortId = "";
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

  private startEdit(s: Subject) {
    this.editId = s.id;
    this.editSlug = s.slug;
    this.editTitle = s.title;
  }

  private cancelEdit() {
    this.editId = "";
  }

  private async saveEdit() {
    if (!this.editSlug.trim() || !this.editTitle.trim()) return;
    this.error = "";
    this.loading = true;
    try {
      await adminApi.updateSubject(
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

  private async deleteSubject(id: string) {
    if (!confirm("Delete this subject? This will also delete its files on disk.")) return;
    this.error = "";
    this.loading = true;
    try {
      await adminApi.deleteSubject(this.token, id);
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
          <h2 class="text-lg font-semibold text-foreground">Subjects</h2>
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
                  children: html`${icon(Plus, "xs")} New Subject`,
                  onClick: () => {
                    this.creating = !this.creating;
                  },
                })
              : ""}
          </div>
        </div>

        <div class="flex items-center gap-3">
          <label class="text-sm text-muted-foreground">Filter by Cohort:</label>
          <select
            class="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            @change=${this.onFilterChange}
          >
            <option value="">All cohorts</option>
            ${this.cohorts.map(
              (c) => html`<option value=${c.id}>${c.title}</option>`,
            )}
          </select>
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
                <h3 class="text-sm font-medium text-foreground">Create Subject</h3>
                <div class="space-y-3">
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Cohort</label>
                    <select
                      class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      @change=${(e: Event) => {
                        this.newCohortId = (e.target as HTMLSelectElement).value;
                      }}
                    >
                      <option value="">Select a cohort...</option>
                      ${this.cohorts.map(
                        (c) => html`<option value=${c.id}>${c.title}</option>`,
                      )}
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Slug</label>
                    ${Input({
                      type: "text",
                      value: this.newSlug,
                      placeholder: "e.g. mathematics",
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
                      placeholder: "e.g. Mathematics",
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

        ${this.loading && this.subjects.length === 0
          ? html`<div class="flex items-center justify-center py-12">
              ${icon(Loader2, "md", "animate-spin text-muted-foreground")}
            </div>`
          : this.subjects.length === 0
            ? html`<p class="text-center text-muted-foreground py-12">No subjects yet.</p>`
            : html`
                <div class="border border-border rounded-lg overflow-hidden">
                  <table class="w-full text-sm">
                    <thead class="bg-muted/50 border-b border-border">
                      <tr class="text-left text-muted-foreground">
                        <th class="py-2.5 px-4 font-medium">Cohort</th>
                        <th class="py-2.5 px-4 font-medium">Slug</th>
                        <th class="py-2.5 px-4 font-medium">Title</th>
                        <th class="py-2.5 px-4 font-medium">Created</th>
                        ${isAdmin
                          ? html`<th class="py-2.5 px-4 font-medium">Actions</th>`
                          : ""}
                      </tr>
                    </thead>
                    <tbody>
                      ${this.subjects.map(
                        (s) => html`
                          <tr class="border-b border-border hover:bg-muted/30">
                            <td class="py-2.5 px-4">
                              <code class="text-xs bg-muted px-1.5 py-0.5 rounded">${s.cohort_id}</code>
                            </td>
                            <td class="py-2.5 px-4">
                              ${this.editId === s.id
                                ? Input({
                                    type: "text",
                                    value: this.editSlug,
                                    className: "w-full text-sm",
                                    onChange: (e: Event) => {
                                      this.editSlug = (e.target as HTMLInputElement).value;
                                    },
                                  })
                                : html`<code class="text-xs bg-muted px-1.5 py-0.5 rounded">${s.slug}</code>`}
                            </td>
                            <td class="py-2.5 px-4">
                              ${this.editId === s.id
                                ? Input({
                                    type: "text",
                                    value: this.editTitle,
                                    className: "w-full text-sm",
                                    onChange: (e: Event) => {
                                      this.editTitle = (e.target as HTMLInputElement).value;
                                    },
                                  })
                                : s.title}
                            </td>
                            <td class="py-2.5 px-4 text-muted-foreground text-xs">
                              ${new Date(s.created_at).toLocaleDateString()}
                            </td>
                            ${isAdmin
                              ? html`
                                  <td class="py-2.5 px-4">
                                    <div class="flex gap-1">
                                      ${this.editId === s.id
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
                                              onClick: () => this.startEdit(s),
                                            })}
                                            ${Button({
                                              variant: "ghost",
                                              size: "sm",
                                              children: html`${icon(Trash2, "xs")}`,
                                              onClick: () => this.deleteSubject(s.id),
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

        <div
          class="flex items-start gap-2 border border-border rounded-lg p-4 bg-muted/20 max-w-2xl"
        >
          ${icon(Info, "sm", "text-muted-foreground mt-0.5 shrink-0")}
          <div class="text-xs text-muted-foreground">
            <p class="font-medium mb-1">Course material location:</p>
            <code class="bg-muted px-1 py-0.5 rounded text-xs">/srv/educlaw/data/subjects/{cohort_id}/{slug}/</code>
            <p class="mt-1">
              Place course files (PDFs, documents, etc.) in the subject directory under the
              appropriate cohort. Students will see these as read-only materials in their sessions.
            </p>
          </div>
        </div>
      </div>
    `;
  }
}
