import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LogOut, Shield } from "lucide";
import "../tabs/StudentsTab.js";
import "../tabs/CohortsTab.js";
import "../tabs/SubjectsTab.js";
import "../tabs/SessionsTab.js";
import "../tabs/ModelsTab.js";
import "../tabs/TokenCodesTab.js";

type TabName =
  | "students"
  | "cohorts"
  | "subjects"
  | "sessions"
  | "models"
  | "token-codes";


interface TabDef {
  id: TabName;
  label: string;
}

const TABS: TabDef[] = [
  { id: "students", label: "Students" },
  { id: "cohorts", label: "Cohorts" },
  { id: "subjects", label: "Subjects" },
  { id: "sessions", label: "Live Sessions" },
  { id: "models", label: "AI Models" },
  { id: "token-codes", label: "Token Codes" },
];

@customElement("admin-dashboard")
export class AdminDashboard extends LitElement {
  @property({ type: String }) token = "";
  @property({ type: String }) role = "";
  @property({ type: String }) displayName = "";
  @property({ type: Function, attribute: false }) onLogout?: () => void;

  @state() private activeTab: TabName = "students";

  protected createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="min-h-screen bg-background">
        <header
          class="border-b border-border bg-card"
        >
          <div
            class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between"
          >
            <div class="flex items-center gap-3">
              <div
                class="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground"
              >
                ${icon(Shield, "sm")}
              </div>
              <span class="font-semibold text-foreground">EduCraw Admin</span>
              <span
                class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize"
                >${this.role}</span
              >
            </div>
            <div class="flex items-center gap-3">
              <span class="text-sm text-muted-foreground"
                >${this.displayName}</span
              >
              ${Button({
                variant: "ghost",
                size: "sm",
                children: html`<span class="flex items-center gap-1"
                  >${icon(LogOut, "xs")} Sign Out</span
                >`,
                onClick: () => this.onLogout?.(),
              })}
            </div>
          </div>
        </header>

        <div
          class="max-w-7xl mx-auto px-4"
        >
          <nav
            class="flex gap-1 pt-4 pb-2 overflow-x-auto"
          >
            ${TABS.map(
              (tab) => html`
                <button
                  class="px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${this
                    .activeTab === tab.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"}"
                  @click=${() => {
                    this.activeTab = tab.id;
                  }}
                >
                  ${tab.label}
                </button>
              `,
            )}
          </nav>

          <div class="py-4">
            ${this.renderActiveTab()}
          </div>
        </div>
      </div>
    `;
  }

  private renderActiveTab() {
    const t = this.token;
    const r = this.role;
    switch (this.activeTab) {
      case "students":
        return html`<students-tab .token=${t} .role=${r}></students-tab>`;
      case "cohorts":
        return html`<cohorts-tab .token=${t} .role=${r}></cohorts-tab>`;
      case "subjects":
        return html`<subjects-tab .token=${t} .role=${r}></subjects-tab>`;
      case "sessions":
        return html`<sessions-tab .token=${t} .role=${r}></sessions-tab>`;
      case "models":
        return html`<models-tab .token=${t} .role=${r}></models-tab>`;
      case "token-codes":
        return html`<token-codes-tab .token=${t} .role=${r}></token-codes-tab>`;
    }
  }
}
