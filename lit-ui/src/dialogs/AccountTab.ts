import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { MenuTab } from "./MenuDialog.js";
import { eduApi } from "../core/edu-api.js";
import type { Cohort, LoginResponse, MeResponse, TokenUsage } from "../core/edu-types.js";

@customElement("account-tab")
export class AccountTab extends MenuTab {
    @property({ type: String }) sessionId = "";
    @property({ type: String }) sessionToken = "";
    @property({ type: String }) studentToken = "";
    @property({ type: Object, attribute: false }) auth?: LoginResponse;
    @property({ type: Function }) onLogout?: () => void;
    @property({ type: Function, attribute: false }) onProfileUpdate?: (auth: LoginResponse) => void;

    @state() private tokenUsage?: TokenUsage;
    @state() private profile?: MeResponse;
    @state() private loading = false;
    @state() private error = "";
    @state() private success = "";
    @state() private initialized = false;

    // Editing state
    @state() private editing = false;
    @state() private editDisplayName = "";
    @state() private editCohortId = "";
    @state() private editCurrentPassword = "";
    @state() private editNewPassword = "";
    @state() private editConfirmPassword = "";

    async updated(changedProperties: Map<string, any>) {
        super.updated(changedProperties);

        if (!this.initialized && this.sessionId && this.sessionToken && this.studentToken) {
            console.log("[AccountTab] Loading account data");
            this.initialized = true;
            await Promise.all([this.loadTokenUsage(), this.loadProfile()]);
        }
    }

    private async loadTokenUsage() {
        if (!this.sessionId || !this.sessionToken) return;
        this.loading = true;
        try {
            this.tokenUsage = await eduApi.getSessionTokenUsage(
                this.sessionId,
                this.sessionToken
            );
        } catch (err) {
            console.error("[AccountTab] Failed to load token usage:", err);
        } finally {
            this.loading = false;
            this.requestUpdate();
        }
    }

    private async loadProfile() {
        if (!this.studentToken) return;
        try {
            this.profile = await eduApi.getMe(this.studentToken);
            this.editDisplayName = this.profile.display_name;
            this.editCohortId = this.profile.cohort_id;
        } catch (err) {
            console.error("[AccountTab] Failed to load profile:", err);
            this.error = err instanceof Error ? err.message : "Failed to load profile";
        } finally {
            this.requestUpdate();
        }
    }

    private startEditing() {
        if (!this.profile) return;
        this.editing = true;
        this.editDisplayName = this.profile.display_name;
        this.editCohortId = this.profile.cohort_id;
        this.editCurrentPassword = "";
        this.editNewPassword = "";
        this.editConfirmPassword = "";
        this.error = "";
        this.success = "";
    }

    private cancelEditing() {
        this.editing = false;
        this.error = "";
        this.success = "";
    }

    private async saveProfile() {
        if (!this.studentToken || !this.profile) return;
        this.error = "";
        this.success = "";
        this.loading = true;

        const body: Record<string, string> = {};

        if (this.editDisplayName.trim() !== this.profile.display_name) {
            body.display_name = this.editDisplayName.trim();
        }
        if (this.editCohortId !== this.profile.cohort_id) {
            body.cohort_id = this.editCohortId;
        }

        // Password change
        if (this.editNewPassword) {
            if (this.editNewPassword !== this.editConfirmPassword) {
                this.error = "New passwords do not match";
                this.loading = false;
                return;
            }
            if (this.editNewPassword.length < 6) {
                this.error = "New password must be at least 6 characters";
                this.loading = false;
                return;
            }
            if (!this.editCurrentPassword) {
                this.error = "Current password is required to change password";
                this.loading = false;
                return;
            }
            body.current_password = this.editCurrentPassword;
            body.new_password = this.editNewPassword;
        }

        if (Object.keys(body).length === 0) {
            this.editing = false;
            this.loading = false;
            return;
        }

        try {
            const result = await eduApi.updateMe(this.studentToken, body);

            // Update auth with new token and data
            if (this.auth && this.onProfileUpdate) {
                this.onProfileUpdate({
                    ...this.auth,
                    token: result.token,
                    cohort_id: result.cohort_id,
                    subject_ids: result.subject_ids,
                    display_name: result.display_name,
                });
            }

            // Reload profile
            await this.loadProfile();
            this.editing = false;
            this.success = "Profile updated successfully";
        } catch (err) {
            this.error = err instanceof Error ? err.message : "Failed to update profile";
        } finally {
            this.loading = false;
            this.requestUpdate();
        }
    }

