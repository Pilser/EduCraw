import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { MenuTab } from "./MenuDialog.js";
import { eduApi } from "../core/edu-api.js";
import type { Cohort, LoginResponse, MeResponse } from "../core/edu-types.js";

@customElement("account-tab")
export class AccountTab extends MenuTab {
    @property({ type: String }) sessionId = "";
    @property({ type: String }) sessionToken = "";
    @property({ type: String }) studentToken = "";
    @property({ type: Object, attribute: false }) auth?: LoginResponse;
    @property({ type: Function }) onLogout?: () => void;
    @property({ type: Function, attribute: false }) onProfileUpdate?: (auth: LoginResponse) => void;

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

    // Redeem code
    @state() private redeemLoading = false;
    @state() private redeemError = "";
    @state() private redeemSuccess = "";

    async updated(changedProperties: Map<string, any>) {
        super.updated(changedProperties);

        if (!this.initialized && this.sessionId && this.sessionToken && this.studentToken) {
            console.log("[AccountTab] Loading account data");
            this.initialized = true;
            await Promise.all([this.loadProfile()]);
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

    // Redeem code helpers
    private handleCodeKeydown(e: KeyboardEvent) {
        if (e.ctrlKey || e.metaKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab' || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter') return;
        if (!/^[A-Za-z0-9]$/.test(e.key)) e.preventDefault();
    }
    private handleCodeSegment(e: Event, nextId: string | null) {
        const input = e.target as HTMLInputElement;
        input.value = input.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4);
        if (input.value.length === 4 && nextId) {
            (this.querySelector('#' + nextId) as HTMLInputElement)?.focus();
        }
        this.requestUpdate();
    }
    private buildRedeemCode(): string {
        const s1 = (this.querySelector('#code-s1') as HTMLInputElement)?.value || '';
        const s2 = (this.querySelector('#code-s2') as HTMLInputElement)?.value || '';
        const s3 = (this.querySelector('#code-s3') as HTMLInputElement)?.value || '';
        return 'EDU-' + s1 + '-' + s2 + '-' + s3;
    }
    private clearRedeemInputs() {
        ['code-s1', 'code-s2', 'code-s3'].forEach(id => {
            const el = this.querySelector('#' + id) as HTMLInputElement;
            if (el) el.value = '';
        });
    }
    private async doRedeemCode() {
        const code = this.buildRedeemCode();
        if (code.length < 18 || !this.studentToken) return;
        this.redeemError = '';
        this.redeemSuccess = '';
        this.redeemLoading = true;
        try {
            const res = await fetch('/me/redeem-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.studentToken },
                body: JSON.stringify({ code }),
            });
            const data = await res.json().catch(() => ({ error: 'Invalid code' }));
            if (!res.ok) throw new Error(data.error || 'Redeem failed');
            this.redeemSuccess = '+' + data.tokens_added.toLocaleString() + ' tokens! Balance: ' + data.new_balance.toLocaleString();
            this.clearRedeemInputs();
            await this.loadProfile();
        } catch (err) {
            this.redeemError = err instanceof Error ? err.message : 'Redeem failed';
        } finally {
            this.redeemLoading = false;
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

                <!-- Token Balance & Redeem -->
                <div class="space-y-4 text-center">
                    ${this.profile
                        ? html`
                            <div>
                                <span class="text-sm text-muted-foreground">Available Balance</span>
                                <div class="text-3xl font-bold text-amber-500">${this.profile.token_balance.toLocaleString()}</div>
                            </div>
                        `
                        : ""}
                    <div class="space-y-3">
                        <div class="flex items-center gap-1 justify-center">
                            <span class="font-mono text-sm font-semibold bg-muted px-3 py-2 rounded-md border border-border text-foreground">EDU</span>
                            <span class="text-muted-foreground font-mono">-</span>
                            <input id="code-s1" type="text" class="w-16 font-mono uppercase text-center rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary" maxlength="4" @input=${(e: Event) => this.handleCodeSegment(e, "code-s2")} @keydown=${(e: KeyboardEvent) => this.handleCodeKeydown(e)} />
                            <span class="text-muted-foreground font-mono">-</span>
                            <input id="code-s2" type="text" class="w-16 font-mono uppercase text-center rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary" maxlength="4" @input=${(e: Event) => this.handleCodeSegment(e, "code-s3")} @keydown=${(e: KeyboardEvent) => this.handleCodeKeydown(e)} />
                            <span class="text-muted-foreground font-mono">-</span>
                            <input id="code-s3" type="text" class="w-16 font-mono uppercase text-center rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary" maxlength="4" @input=${(e: Event) => this.handleCodeSegment(e, null)} @keydown=${(e: KeyboardEvent) => { this.handleCodeKeydown(e); if (e.key === "Enter") this.doRedeemCode(); }} />
                        </div>
                        ${Button({
                            variant: "default",
                            size: "lg",
                            children: this.redeemLoading ? "Adding..." : "Add Token",
                            disabled: this.redeemLoading || this.buildRedeemCode().length < 18,
                            onClick: () => this.doRedeemCode(),
                            className: "w-full max-w-xs mx-auto",
                        })}
                        ${this.redeemError
                            ? html`<div class="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">${this.redeemError}</div>`
                            : ""}
                        ${this.redeemSuccess
                            ? html`<div class="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">${this.redeemSuccess}</div>`
                            : ""}
                    </div>
                </div>

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
