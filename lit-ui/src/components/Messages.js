var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { renderTool } from "../tools/index.js";
import { formatUsage } from "../utils/format.js";
import { i18n } from "../utils/i18n.js";
import "./ThinkingBlock.js";
let UserMessage = class UserMessage extends LitElement {
    createRenderRoot() {
        return this;
    }
    connectedCallback() {
        super.connectedCallback();
        this.style.display = "block";
    }
    render() {
        const content = typeof this.message.content === "string"
            ? this.message.content
            : this.message.content.find((c) => c.type === "text")?.text || "";
        return html `
      <div class="flex justify-start mx-4">
        <div class="user-message-container py-2 px-4 rounded-xl">
          <markdown-block .content=${content}></markdown-block>
          ${this.message.role === "user-with-attachments" &&
            this.message.attachments &&
            this.message.attachments.length > 0
            ? html `
                <div class="mt-3 flex flex-wrap gap-2">
                  ${this.message.attachments.map((attachment) => html `<attachment-tile .attachment=${attachment}></attachment-tile>`)}
                </div>
              `
            : ""}
        </div>
      </div>
    `;
    }
};
__decorate([
    property({ type: Object })
], UserMessage.prototype, "message", void 0);
UserMessage = __decorate([
    customElement("user-message")
], UserMessage);
export { UserMessage };
let AssistantMessage = class AssistantMessage extends LitElement {
    constructor() {
        super(...arguments);
        this.hideToolCalls = false;
        this.isStreaming = false;
        this.hidePendingToolCalls = false;
    }
    createRenderRoot() {
        return this;
    }
    connectedCallback() {
        super.connectedCallback();
        this.style.display = "block";
    }
    render() {
        const orderedParts = [];
        for (const chunk of this.message.content) {
            if (chunk.type === "text" && chunk.text?.trim() !== "") {
                orderedParts.push(html `<markdown-block .content=${chunk.text}></markdown-block>`);
            }
            else if (chunk.type === "thinking" && chunk.thinking?.trim() !== "") {
                orderedParts.push(html `<thinking-block .content=${chunk.thinking} .isStreaming=${this.isStreaming}></thinking-block>`);
            }
            else if (chunk.type === "toolCall") {
                if (!this.hideToolCalls) {
                    const toolCall = chunk;
                    const pending = this.pendingToolCalls?.has(toolCall.id) ?? false;
                    const result = this.toolResultsById?.get(toolCall.id);
                    if (this.hidePendingToolCalls && pending && !result) {
                        continue;
                    }
                    const aborted = this.message.stopReason === "aborted" && !result;
                    orderedParts.push(html `<tool-message
              .toolCall=${toolCall}
              .result=${result}
              .pending=${pending}
              .aborted=${aborted}
              .isStreaming=${this.isStreaming}
            ></tool-message>`);
                }
            }
        }
        return html `
      <div>
        ${orderedParts.length
            ? html `<div class="px-4 flex flex-col gap-3">${orderedParts}</div>`
            : ""}
        ${this.message.usage && !this.isStreaming
            ? this.onCostClick
                ? html `<div class="px-4 mt-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors" @click=${this.onCostClick}>${formatUsage(this.message.usage)}</div>`
                : html `<div class="px-4 mt-2 text-xs text-muted-foreground">${formatUsage(this.message.usage)}</div>`
            : ""}
        ${this.message.stopReason === "error" && this.message.errorMessage
            ? html `
              <div class="mx-4 mt-3 p-3 bg-destructive/10 text-destructive rounded-lg text-sm overflow-hidden">
                <strong>${i18n("Error:")}</strong> ${this.message.errorMessage}
              </div>
            `
            : ""}
        ${this.message.stopReason === "aborted"
            ? html `<span class="text-sm text-destructive italic">${i18n("Request aborted")}</span>`
            : ""}
      </div>
    `;
    }
};
__decorate([
    property({ type: Object })
], AssistantMessage.prototype, "message", void 0);
__decorate([
    property({ type: Object })
], AssistantMessage.prototype, "pendingToolCalls", void 0);
__decorate([
    property({ type: Boolean })
], AssistantMessage.prototype, "hideToolCalls", void 0);
__decorate([
    property({ type: Object })
], AssistantMessage.prototype, "toolResultsById", void 0);
__decorate([
    property({ type: Boolean })
], AssistantMessage.prototype, "isStreaming", void 0);
__decorate([
    property({ type: Boolean })
], AssistantMessage.prototype, "hidePendingToolCalls", void 0);
__decorate([
    property({ attribute: false })
], AssistantMessage.prototype, "onCostClick", void 0);
AssistantMessage = __decorate([
    customElement("assistant-message")
], AssistantMessage);
export { AssistantMessage };
let ToolMessage = class ToolMessage extends LitElement {
    constructor() {
        super(...arguments);
        this.pending = false;
        this.aborted = false;
        this.isStreaming = false;
    }
    createRenderRoot() {
        return this;
    }
    connectedCallback() {
        super.connectedCallback();
        this.style.display = "block";
    }
    render() {
        const toolName = this.toolCall.name;
        const renderResult = renderTool(toolName, this.toolCall.arguments, this.aborted
            ? {
                type: "tool_end",
                status: "failed",
                exit_code: 1,
                stdout: "",
                stderr: "Aborted",
            }
            : this.result, !this.aborted && (this.isStreaming || this.pending));
        if (renderResult.isCustom) {
            return renderResult.content;
        }
        return html `
      <div class="p-2.5 border border-border rounded-md bg-card text-card-foreground shadow-xs">
        ${renderResult.content}
      </div>
    `;
    }
};
__decorate([
    property({ type: Object })
], ToolMessage.prototype, "toolCall", void 0);
__decorate([
    property({ type: Object })
], ToolMessage.prototype, "result", void 0);
__decorate([
    property({ type: Boolean })
], ToolMessage.prototype, "pending", void 0);
__decorate([
    property({ type: Boolean })
], ToolMessage.prototype, "aborted", void 0);
__decorate([
    property({ type: Boolean })
], ToolMessage.prototype, "isStreaming", void 0);
ToolMessage = __decorate([
    customElement("tool-message")
], ToolMessage);
export { ToolMessage };
let AbortedMessage = class AbortedMessage extends LitElement {
    createRenderRoot() {
        return this;
    }
    connectedCallback() {
        super.connectedCallback();
        this.style.display = "block";
    }
    render() {
        return html `<span class="text-sm text-destructive italic">${i18n("Request aborted")}</span>`;
    }
};
AbortedMessage = __decorate([
    customElement("aborted-message")
], AbortedMessage);
export { AbortedMessage };
