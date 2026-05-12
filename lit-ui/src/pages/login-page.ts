import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  AlertCircle,
  GraduationCap,
  LogIn,
  Shield,
  User,
  ChevronDown,
} from "lucide";
import { eduApi } from "../core/edu-api";
import { SessionManager } from "../core/session-manager";
import type { LoginResponse } from "../core/edu-types";

type StaffMode = "login" | "bootstrap";

@customElement("login-page")
export class LoginPage extends LitElement {
  @state() private loading = false;
  @state() private error = "";
  @state() private staffOpen = false;
  @state() private staffMode: StaffMode = "login";

  private async handleStudentSubmit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const username = (
      form.querySelector('[name="username"]') as HTMLInputElement
    ).value.trim();
    const password = (
      form.querySelector('[name="password"]') as HTMLInputElement
    ).value;

    this.error = "";
    this.loading = true;

    try {
      const auth = await eduApi.login(username, password);
      SessionManager.saveAuth(auth);
      this.dispatchEvent(
        new CustomEvent("login-success", {
          detail: auth,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Login failed";
    } finally {
      this.loading = false;
    }
  }

  private async handleStaffLogin(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const username = (
      form.querySelector('[name="s_username"]') as HTMLInputElement
    ).value.trim();
    const password = (
      form.querySelector('[name="s_password"]') as HTMLInputElement
    ).value;

    this.error = "";
    this.loading = true;

    try {
      const auth = await eduApi.login(username, password);
      SessionManager.saveAuth(auth);
      this.dispatchEvent(
        new CustomEvent("login-success", {
          detail: auth,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Login failed";
    } finally {
      this.loading = false;
    }
  }

  private async handleBootstrap(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const secret = (form.querySelector('[name="secret"]') as HTMLInputElement)
      .value;

    this.error = "";
    this.loading = true;

    try {
      const { token } = await eduApi.bootstrapToken(secret);
      const auth: LoginResponse = {
        token,
        student_id: "admin",
        display_name: "Administrator",
        role: "admin",
        cohort_id: "",
        subject_ids: [],
      };
      SessionManager.saveAuth(auth);
      this.dispatchEvent(
        new CustomEvent("login-success", {
          detail: auth,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Invalid secret";
    } finally {
      this.loading = false;
    }
  }

  private toggleStaff() {
    this.staffOpen = !this.staffOpen;
    this.error = "";
  }

  render() {
    return html`
      <div
        class="min-h-screen bg-background flex items-center justify-center p-6"
      >
        <div class="w-full max-w-md">
          <!-- Brand -->
          <div class="text-center mb-10">
            <div
              class="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary text-primary-foreground mb-4 shadow-lg"
            >
              ${icon(GraduationCap, "md")}
            </div>
            <h1 class="text-3xl font-bold text-foreground tracking-tight">
              EduCrawl
            </h1>
            <p class="text-muted-foreground mt-2 text-base">
              Your AI-powered learning tutor
            </p>
          </div>

          <!-- Login card -->
          <div class="bg-card border border-border rounded-xl shadow-sm p-6">
            <h2
              class="text-xl font-semibold text-foreground mb-5 flex items-center gap-2"
            >
              <span class="w-1 h-6 bg-primary rounded-full"></span>
              Sign in to learn
            </h2>

            <form
              @submit=${this.handleStudentSubmit}
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
                ? html`
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
                  ? html`<span class="flex items-center gap-2"
                      >Connecting…</span
                    >`
                  : html`<span class="flex items-center gap-2"
                      >${icon(LogIn, "sm")} Start Learning</span
                    >`,
              })}
            </form>
          </div>

          <!-- Staff access -->
          <div class="mt-4">
            <button
              @click=${this.toggleStaff}
              class="w-full text-sm text-muted-foreground hover:text-primary transition-colors font-medium flex items-center justify-center gap-1.5 py-2"
            >
              <span
                class="${this.staffOpen
                  ? "rotate-180"
                  : ""} transition-transform inline-block"
                >${icon(ChevronDown, "xs")}</span
              >
              ${this.staffOpen ? "Close staff access" : "Staff access"}
            </button>

            ${this.staffOpen
              ? html`
                  <div
                    class="mt-2 bg-card border border-border rounded-xl shadow-sm p-5"
                  >
                    <!-- Tab toggle -->
                    <div class="flex gap-2 mb-4">
                      <button
                        @click=${() => {
                          this.staffMode = "login";
                          this.error = "";
                        }}
                        class="flex-1 py-2 text-sm rounded-md font-medium transition-all
                          ${this.staffMode === "login"
                          ? "bg-primary text-primary-foreground shadow"
                          : "bg-secondary text-foreground hover:bg-secondary/80"}"
                      >
                        Sign in
                      </button>
                      <button
                        @click=${() => {
                          this.staffMode = "bootstrap";
                          this.error = "";
                        }}
                        class="flex-1 py-2 text-sm rounded-md font-medium transition-all
                          ${this.staffMode === "bootstrap"
                          ? "bg-primary text-primary-foreground shadow"
                          : "bg-secondary text-foreground hover:bg-secondary/80"}"
                      >
                        First-time setup
                      </button>
                    </div>

                    ${this.staffMode === "login"
                      ? html`
                          <form
                            @submit=${this.handleStaffLogin}
                            class="space-y-3"
                            autocomplete="off"
                          >
                            <div>
                              <label
                                class="block text-sm font-medium text-foreground mb-1.5"
                                >Staff username</label
                              >
                              ${Input({
                                name: "s_username",
                                type: "text",
                                placeholder: "username",
                                className: "w-full",
                                required: true,
                              })}
                            </div>
                            <div>
                              <label
                                class="block text-sm font-medium text-foreground mb-1.5"
                                >Password</label
                              >
                              ${Input({
                                name: "s_password",
                                type: "password",
                                placeholder: "password",
                                className: "w-full",
                                required: true,
                              })}
                            </div>
                            ${Button({
                              type: "submit",
                              variant: "default",
                              className: "w-full",
                              disabled: this.loading,
                              children: this.loading
                                ? "Signing in…"
                                : "Sign in as Staff",
                            })}
                          </form>
                        `
                      : html`
                          <form
                            @submit=${this.handleBootstrap}
                            class="space-y-3"
                          >
                            <div
                              class="bg-secondary rounded-lg p-3 text-sm text-muted-foreground"
                            >
                              <div class="flex items-start gap-2">
                                ${icon(Shield, "sm")}
                                <span
                                  >Enter the
                                  <code
                                    class="font-mono bg-background px-1.5 py-0.5 rounded text-foreground text-xs"
                                    >ADMIN_SECRET</code
                                  >
                                  to access the admin panel.</span
                                >
                              </div>
                            </div>
                            ${Input({
                              name: "secret",
                              type: "password",
                              placeholder: "Admin secret",
                              className: "w-full",
                              required: true,
                            })}
                            ${Button({
                              type: "submit",
                              variant: "default",
                              className: "w-full",
                              disabled: this.loading,
                              children: this.loading
                                ? "Verifying…"
                                : "Open Admin Panel",
                            })}
                          </form>
                        `}
                  </div>
                `
              : ""}
          </div>

          <p class="text-center text-muted-foreground text-sm mt-8 font-medium">
            EduCrawl &middot; AI-Powered Learning Platform
          </p>
        </div>
      </div>
    `;
  }
}
