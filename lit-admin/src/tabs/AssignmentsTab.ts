import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Loader2, Plus } from "lucide";
import { adminApi } from "../core/admin-api";
import type { Assignment, Subject } from "../core/admin-types";

@customElement("assignments-tab")
export class AssignmentsTab extends LitElement {
  @property({ type: String }) token = "";
  @property({ type: String }) role = "";

  @state() private assignments: Assignment[] = [];
  @state() private subjects: Subject[] = [];
  @state() private loading = false;
  @state() private error = "";
  @state() private success = "";
  @state() private filterSubjectId = "";

  @state() private creating = false;
  @state() private newSubjectId = "";
  @state() private newTitle = "";
  @state() private newDescription = "";
  @state() private newDueDate = "";

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadSubjects().then(() => this.load());
  }

  private async load() {
    this.loading = true;
    this.error = "";
    try {
      this.assignments = await adminApi.listAssignments(
        this.token,
        this.filterSubjectId || undefined,
      );
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load assignments";
    } finally {
      this.loading = false;
    }
  }

  private async loadSubjects() {
    try {
      this.subjects = await adminApi.listSubjects(this.token);
    } catch {
      // Non-fatal
    }
  }

  private onFilterChange(e: Event) {
    this.filterSubjectId = (e.target as HTMLSelectElement).value;
    this.load();
  }

  private async create() {
    if (!this.newSubjectId || !this.newTitle.trim()) return;
    this.error = "";
    this.success = "";
    this.loading = true;
    try {
      await adminApi.createAssignment(this.token, {
        subject_id: this.newSubjectId,
        title: this.newTitle.trim(),
        description: this.newDescription || undefined,
        due_date: this.newDueDate || undefined,
      });
      this.success = "Assignment created";
      this.newSubjectId = "";
      this.newTitle = "";
      this.newDescription = "";
      this.newDueDate = "";
      this.creating = false;
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Create failed";
    } finally {
      this.loading = false;
    }
  }

  render() {
    const isStaff = this.role === "admin" || this.role === "teacher";
    return html`
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-foreground">Assignments</h2>
          <div class="flex gap-2">
            ${Button({
              variant: "ghost",
              size: "sm",
              children: "Refresh",
              onClick: () => this.load(),
            })}
            ${isStaff
              ? Button({
                  variant: "default",
                  size: "sm",
                  children: html`${icon(Plus, "xs")} New Assignment`,
                  onClick: () => {
                    this.creating = !this.creating;
                  },
                })
              : ""}
          </div>
        </div>

        <div class="flex items-center gap-3">
          <label class="text-sm text-muted-foreground">Filter by Subject:</label>
          <select
            class="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            @change=${this.onFilterChange}
          >
            <option value="">All subjects</option>
            ${this.subjects.map(
              (s) =>
                html`<option value=${s.id}>${s.cohort_id}/${s.slug} — ${s.title}</option>`,
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
                <h3 class="text-sm font-medium text-foreground">Create Assignment</h3>
                <div class="space-y-3">
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Subject</label>
                    <select
                      class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      @change=${(e: Event) => {
                        this.newSubjectId = (e.target as HTMLSelectElement).value;
                      }}
                    >
                      <option value="">Select a subject…</option>
                      ${this.subjects.map(
                        (s) =>
                          html`<option value=${s.id}>
                            ${s.cohort_id}/${s.slug} — ${s.title}
                          </option>`,
                      )}
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Title</label>
                    ${Input({
                      type: "text",
                      value: this.newTitle,
                      placeholder: "Assignment title",
                      className: "w-full",
                      onChange: (e: Event) => {
                        this.newTitle = (e.target as HTMLInputElement).value;
                      },
                    })}
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Description</label>
                    <textarea
                      class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[80px]"
                      placeholder="Optional description"
                      .value=${this.newDescription}
                      @input=${(e: Event) => {
                        this.newDescription = (e.target as HTMLTextAreaElement).value;
                      }}
                    ></textarea>
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Due Date</label>
                    ${Input({
                      type: "date",
                      value: this.newDueDate,
                      className: "w-full",
                      onChange: (e: Event) => {
                        this.newDueDate = (e.target as HTMLInputElement).value;
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

        ${this.loading && this.assignments.length === 0
          ? html`<div class="flex items-center justify-center py-12">
              ${icon(Loader2, "md", "animate-spin text-muted-foreground")}
            </div>`
          : this.assignments.length === 0
            ? html`<p class="text-center text-muted-foreground py-12">No assignments yet.</p>`
            : html`
                <div class="border border-border rounded-lg overflow-hidden">
                  <table class="w-full text-sm">
                    <thead class="bg-muted/50 border-b border-border">
                      <tr class="text-left text-muted-foreground">
                        <th class="py-2.5 px-4 font-medium">Title</th>
                        <th class="py-2.5 px-4 font-medium">Subject</th>
                        <th class="py-2.5 px-4 font-medium">Due Date</th>
                        <th class="py-2.5 px-4 font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${this.assignments.map(
                        (a) => html`
                          <tr class="border-b border-border hover:bg-muted/30">
                            <td class="py-2.5 px-4 font-medium">${a.title}</td>
                            <td class="py-2.5 px-4 text-muted-foreground">${a.subject_id.slice(0, 8)}</td>
                            <td class="py-2.5 px-4 text-muted-foreground text-xs">
                              ${a.due_date
                                ? new Date(a.due_date).toLocaleDateString()
                                : "—"}
                            </td>
                            <td class="py-2.5 px-4 text-muted-foreground text-xs">
                              ${new Date(a.created_at).toLocaleDateString()}
                            </td>
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
