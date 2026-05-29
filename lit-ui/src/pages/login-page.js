var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import "../components/MatrixToggle.js";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { AlertCircle, GraduationCap, LogIn, User, UserPlus } from "lucide";
import { eduApi } from "../core/edu-api";
import { SessionManager } from "../core/session-manager";
import { classifyError, ErrorCode } from "../core/error-handler.js";
let LoginPage = class LoginPage extends LitElement {
    constructor() {
        super(...arguments);
        this.loading = false;
        this.error = "";
        this.showCreateAccount = false;
        this.cohorts = [];
        this.cohortsLoaded = false;
    }
    createRenderRoot() {
        return this;
    }
    async handleSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const username = form.querySelector('[name="username"]').value.trim();
        const password = form.querySelector('[name="password"]').value;
        this.error = "";
        this.loading = true;
        try {
            const auth = await eduApi.login(username, password);
            SessionManager.saveAuth(auth);
            this.dispatchEvent(new CustomEvent("login-success", {
                detail: auth,
                bubbles: true,
                composed: true,
            }));
        }
        catch (err) {
            const e = classifyError(err);
            switch (e.code) {
                case ErrorCode.NOT_FOUND:
                case ErrorCode.SESSION_NOT_FOUND:
                case ErrorCode.STUDENT_NOT_FOUND:
                    this.error = "Account not found. Create an account below.";
                    break;
                case ErrorCode.UNAUTHORIZED:
                case ErrorCode.JWT_EXPIRED:
                case ErrorCode.WRONG_PASSWORD:
                    this.error = "Invalid username or password.";
                    break;
                case ErrorCode.FORBIDDEN:
                case ErrorCode.ACCOUNT_RESTRICTED:
                case ErrorCode.RESTRICTED:
                    this.error = "Your account has been restricted. Please contact your administrator.";
                    break;
                default:
                    this.error = e.message || "Login failed";
            }
        }
        finally {
            this.loading = false;
        }
    }
    async loadCohorts() {
        if (this.cohortsLoaded)
            return;
        try {
            this.cohorts = await eduApi.listCohorts();
            this.cohortsLoaded = true;
        }
        catch {
            // Non-fatal — cohort list is optional
        }
    }
    async handleCreateAccount(e) {
        e.preventDefault();
        const form = e.target;
        const displayName = form.querySelector('[name="display_name"]').value.trim();
        const username = form.querySelector('[name="username"]').value.trim();
        const password = form.querySelector('[name="password"]').value;
        const confirmPassword = form.querySelector('[name="confirm_password"]').value;
        const cohortEl = form.querySelector('[name="cohort_id"]');
        const cohortId = cohortEl?.value || "";
        if (password !== confirmPassword) {
            this.error = "Passwords do not match";
            return;
        }
        if (!displayName || !username || !password) {
            this.error = "All fields are required";
            return;
        }
        this.error = "";
        this.loading = true;
        try {
            const auth = await eduApi.register(displayName, username, password, confirmPassword, cohortId);
            SessionManager.saveAuth(auth);
            this.dispatchEvent(new CustomEvent("login-success", {
                detail: auth,
                bubbles: true,
                composed: true,
            }));
        }
        catch (err) {
            const e = classifyError(err);
            if (e.code === ErrorCode.USERNAME_TAKEN) {
                this.error = "Username already taken. Choose another.";
            }
            else {
                this.error = e.message || "Registration failed";
            }
        }
        finally {
            this.loading = false;
        }
    }
    render() {
        return this.showCreateAccount
            ? this.renderCreateAccount()
            : this.renderLogin();
    }
    renderLogin() {
        return html `
      <div
        class="min-h-screen bg-background flex items-center justify-center p-6"
      >
        <div class="fixed top-4 right-4 z-50 flex items-center gap-1">
          <matrix-toggle></matrix-toggle>
          <theme-toggle></theme-toggle>
        </div>

        <div class="w-full max-w-md">
          <div class="text-center mb-10">
            <div
              class="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary text-primary-foreground mb-4 shadow-lg"
            >
              ${icon(GraduationCap, "md")}
            </div>
            <h1 class="text-3xl font-bold text-foreground tracking-tight">
              EduCraw
            </h1>
            <p class="text-muted-foreground mt-2 text-base">
              Your AI-powered learning tutor
            </p>
          </div>

          <div class="bg-card border border-border rounded-xl shadow-sm p-6">
            <h2
              class="text-xl font-semibold text-foreground mb-5 flex items-center gap-2"
            >
              <span class="w-1 h-6 bg-primary rounded-full"></span>
              Sign in
            </h2>

            <form
              @submit=${this.handleSubmit}
              class="space-y-4"
              autocomplete="off"
            >
              <div>
                <label class="block text-sm font-medium text-foreground mb-1.5"
                  >Username</label
                >
                <div class="relative">
                  <span
                    class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    ${icon(User, "sm")}
                  </span>
                  ${Input({
            name: "username",
            type: "text",
            placeholder: "your-username",
            className: "pl-10 w-full",
            required: true,
        })}
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-foreground mb-1.5"
                  >Password</label
                >
                ${Input({
            name: "password",
            type: "password",
            placeholder: "Enter your password",
            className: "w-full",
            required: true,
        })}
              </div>

              ${this.error
            ? html `
                    <div
                      class="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5 text-sm text-destructive"
                    >
                      ${icon(AlertCircle, "sm")}
                      <span>${this.error}</span>
                    </div>
                  `
            : ""}
              ${Button({
            type: "submit",
            variant: "default",
            size: "lg",
            className: "w-full",
            disabled: this.loading,
            children: this.loading
                ? html `<span class="flex items-center gap-2">Signing in…</span>`
                : html `<span class="flex items-center gap-2"
                      >${icon(LogIn, "sm")} Start Learning</span
                    >`,
        })}
            </form>

            <div class="mt-4 pt-4 border-t border-border text-center">
              <p class="text-sm text-muted-foreground mb-2">
                Don't have an account yet?
              </p>
              ${Button({
            variant: "outline",
            size: "sm",
            className: "w-full",
            children: html `<span class="flex items-center justify-center gap-2"
                  >${icon(UserPlus, "sm")} Create Account</span
                >`,
            onClick: async () => {
                this.showCreateAccount = true;
                this.error = "";
                await this.loadCohorts();
            },
        })}
            </div>
          </div>

          <p class="text-center text-muted-foreground text-sm mt-8 font-medium">
            EduCraw &middot; AI-Powered Learning Platform
          </p>
        </div>
      </div>
    `;
    }
    renderCreateAccount() {
        return html `
      <div
        class="min-h-screen bg-background flex items-center justify-center p-6"
      >
        <div class="fixed top-4 right-4 z-50 flex items-center gap-1">
          <matrix-toggle></matrix-toggle>
          <theme-toggle></theme-toggle>
        </div>

        <div class="w-full max-w-md">
          <div class="text-center mb-10">
            <div
              class="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary text-primary-foreground mb-4 shadow-lg"
            >
              ${icon(GraduationCap, "md")}
            </div>
            <h1 class="text-3xl font-bold text-foreground tracking-tight">
              EduCraw
            </h1>
            <p class="text-muted-foreground mt-2 text-base">
              Create your learning account
            </p>
          </div>

          <div class="bg-card border border-border rounded-xl shadow-sm p-6">
            <h2
              class="text-xl font-semibold text-foreground mb-5 flex items-center gap-2"
            >
              <span class="w-1 h-6 bg-primary rounded-full"></span>
              Create Account
            </h2>

            <form class="space-y-4" autocomplete="off" @submit=${this.handleCreateAccount}>
              <div>
                <label class="block text-sm font-medium text-foreground mb-1.5"
                  >Full Name</label
                >
                ${Input({
            name: "display_name",
            type: "text",
            placeholder: "Your full name",
            className: "w-full",
            required: true,
        })}
              </div>
              <div>
                <label class="block text-sm font-medium text-foreground mb-1.5"
                  >Username</label
                >
                <div class="relative">
                  <span
                    class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    ${icon(User, "sm")}
                  </span>
                  ${Input({
            name: "username",
            type: "text",
            placeholder: "Choose a username",
            className: "pl-10 w-full",
            required: true,
        })}
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-foreground mb-1.5"
                  >Password</label
                >
                ${Input({
            name: "password",
            type: "password",
            placeholder: "Create a password",
            className: "w-full",
            required: true,
        })}
              </div>
              <div>
                <label class="block text-sm font-medium text-foreground mb-1.5"
                  >Confirm Password</label
                >
                ${Input({
            name: "confirm_password",
            type: "password",
            placeholder: "Confirm your password",
            className: "w-full",
            required: true,
        })}
              </div>

              ${this.cohorts.length > 0
            ? html `
                    <div>
                      <label class="block text-sm font-medium text-foreground mb-1.5"
                        >Cohort (optional)</label
                      >
                      <select
                        name="cohort_id"
                        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary"
                      >
                        <option value="">I'll decide later</option>
                        ${this.cohorts.map((c) => html `<option value=${c.id}>${c.title}</option>`)}
                      </select>
                    </div>
                  `
            : ""}

              ${this.error
            ? html `
                    <div
                      class="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5 text-sm text-destructive"
                    >
                      ${icon(AlertCircle, "sm")}
                      <span>${this.error}</span>
                    </div>
                  `
            : ""}
              ${Button({
            type: "submit",
            variant: "default",
            size: "lg",
            className: "w-full",
            disabled: this.loading,
            children: this.loading
                ? html `<span class="flex items-center gap-2">Creating account…</span>`
                : html `<span class="flex items-center gap-2"
                      >Create Account</span
                    >`,
        })}
            </form>

            <div class="mt-4 pt-4 border-t border-border text-center">
              <p class="text-sm text-muted-foreground mb-2">
                Already have an account?
              </p>
              ${Button({
            variant: "ghost",
            size: "sm",
            className: "w-full",
            children: "Back to Sign In",
            onClick: () => {
                this.showCreateAccount = false;
                this.error = "";
            },
        })}
            </div>
          </div>

          <p class="text-center text-muted-foreground text-sm mt-8 font-medium">
            EduCraw &middot; AI-Powered Learning Platform
          </p>
        </div>
      </div>
    `;
    }
};
__decorate([
    state()
], LoginPage.prototype, "loading", void 0);
__decorate([
    state()
], LoginPage.prototype, "error", void 0);
__decorate([
    state()
], LoginPage.prototype, "showCreateAccount", void 0);
__decorate([
    state()
], LoginPage.prototype, "cohorts", void 0);
__decorate([
    state()
], LoginPage.prototype, "cohortsLoaded", void 0);
LoginPage = __decorate([
    customElement("login-page")
], LoginPage);
export { LoginPage };
