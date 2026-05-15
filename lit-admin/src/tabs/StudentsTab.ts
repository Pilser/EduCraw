import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Ban, Edit3, Loader2, Plus, Save, Trash2, X, Coins, Settings, ShieldCheck } from "lucide";
import { adminApi } from "../core/admin-api";
import type { AdminStudent, Cohort, Model, TokenDeduction, StudentTokenUsage } from "../core/admin-types";

@customElement("students-tab")
export class StudentsTab extends LitElement {
  @property({ type: String }) token = "";
  @property({ type: String }) role = "";

  @state() private students: AdminStudent[] = [];
  @state() private cohorts: Cohort[] = [];
  @state() private models: Model[] = [];
  @state() private loading = false;
  @state() private error = "";
  @state() private success = "";

  // Create form
  @state() private creating = false;
  @state() private newUsername = "";
  @state() private newPassword = "";
  @state() private newDisplayName = "";
  @state() private newRole = "student";
  @state() private newCohortId = "";

  // Inline edit
  @state() private editId = "";
  @state() private editDisplayName = "";
  @state() private editCohortId = "";
  @state() private editNewPassword = "";

  // Token management panel
  @state() private tokenPanelStudentId = "";
  @state() private tokenBalance: number | null = null;
  @state() private tokenDeductions: TokenDeduction[] = [];
  @state() private tokenUsage: StudentTokenUsage | null = null;
  @state() private topupAmount = "";
  @state() private deductAmount = "";

  // Model access panel
  @state() private modelPanelStudentId = "";
  @state() private assignedModels: string[] = [];

