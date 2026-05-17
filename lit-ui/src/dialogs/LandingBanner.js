var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
let LandingBanner = class LandingBanner extends LitElement {
    createRenderRoot() {
        return this;
    }
    render() {
        return html `
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
};
__decorate([
    property({ type: Function, attribute: false })
], LandingBanner.prototype, "onNewChat", void 0);
__decorate([
    property({ type: Function, attribute: false })
], LandingBanner.prototype, "onContinueRecent", void 0);
__decorate([
    property({ type: Function, attribute: false })
], LandingBanner.prototype, "onCheckBalance", void 0);
LandingBanner = __decorate([
    customElement("landing-banner")
], LandingBanner);
export { LandingBanner };