    private handleLogout() {
        if (this.onLogout) {
            this.onLogout();
        }
    }

    getTabName(): string {
        return "Account";
    }

    render(): TemplateResult {
        return html`
            <div class="flex flex-col gap-6">
                ${this.error
                    ? html`<div class="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">${this.error}</div>`
                    : ""}
                ${this.success
                    ? html`<div class="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">${this.success}</div>`
                    : ""}

                <!-- Profile Section -->
                <div class="space-y-3">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-semibold text-foreground">Profile</h3>
                        ${!this.editing
                            ? Button({
                                variant: "outline",
                                size: "sm",
                                children: "Edit",
                                onClick: () => this.startEditing(),
                            })
                            : ""}
                    </div>

                    ${this.profile
                        ? this.editing
                            ? html`
                                <div class="space-y-4">
                                    <div>
                                        <label class="block text-sm font-medium text-foreground mb-1">Display Name</label>
                                        ${Input({
                                            type: "text",
                                            value: this.editDisplayName,
                                            className: "w-full",
                                            onChange: (e: Event) => {
                                                this.editDisplayName = (e.target as HTMLInputElement).value;
                                            },
                                        })}
                                    </div>
                                    <div>
                                        <label class="block text-sm font-medium text-foreground mb-1">Username</label>
                                        ${Input({
                                            type: "text",
                                            value: this.profile.username,
                                            className: "w-full",
                                            disabled: true,
                                        })}
                                        <p class="text-xs text-muted-foreground mt-1">Username cannot be changed</p>
                                    </div>
                                    <div>
                                        <label class="block text-sm font-medium text-foreground mb-1">Cohort</label>
                                        <select
                                            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary"
                                            @change=${(e: Event) => {
                                                this.editCohortId = (e.target as HTMLSelectElement).value;
                                            }}
                                        >
                                            <option value="" ?selected=${this.editCohortId === ""}>I'll decide later</option>
                                            ${this.profile.available_cohorts.map(
                                                (c: Cohort) => html`<option value=${c.id} ?selected=${this.editCohortId === c.id}>${c.title}</option>`,
                                            )}
                                        </select>
                                    </div>

                                    <!-- Password Change -->
                                    <div class="pt-3 border-t border-border">
                                        <p class="text-sm font-medium text-foreground mb-3">Change Password (optional)</p>
                                        <div class="space-y-3">
                                            <div>
                                                <label class="block text-sm text-foreground mb-1">Current Password</label>
                                                ${Input({
                                                    type: "password",
                                                    value: this.editCurrentPassword,
                                                    placeholder: "Current password",
                                                    className: "w-full",
                                                    onChange: (e: Event) => {
                                                        this.editCurrentPassword = (e.target as HTMLInputElement).value;
                                                    },
                                                })}
                                            </div>
                                            <div>
                                                <label class="block text-sm text-foreground mb-1">New Password</label>
                                                ${Input({
                                                    type: "password",
                                                    value: this.editNewPassword,
                                                    placeholder: "New password (6+ chars)",
                                                    className: "w-full",
                                                    onChange: (e: Event) => {
                                                        this.editNewPassword = (e.target as HTMLInputElement).value;
                                                    },
                                                })}
                                            </div>
                                            <div>
                                                <label class="block text-sm text-foreground mb-1">Confirm New Password</label>
                                                ${Input({
                                                    type: "password",
                                                    value: this.editConfirmPassword,
                                                    placeholder: "Confirm new password",
                                                    className: "w-full",
                                                    onChange: (e: Event) => {
                                                        this.editConfirmPassword = (e.target as HTMLInputElement).value;
                                                    },
                                                })}
                                            </div>
                                        </div>
                                    </div>

                                    <div class="flex gap-2">
                                        ${Button({
                                            variant: "default",
                                            size: "sm",
                                            children: this.loading ? "Saving…" : "Save Changes",
                                            disabled: this.loading,
                                            onClick: () => this.saveProfile(),
                                        })}
                                        ${Button({
                                            variant: "ghost",
                                            size: "sm",
                                            children: "Cancel",
                                            disabled: this.loading,
                                            onClick: () => this.cancelEditing(),
                                        })}
                                    </div>
                                </div>
                            `
                            : html`
                                <div class="space-y-3">
                                    <div class="flex flex-col gap-1">
                                        <span class="text-sm text-muted-foreground">Display Name</span>
                                        <span class="text-foreground font-medium">${this.profile.display_name}</span>
                                    </div>
                                    <div class="flex flex-col gap-1">
                                        <span class="text-sm text-muted-foreground">Username</span>
                                        <span class="text-foreground font-medium">${this.profile.username}</span>
                                    </div>
                                    <div class="flex flex-col gap-1">
                                        <span class="text-sm text-muted-foreground">Cohort</span>
                                        <span class="text-foreground font-medium"
                                            >${this.profile.cohort_title || "Not assigned"}</span
                                        >
                                    </div>
                                    <div class="flex flex-col gap-1">
                                        <span class="text-sm text-muted-foreground">Role</span>
                                        <span class="text-foreground font-medium capitalize">${this.profile.role}</span>
                                    </div>
                                </div>
                            `
                        : html`<div class="text-sm text-muted-foreground">Loading profile...</div>`}
                </div>

                <!-- Token Usage Section -->
                <div class="space-y-3 pt-4 border-t border-border">
                    <h3 class="text-lg font-semibold text-foreground">Token Usage</h3>

                    ${this.loading && !this.tokenUsage
                        ? html`<div class="text-sm text-muted-foreground">Loading...</div>`
                        : this.tokenUsage
                            ? html`
                                <div class="grid grid-cols-2 gap-4">
                                    <div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
                                        <span class="text-sm text-muted-foreground">Total Tokens</span>
                                        <span class="text-2xl font-bold text-foreground">${(this.tokenUsage.total_input_tokens + this.tokenUsage.total_output_tokens).toLocaleString()}</span>
                                    </div>
                                    <div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
                                        <span class="text-sm text-muted-foreground">Turns</span>
                                        <span class="text-2xl font-bold text-foreground">${this.tokenUsage.turn_count}</span>
                                    </div>
                                    <div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
                                        <span class="text-sm text-muted-foreground">Input Tokens</span>
                                        <span class="text-lg font-semibold text-foreground">${this.tokenUsage.total_input_tokens.toLocaleString()}</span>
                                    </div>
                                    <div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
                                        <span class="text-sm text-muted-foreground">Output Tokens</span>
                                        <span class="text-lg font-semibold text-foreground">${this.tokenUsage.total_output_tokens.toLocaleString()}</span>
                                    </div>
                                    <div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
                                        <span class="text-sm text-muted-foreground">Cache Creation</span>
                                        <span class="text-lg font-semibold text-foreground">${this.tokenUsage.total_cache_creation_tokens.toLocaleString()}</span>
                                    </div>
                                    <div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
                                        <span class="text-sm text-muted-foreground">Cache Read</span>
                                        <span class="text-lg font-semibold text-foreground">${this.tokenUsage.total_cache_read_tokens.toLocaleString()}</span>
                                    </div>
                                </div>
                            `
                            : html`<div class="text-sm text-muted-foreground">No usage data available</div>`
                    }

                    ${!this.loading && this.tokenUsage
                        ? Button({
                            variant: "ghost",
                            size: "sm",
                            children: "Refresh",
                            onClick: () => this.loadTokenUsage(),
                            className: "mt-2",
                        })
                        : ""
                    }
                </div>

                <!-- Logout Section -->
                <div class="pt-4 border-t border-border">
                    ${Button({
                        variant: "destructive",
                        children: "Logout",
                        onClick: () => this.handleLogout(),
                        className: "w-full",
                    })}
                </div>
            </div>
        `;
    }
}