  // Ban / Unban
  @state() private banStudentId = "";
  @state() private banMessage = "";

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    Promise.all([this.loadStudents(), this.loadCohorts(), this.loadModels()]);
  }

  private async loadStudents() {
    this.loading = true;
    this.error = "";
    try {
      this.students = await adminApi.listStudents(this.token);
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load students";
    } finally {
      this.loading = false;
    }
  }

  private async loadCohorts() {
    try {
      this.cohorts = await adminApi.listCohorts(this.token);
    } catch { /* non-fatal */ }
  }

  private async loadModels() {
    try {
      this.models = await adminApi.listModels(this.token);
    } catch { /* non-fatal */ }
  }

  private getEnabledModels() {
    return this.models.filter((m) => m.enabled === 1);
  }

  // ── Create ───────────────────────────────────────

  private async createStudent() {
    if (!this.newUsername.trim() || !this.newPassword || !this.newDisplayName.trim()) return;
    this.error = "";
    this.success = "";
    this.loading = true;
    try {
      await adminApi.createStudent(this.token, {
        username: this.newUsername.trim(),
        password: this.newPassword,
        display_name: this.newDisplayName.trim(),
        role: this.newRole,
        cohort_id: this.newCohortId,
      });
      this.success = "Student created";
      this.newUsername = "";
      this.newPassword = "";
      this.newDisplayName = "";
      this.newRole = "student";
      this.newCohortId = "";
      this.creating = false;
      await this.loadStudents();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Create failed";
    } finally {
      this.loading = false;
    }
  }

  // ── Edit ─────────────────────────────────────────

  private startEdit(s: AdminStudent) {
    this.editId = s.id;
    this.editDisplayName = s.display_name;
    this.editCohortId = s.cohort_id;
    this.editNewPassword = "";
  }

  private cancelEdit() {
    this.editId = "";
  }

  private async saveEdit() {
    this.error = "";
    this.loading = true;
    try {
      const body: Record<string, string> = {};
      if (this.editDisplayName.trim()) body.display_name = this.editDisplayName.trim();
      body.cohort_id = this.editCohortId;
      if (this.editNewPassword) body.new_password = this.editNewPassword;
      await adminApi.updateStudent(this.token, this.editId, body);
      this.editId = "";
      await this.loadStudents();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Update failed";
    } finally {
      this.loading = false;
    }
  }

  // ── Delete ───────────────────────────────────────

  private async deleteStudent(id: string) {
    if (!confirm("Delete this student? This action cannot be undone.")) return;
    this.error = "";
    this.loading = true;
    try {
      await adminApi.deleteStudent(this.token, id);
      await this.loadStudents();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Delete failed";
    } finally {
      this.loading = false;
    }
  }

  // ── Token management ─────────────────────────────

  private async toggleTokenPanel(id: string) {
    if (this.tokenPanelStudentId === id) {
      this.tokenPanelStudentId = "";
      return;
    }
    this.tokenPanelStudentId = id;
    this.modelPanelStudentId = "";
    this.banStudentId = "";
    await Promise.all([
      this.loadTokenBalance(id),
      this.loadTokenDeductions(id),
      this.loadStudentTokenUsage(id),
    ]);
  }

  private async loadTokenBalance(studentId: string) {
    try {
      const res = await adminApi.getTokenBalance(this.token, studentId);
      this.tokenBalance = res.balance;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load balance";
    }
  }

  private async loadTokenDeductions(studentId: string) {
    try {
      this.tokenDeductions = await adminApi.getTokenDeductions(this.token, studentId);
    } catch { /* non-fatal */ }
  }

  private async loadStudentTokenUsage(studentId: string) {
    try {
      this.tokenUsage = await adminApi.getStudentTokenUsage(this.token, studentId);
    } catch { /* non-fatal */ }
  }

  private async doTopup() {
    const amt = parseInt(this.topupAmount);
    if (!amt || amt <= 0) return;
    this.loading = true;
    try {
      const res = await adminApi.topupTokens(this.token, this.tokenPanelStudentId, amt);
      this.tokenBalance = res.new_balance;
      this.topupAmount = "";
      this.success = "Tokens added";
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Topup failed";
    } finally {
      this.loading = false;
    }
  }

  private async doDeduct() {
    const amt = parseInt(this.deductAmount);
    if (!amt || amt <= 0) return;
    this.loading = true;
    try {
      const res = await adminApi.deductTokens(this.token, this.tokenPanelStudentId, amt);
      this.tokenBalance = res.new_balance;
      this.deductAmount = "";
      this.success = "Tokens deducted";
      await this.loadTokenDeductions(this.tokenPanelStudentId);
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Deduct failed";
    } finally {
      this.loading = false;
    }
  }

  // ── Model access ─────────────────────────────────

  private async toggleModelPanel(id: string) {
    if (this.modelPanelStudentId === id) {
      this.modelPanelStudentId = "";
      return;
    }
    this.modelPanelStudentId = id;
    this.tokenPanelStudentId = "";
    this.banStudentId = "";
    try {
      const res = await adminApi.getStudentModels(this.token, id);
      this.assignedModels = res.models;
    } catch { /* non-fatal */ }
  }

  private toggleModelAssign(modelName: string) {
    const idx = this.assignedModels.indexOf(modelName);
    if (idx >= 0) {
      this.assignedModels = this.assignedModels.filter((m) => m !== modelName);
    } else {
      this.assignedModels = [...this.assignedModels, modelName];
    }
    this.requestUpdate();
  }

  private async saveModelRestrictions() {
    this.loading = true;
    try {
      await adminApi.setStudentModels(this.token, this.modelPanelStudentId, this.assignedModels);
      this.success = "Model restrictions saved";
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Save failed";
    } finally {
      this.loading = false;
    }
  }

  // ── Ban / Unban ────────────────────────────────

  private startBan(s: AdminStudent) {
    this.banStudentId = s.id;
    this.banMessage = s.restriction_message || "";
    this.tokenPanelStudentId = "";
    this.modelPanelStudentId = "";
  }

  private cancelBan() {
    this.banStudentId = "";
  }

  private async doBan() {
    this.loading = true;
    try {
      await adminApi.banStudent(this.token, this.banStudentId, this.banMessage || undefined);
      this.success = "Student banned";
      this.banStudentId = "";
      await this.loadStudents();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Ban failed";
    } finally {
      this.loading = false;
    }
  }

  private async doUnban(studentId: string) {
    this.loading = true;
    try {
      await adminApi.unbanStudent(this.token, studentId);
      this.success = "Student unbanned";
      await this.loadStudents();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Unban failed";
    } finally {
      this.loading = false;
    }
  }


  // ── Render ───────────────────────────────────────

  render() {
    const isAdmin = this.role === "admin";
    return html`
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-foreground">
            Students
            <span class="text-sm text-muted-foreground font-normal ml-2">
              ${this.students.filter(s => s.has_active_session).length} online / ${this.students.length} total
            </span>
          </h2>
          <div class="flex gap-2">
            ${Button({ variant: "ghost", size: "sm", children: "Refresh", onClick: () => this.loadStudents() })}
            ${isAdmin
              ? Button({
                  variant: "default",
                  size: "sm",
                  children: html`${icon(Plus, "xs")} New Student`,
                  onClick: () => { this.creating = !this.creating; },
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
                <h3 class="text-sm font-medium text-foreground">Create Student</h3>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Username</label>
                    ${Input({ type: "text", value: this.newUsername, placeholder: "username", className: "w-full",
                      onChange: (e: Event) => { this.newUsername = (e.target as HTMLInputElement).value; } })}
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Password</label>
                    ${Input({ type: "password", value: this.newPassword, placeholder: "password", className: "w-full",
                      onChange: (e: Event) => { this.newPassword = (e.target as HTMLInputElement).value; } })}
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Display Name</label>
                    ${Input({ type: "text", value: this.newDisplayName, placeholder: "Full name", className: "w-full",
                      onChange: (e: Event) => { this.newDisplayName = (e.target as HTMLInputElement).value; } })}
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Role</label>
                    <select class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      @change=${(e: Event) => { this.newRole = (e.target as HTMLSelectElement).value; }}>
                      <option value="student">Student</option>
                      <option value="teacher">Teacher</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Cohort</label>
                    <select class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      @change=${(e: Event) => { this.newCohortId = (e.target as HTMLSelectElement).value; }}>
                      <option value="">None</option>
                      ${this.cohorts.map((c) => html`<option value=${c.id}>${c.title}</option>`)}
                    </select>
                  </div>
                </div>
                <div class="flex gap-2">
                  ${Button({ variant: "default", size: "sm", children: html`${icon(Plus, "xs")} Create`, disabled: this.loading, onClick: () => this.createStudent() })}
                  ${Button({ variant: "ghost", size: "sm", children: "Cancel", onClick: () => { this.creating = false; } })}
                </div>
              </div>
            `
          : ""}

        ${this.loading && this.students.length === 0
          ? html`<div class="flex items-center justify-center py-12">${icon(Loader2, "md", "animate-spin text-muted-foreground")}</div>`
          : this.students.length === 0
            ? html`<p class="text-center text-muted-foreground py-12">No students yet.</p>`
            : html`
                <div class="border border-border rounded-lg overflow-hidden">
                  <table class="w-full text-sm">
                    <thead class="bg-muted/50 border-b border-border sticky top-0">
                      <tr class="text-left text-muted-foreground">
                        <th class="py-2.5 px-3 font-medium">Username</th>
                        <th class="py-2.5 px-3 font-medium">Name</th>
                        <th class="py-2.5 px-3 font-medium">Role</th>
                        <th class="py-2.5 px-3 font-medium">Cohort</th>
                        <th class="py-2.5 px-3 font-medium">Restriction</th>
                        <th class="py-2.5 px-3 font-medium">Status</th>
                        ${isAdmin ? html`<th class="py-2.5 px-3 font-medium">Actions</th>` : ""}
                      </tr>
                    </thead>
                    <tbody>
                      ${this.students.map((s) => html`
                        <tr class="border-b border-border hover:bg-muted/30">
                          <td class="py-2 px-3 font-medium">${s.username}</td>
                          <td class="py-2 px-3">
                            ${this.editId === s.id
                              ? Input({ type: "text", value: this.editDisplayName, className: "w-full text-sm",
                                  onChange: (e: Event) => { this.editDisplayName = (e.target as HTMLInputElement).value; } })
                              : s.display_name}
                          </td>
                          <td class="py-2 px-3">
                            <span class="inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${s.role === "admin"
                              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : s.role === "teacher"
                                ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}">
                              ${s.role}
                            </span>
                          </td>
                          <td class="py-2 px-3 text-muted-foreground text-xs">
                            ${this.editId === s.id
                              ? html`<select class="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
                                  @change=${(e: Event) => { this.editCohortId = (e.target as HTMLSelectElement).value; }}>
                                  <option value="" ?selected=${s.cohort_id === ""}>None</option>
                                  ${this.cohorts.map((c) => html`<option value=${c.id} ?selected=${s.cohort_id === c.id}>${c.title}</option>`)}
                                </select>`
                              : html`<code class="text-xs bg-muted px-1.5 py-0.5 rounded">${s.cohort_id || "—"}</code>`}
                          </td>
                          <td class="py-2 px-3">
                            ${s.restriction_status
                              ? html`<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                  ${icon(Ban, "xs")} Banned
                                  ${s.restriction_message ? html`<span class="opacity-70 ml-1">— ${s.restriction_message.slice(0, 30)}</span>` : ""}
                                </span>`
                              : html`<span class="text-xs text-muted-foreground">Bal: ${s.token_balance.toLocaleString()}</span>`}
                          </td>
                          <td class="py-2 px-3">
                            <span class="inline-flex items-center gap-1.5 text-xs">
                              <span class="w-2 h-2 rounded-full ${s.has_active_session ? "bg-green-500" : "bg-gray-400"}"></span>
                              ${s.has_active_session ? "Active" : "Offline"}
                            </span>
                          </td>
                          ${isAdmin
                            ? html`
                                <td class="py-2 px-3">
                                  <div class="flex gap-1 flex-wrap">
                                    ${this.editId === s.id
                                      ? html`
                                          ${Button({ variant: "default", size: "sm", children: html`${icon(Save, "xs")}`, onClick: () => this.saveEdit() })}
                                          ${Button({ variant: "ghost", size: "sm", children: html`${icon(X, "xs")}`, onClick: () => this.cancelEdit() })}
                                          ${this.editNewPassword !== ""
                                            ? Input({ type: "password", value: this.editNewPassword, placeholder: "New pwd", className: "w-20 text-xs",
                                                onChange: (e: Event) => { this.editNewPassword = (e.target as HTMLInputElement).value; } })
                                            : ""}
                                        `
                                      : html`
                                          ${Button({ variant: "ghost", size: "sm", children: html`${icon(Edit3, "xs")}`, onClick: () => this.startEdit(s) })}
                                          ${Button({ variant: "ghost", size: "sm", children: html`${icon(Coins, "xs")}`, onClick: () => this.toggleTokenPanel(s.id) })}
                                          ${Button({ variant: "ghost", size: "sm", children: html`${icon(Settings, "xs")}`, onClick: () => this.toggleModelPanel(s.id) })}
                                          ${s.restriction_status
                                            ? Button({ variant: "ghost", size: "sm", children: html`${icon(ShieldCheck, "xs")}`, onClick: () => this.doUnban(s.id), title: "Unban" })
                                            : Button({ variant: "ghost", size: "sm", children: html`${icon(Ban, "xs")}`, onClick: () => this.startBan(s), title: "Ban" })}
                                          ${Button({ variant: "ghost", size: "sm", children: html`${icon(Trash2, "xs")}`, onClick: () => this.deleteStudent(s.id) })}
                                        `}
                                  </div>
                                </td>
                              `
                            : ""}
                        </tr>

                        <!-- Token management expandable panel -->
                        ${this.tokenPanelStudentId === s.id
                          ? html`
                              <tr class="bg-muted/10">
                                <td colspan="7" class="p-4">
                                  <div class="grid grid-cols-2 gap-4">
                                    <div class="space-y-3">
                                      <h4 class="text-sm font-semibold text-foreground flex items-center gap-1">${icon(Coins, "xs")} Token Balance</h4>
                                      <div class="text-2xl font-bold text-amber-500">${this.tokenBalance != null ? this.tokenBalance.toLocaleString() : "—"}</div>
                                      <div class="flex gap-2 items-center">
                                        ${Input({ type: "number", value: this.topupAmount, placeholder: "Amount", className: "w-24",
                                          onChange: (e: Event) => { this.topupAmount = (e.target as HTMLInputElement).value; } })}
                                        ${Button({ variant: "default", size: "sm", children: "Add", onClick: () => this.doTopup(), disabled: this.loading })}
                                      </div>
                                      <div class="flex gap-2 items-center">
                                        ${Input({ type: "number", value: this.deductAmount, placeholder: "Amount", className: "w-24",
                                          onChange: (e: Event) => { this.deductAmount = (e.target as HTMLInputElement).value; } })}
                                        ${Button({ variant: "destructive", size: "sm", children: "Deduct", onClick: () => this.doDeduct(), disabled: this.loading })}
                                      </div>
                                      ${this.tokenUsage
                                        ? html`
                                            <div class="text-xs text-muted-foreground space-y-1">
                                              <p>Total tokens: ${(this.tokenUsage.total_input_tokens + this.tokenUsage.total_output_tokens).toLocaleString()}</p>
                                              <p>Turns: ${this.tokenUsage.turn_count}</p>
                                            </div>
                                          `
                                        : ""}
                                    </div>
                                    <div class="space-y-2">
                                      <h4 class="text-sm font-semibold text-foreground">Deduction History</h4>
                                      ${this.tokenDeductions.length === 0
                                        ? html`<p class="text-xs text-muted-foreground">No deductions</p>`
                                        : html`
                                            <div class="max-h-40 overflow-y-auto text-xs">
                                              <table class="w-full">
                                                <thead><tr class="text-muted-foreground"><th class="pr-2 text-left">Amount</th><th class="pr-2 text-left">Reason</th><th class="text-left">Date</th></tr></thead>
                                                <tbody>
                                                  ${this.tokenDeductions.map((d) => html`
                                                    <tr class="border-t border-border">
                                                      <td class="py-1 text-destructive">-${d.tokens_deducted.toLocaleString()}</td>
                                                      <td class="py-1">${d.model_name}</td>
                                                      <td class="py-1 text-muted-foreground">${new Date(d.recorded_at).toLocaleString()}</td>
                                                    </tr>
                                                  `)}
                                                </tbody>
                                              </table>
                                            </div>
                                          `}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            `
                          : ""}

                        <!-- Model access panel -->
                        ${this.modelPanelStudentId === s.id
                          ? html`
                              <tr class="bg-muted/10">
                                <td colspan="7" class="p-4">
                                  <div class="space-y-3">
                                    <h4 class="text-sm font-semibold text-foreground flex items-center gap-1">${icon(Settings, "xs")} Model Access</h4>
                                    <p class="text-xs text-muted-foreground">
                                      ${this.assignedModels.length === 0
                                        ? "All enabled models allowed"
                                        : `Restricted to ${this.assignedModels.length} of ${this.getEnabledModels().length} models`}
                                    </p>
                                    <div class="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                                      ${this.getEnabledModels().map((m) => {
                                        const checked = this.assignedModels.length === 0 || this.assignedModels.includes(m.name);
                                        return html`
                                          <label class="flex items-center gap-2 text-xs cursor-pointer p-1.5 rounded hover:bg-muted/50 ${checked ? "" : "opacity-50"}">
                                            <input type="checkbox" .checked=${checked} @change=${() => this.toggleModelAssign(m.name)} class="rounded" />
                                            <span>${m.display_name}</span>
                                            ${this.assignedModels.length > 0 && checked
                                              ? html`<span class="text-green-500 ml-auto">${icon(ShieldCheck, "xs")}</span>`
                                              : ""}
                                          </label>
                                        `;
                                      })}
                                    </div>
                                    <div class="flex gap-2">
                                      ${Button({ variant: "default", size: "sm", children: "Save Restrictions", onClick: () => this.saveModelRestrictions(), disabled: this.loading })}
                                      ${Button({ variant: "ghost", size: "sm", children: "Clear all (allow all)", onClick: async () => {
                                        this.assignedModels = [];
                                        await this.saveModelRestrictions();
                                      } })}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            `
                          : ""}

                        <!-- Ban / Unban panel -->
                        ${this.banStudentId === s.id
                          ? html`
                              <tr class="bg-muted/10">
                                <td colspan="7" class="p-4">
                                  <div class="space-y-3 max-w-md">
                                    <h4 class="text-sm font-semibold text-foreground flex items-center gap-1">${icon(Ban, "xs")} ${s.restriction_status ? "Edit Ban" : "Ban Student"}</h4>
                                    <div>
                                      <label class="block text-xs text-muted-foreground mb-1">Message (shown to student)</label>
                                      ${Input({ type: "text", value: this.banMessage, placeholder: "Reason or message shown to student", className: "w-full",
                                        onChange: (e: Event) => { this.banMessage = (e.target as HTMLInputElement).value; } })}
                                    </div>
                                    <div class="flex gap-2">
                                      ${s.restriction_status
                                        ? html`
                                            ${Button({ variant: "destructive", size: "sm", children: "Unban", onClick: () => this.doUnban(s.id), disabled: this.loading })}
                                            ${Button({ variant: "default", size: "sm", children: "Update Message", onClick: () => this.doBan(), disabled: this.loading })}
                                          `
                                        : html`
                                            ${Button({ variant: "destructive", size: "sm", children: "Ban", onClick: () => this.doBan(), disabled: this.loading })}
                                          `}
                                      ${Button({ variant: "ghost", size: "sm", children: "Cancel", onClick: () => this.cancelBan() })}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            `
                          : ""}
                      `)}
                    </tbody>
                  </table>
                </div>
              `}
      </div>
    `;
  }
}
