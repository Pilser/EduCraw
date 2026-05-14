import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("landing-banner")
export class LandingBanner extends LitElement {
  @property({ type: Function, attribute: false }) onNewChat?: () => void;
  @property({ type: Function, attribute: false }) onContinueRecent?: () => void;
  @property({ type: Function, attribute: false }) onCheckBalance?: () => void;

  protected createRenderRoot() {
    return this;
  }

  render(): TemplateResult {
    return html`
      <div class="flex-1 flex items-center justify-center p-8">
        <div class="max-w-lg w-full flex flex-col items-center gap-6 text-center">
          <h2 class="text-2xl font-bold text-foreground">Welcome to EduCraw</h2>
          <p class="text-muted-foreground text-sm max-w-sm">
            Your AI tutor is ready. Start a new chat, continue a previous
            session, or check your token balance.
          </p>
          <div class="flex flex-col gap-3 w-full max-w-xs">
            ${Button({
              variant: "default",
              size: "lg",
              className: "w-full",
              children: "Start New Chat",
              onClick: () => this.onNewChat?.(),
            })}
            ${Button({
              variant: "outline",
              size: "lg",
              className: "w-full",
              children: "Continue Recent Session",
              onClick: () => this.onContinueRecent?.(),
            })}
            ${Button({
              variant: "ghost",
              size: "lg",
              className: "w-full",
              children: "Check Balance",
              onClick: () => this.onCheckBalance?.(),
            })}
          </div>
        </div>
      </div>
    `;
  }
}
