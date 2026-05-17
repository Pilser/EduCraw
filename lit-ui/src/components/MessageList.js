var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, LitElement } from "lit";
import { property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { renderMessage } from "./message-renderer-registry.js";
export class MessageList extends LitElement {
    constructor() {
        super(...arguments);
        this.messages = [];
        this.isStreaming = false;
    }
    createRenderRoot() {
        return this;
    }
    connectedCallback() {
        super.connectedCallback();
        this.style.display = "block";
    }
    buildRenderItems() {
        const resultByCallId = new Map();
        for (const message of this.messages) {
            if (message.role === "toolResult") {
                const tr = message;
                resultByCallId.set(tr.toolCallId, {
                    type: "tool_end",
                    status: tr.isError ? "failed" : "completed",
                    exit_code: tr.exitCode ?? 0,
                    stdout: tr.stdout || "",
                    stderr: tr.stderr || "",
                });
            }
        }
        const items = [];
        let index = 0;
        for (const msg of this.messages) {
            if (msg.role === "artifact") {
                continue;
            }
            const customTemplate = renderMessage(msg);
            if (customTemplate) {
                items.push({ key: `msg:${index}`, template: customTemplate });
                index++;
                continue;
            }
            if (msg.role === "user" || msg.role === "user-with-attachments") {
                items.push({
                    key: `msg:${index}`,
                    template: html `<user-message .message=${msg}></user-message>`,
                });
                index++;
            }
            else if (msg.role === "assistant") {
                const amsg = msg;
                items.push({
                    key: `msg:${index}`,
                    template: html `<assistant-message
            .message=${amsg}
            .isStreaming=${false}
            .pendingToolCalls=${this.pendingToolCalls}
            .toolResultsById=${resultByCallId}
            .hideToolCalls=${false}
            .hidePendingToolCalls=${this.isStreaming}
            .onCostClick=${this.onCostClick}
          ></assistant-message>`,
                });
                index++;
            }
        }
        return items;
    }
    render() {
        const items = this.buildRenderItems();
        return html `<div class="flex flex-col gap-3">
      ${repeat(items, (it) => it.key, (it) => it.template)}
    </div>`;
    }
}
__decorate([
    property({ type: Array })
], MessageList.prototype, "messages", void 0);
__decorate([
    property({ type: Object })
], MessageList.prototype, "pendingToolCalls", void 0);
__decorate([
    property({ type: Boolean })
], MessageList.prototype, "isStreaming", void 0);
__decorate([
    property({ attribute: false })
], MessageList.prototype, "onCostClick", void 0);
if (!customElements.get("message-list")) {
    customElements.define("message-list", MessageList);
}
