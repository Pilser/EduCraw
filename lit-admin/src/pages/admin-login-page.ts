import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { AlertCircle, GraduationCap, LogIn, Shield } from "lucide";
import { adminApi } from "../core/admin-api";
import type { LoginResponse } from "../core/admin-types";

@customElement("admin-login-page")
export class AdminLoginPage extends LitElement {
  @state() private loading = false;
  @state() private error = "";
  @state() private mode: "login" | "bootstrap" = "login";

  protected createRenderRoot() {
    return this;
  }

  private async handleLogin(e: Event) {
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
      const auth = await adminApi.login(username, password);
      if (auth.role !== "admin" && auth.role !== "teacher") {
        this.error =
          "Access denied. This portal is for staff accounts only (admin or teacher).";
        this.loading = false;
        return;
      }
      this.dispatchEvent(
        new CustomEvent("admin-login", {
          detail: auth,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      if (msg.includes("401") || msg.includes("invalid")) {
        this.error = "Invalid username or password.";
      } else {
        this.error = msg;
      }
    } finally {
      this.loading = false;
    }
  }

  private async handleBootstrap(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const secret = (
      form.querySelector('[name="secret"]') as HTMLInputElement
    ).value.trim();

    this.error = "";
    this.loading = true;

    try {
      const { token } = await adminApi.bootstrapToken(secret);
      const auth: LoginResponse = {
        token,
        student_id: "admin",
        display_name: "Admin",
        role: "admin",
        cohort_id: "",
        subject_ids: [],
      };
      this.dispatchEvent(
        new CustomEvent("admin-login", {
          detail: auth,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bootstrap failed";
      if (msg.includes("401")) {
        this.error = "Invalid admin secret.";
      } else {
        this.error = msg;
      }
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html`
      <div
        class="min-h-screen bg-background flex items-center justify-center p-6"
      >
        <div class="fixed top-4 right-4 z-50 flex items-center gap-1">
          <theme-toggle></theme-toggle>
        </div>

        <div class="w-full max-w-md">
          <div class="text-center mb-10">
            <div
              class="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary text-primary-foreground mb-4 shadow-lg"
            >
              ${icon(Shield, "md")}
            </div>
            <h1 class="text-3xl font-bold text-foreground tracking-tight">
              EduCraw Admin
            </h1>
            <p class="text-muted-foreground mt-2 text-base">
              Staff Portal
            </p>
          </div>

          <div class="bg-card border border-border rounded-xl shadow-sm p-6">
            <div class="flex border-b border-border mb-5">
              <button
                class="flex-1 pb-3 text-sm font-medium transition-colors ${this
                  .mode === "login"
                  ? "text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"}"
                @click=${() => {
                  this.mode = "login";
                  this.error = "";
                }}
              >
                Sign In
              </button>
              <button
                class="flex-1 pb-3 text-sm font-medium transition-colors ${this
                  .mode === "bootstrap"
                  ? "text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"}"
                @click=${() => {
                  this.mode = "bootstrap";
                  this.error = "";
                }}
              >
                First-time Setup
              </button>
            </div>

            ${this.mode === "login" ? this.renderLogin() : this.renderBootstrap()}
          </div>

          <p class="text-center text-muted-foreground text-sm mt-8 font-medium">
            EduCraw &middot; Admin Portal
          </p>
        </div>
      </div>
    `;
  }

  private renderLogin() {
    return html`
      <h2
        class="text-xl font-semibold text-foreground mb-5 flex items-center gap-2"
      >
        <span class="w-1 h-6 bg-primary rounded-full"></span>
        Staff Sign In
      </h2>

      <form @submit=${this.handleLogin} class="space-y-4" autocomplete="off">
        <div>
          <label class="block text-sm font-medium text-foreground mb-1.5"
            >Username</label
          >
          ${Input({
            name: "username",
            type: "text",
            placeholder: "Staff username",
            className: "w-full",
            required: true,
          })}
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
            ? html`<span class="flex items-center gap-2">Signing in…</span>`
            : html`<span class="flex items-center gap-2"
                >${icon(LogIn, "sm")} Sign In</span
              >`,
        })}
      </form>
    `;
  }

  private renderBootstrap() {
    return html`
      <h2
        class="text-xl font-semibold text-foreground mb-5 flex items-center gap-2"
      >
        <span class="w-1 h-6 bg-primary rounded-full"></span>
        First-time Setup
      </h2>

      <p class="text-sm text-muted-foreground mb-4">
        Use the admin secret from the server's .env file to generate an initial admin token.
      </p>

      <form
        @submit=${this.handleBootstrap}
        class="space-y-4"
        autocomplete="off"
      >
        <div>
          <label class="block text-sm font-medium text-foreground mb-1.5"
            >Admin Secret</label
          >
          ${Input({
            name: "secret",
            type: "password",
            placeholder: "ADMIN_SECRET value",
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
            ? html`<span class="flex items-center gap-2">Generating token…</span>`
            : html`<span class="flex items-center gap-2"
                >Generate Admin Token</span
              >`,
        })}
      </form>
    `;
  }
}
