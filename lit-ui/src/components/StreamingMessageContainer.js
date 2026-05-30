var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, LitElement } from "lit";
import { property, state } from "lit/decorators.js";
export class StreamingMessageContainer extends LitElement {
    constructor() {
        super(...arguments);
        this.isStreaming = false;
        this._message = null;
        this._pendingMessage = null;
        this._updateScheduled = false;
        this._immediateUpdate = false;
    }
    createRenderRoot() {
        return this;
    }
    connectedCallback() {
        super.connectedCallback();
        this.style.display = "block";
    }
    setMessage(message, immediate = false) {
        this._pendingMessage = message;
        if (immediate || message === null) {
            this._immediateUpdate = true;
            this._message = message;
            this.requestUpdate();
            this._pendingMessage = null;
            this._updateScheduled = false;
            return;
        }
        if (!this._updateScheduled) {
            this._updateScheduled = true;
            requestAnimationFrame(async () => {
                if (!this._immediateUpdate && this._pendingMessage !== null) {
                    this._message = JSON.parse(JSON.stringify(this._pendingMessage));
                    this.requestUpdate();
                }
                this._pendingMessage = null;
                this._updateScheduled = false;
                this._immediateUpdate = false;
            });
        }
    }
    render() {
        if (!this._message) {
            if (this.isStreaming)
                return html `<div class="flex flex-col gap-3 mb-3">
          <div class="px-4">
            <span class="inline-block w-4 h-4 rounded-full bg-foreground/70 animate-pulse"></span>
          </div>
        </div>`;
            return html ``;
        }
        const msg = this._message;
        if (msg.role === "toolResult" || msg.role === "user" || msg.role === "user-with-attachments") {
            return html ``;
        }
        else if (msg.role === "assistant") {
            return html `
        <div class="flex flex-col gap-3 mb-3">
          <assistant-message
            .message=${msg}
            .isStreaming=${this.isStreaming}
            .pendingToolCalls=${this.pendingToolCalls}
            .toolResultsById=${this.toolResultsById}
            .hideToolCalls=${false}
            .onCostClick=${this.onCostClick}
          ></assistant-message>
          ${this.isStreaming ? html `<div class="px-4 -mt-2"><span class="inline-block w-4 h-4 rounded-full bg-foreground/70 animate-pulse"></span></div>` : ""}
        </div>
      `;
        }
    }
}
__decorate([
    property({ type: Boolean })
], StreamingMessageContainer.prototype, "isStreaming", void 0);
__decorate([
    property({ type: Object })
], StreamingMessageContainer.prototype, "pendingToolCalls", void 0);
__decorate([
    property({ type: Object })
], StreamingMessageContainer.prototype, "toolResultsById", void 0);
__decorate([
    property({ attribute: false })
], StreamingMessageContainer.prototype, "onCostClick", void 0);
__decorate([
    state()
], StreamingMessageContainer.prototype, "_message", void 0);
if (!customElements.get("streaming-message-container")) {
    customElements.define("streaming-message-container", StreamingMessageContainer);
}
