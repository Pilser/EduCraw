var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import "./MessageEditor.js";
import "./MessageList.js";
import "./Messages.js";
import "./StreamingMessageContainer.js";
import { formatUsage } from "../utils/format.js";
let AgentInterface = class AgentInterface extends LitElement {
    constructor() {
        super(...arguments);
        this.messages = [];
        this.enableAttachments = true;
        this.enableModelSelector = true;
        this.enableThinkingSelector = true;
        this.showThemeToggle = false;
        this.isStreaming = false;
        this._streamingMessage = null;
        this._autoScroll = true;
        this._lastScrollTop = 0;
        this._lastClientHeight = 0;
        this._handleScroll = (_ev) => {
            if (!this._scrollContainer)
                return;
            const currentScrollTop = this._scrollContainer.scrollTop;
            const scrollHeight = this._scrollContainer.scrollHeight;
            const clientHeight = this._scrollContainer.clientHeight;
            const distanceFromBottom = scrollHeight - currentScrollTop - clientHeight;
            if (clientHeight < this._lastClientHeight) {
                this._lastClientHeight = clientHeight;
                return;
            }
            if (currentScrollTop !== 0 &&
                currentScrollTop < this._lastScrollTop &&
                distanceFromBottom > 50) {
                this._autoScroll = false;
            }
            else if (distanceFromBottom < 10) {
                this._autoScroll = true;
            }
            this._lastScrollTop = currentScrollTop;
            this._lastClientHeight = clientHeight;
        };
    }
    setInput(text, attachments) {
        const update = () => {
            if (!this._messageEditor)
                requestAnimationFrame(update);
            else {
                this._messageEditor.value = text;
                this._messageEditor.attachments = attachments || [];
            }
        };
        update();
    }
    setAutoScroll(enabled) {
        this._autoScroll = enabled;
    }
    setStreamingMessage(msg, immediate = false) {
        if (this._streamingContainer) {
            this._streamingContainer.setMessage(msg, immediate);
        }
        this._streamingMessage = msg;
    }
    createRenderRoot() {
        return this;
    }
    async connectedCallback() {
        super.connectedCallback();
        this.style.display = "flex";
        this.style.flexDirection = "column";
        this.style.height = "100%";
        this.style.minHeight = "0";
        await this.updateComplete;
        this._scrollContainer = this.querySelector(".overflow-y-auto");
        if (this._scrollContainer) {
            this._resizeObserver = new ResizeObserver(() => {
                if (this._autoScroll && this._scrollContainer) {
                    this._scrollContainer.scrollTop = this._scrollContainer.scrollHeight;
                }
            });
            const contentContainer = this._scrollContainer.querySelector(".max-w-3xl");
            if (contentContainer) {
                this._resizeObserver.observe(contentContainer);
            }
            this._scrollContainer.addEventListener("scroll", this._handleScroll);
        }
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = undefined;
        }
        if (this._scrollContainer) {
            this._scrollContainer.removeEventListener("scroll", this._handleScroll);
        }
    }
    async handleSend(input, attachments) {
        if ((!input.trim() && attachments?.length === 0) || this.isStreaming)
            return;
        if (this.onBeforeSend) {
            await this.onBeforeSend();
        }
        this._messageEditor.value = "";
        this._messageEditor.attachments = [];
        this._autoScroll = true;
        if (this.onSend) {
            this.onSend(input, attachments || []);
        }
    }
    renderMessages() {
        const toolResultsById = new Map();
        for (const message of this.messages) {
            if (message.role === "toolResult") {
                const tr = message;
                toolResultsById.set(tr.toolCallId, {
                    type: "tool_end",
                    status: tr.isError ? "failed" : "completed",
                    exit_code: tr.exitCode ?? 0,
                    stdout: tr.stdout || "",
                    stderr: tr.stderr || "",
                });
            }
        }
        return html `
      <div class="flex flex-col gap-3">
        <message-list
          .messages=${[...this.messages]}
          .pendingToolCalls=${new Set()}
          .isStreaming=${this.isStreaming}
          .onCostClick=${this.onCostClick}
        ></message-list>

        <streaming-message-container
          class="${this.isStreaming ? "" : "hidden"}"
          .isStreaming=${this.isStreaming}
          .pendingToolCalls=${new Set()}
          .toolResultsById=${toolResultsById}
          .onCostClick=${this.onCostClick}
        ></streaming-message-container>
      </div>
    `;
    }
    renderStats() {
        let totalsText = "";
        if (this.sessionTokenUsage) {
            const input = this.sessionTokenUsage.total_input_tokens || 0;
            const output = this.sessionTokenUsage.total_output_tokens || 0;
            const cacheRead = this.sessionTokenUsage.total_cache_read_tokens || 0;
            const cacheWrite = this.sessionTokenUsage.total_cache_creation_tokens || 0;
            const total = input + output;
            if (total > 0) {
                totalsText = `${this.formatTokens(total)} tokens`;
                if (cacheRead > 0 || cacheWrite > 0) {
                    totalsText += ` (in: ${this.formatTokens(input)}, out: ${this.formatTokens(output)}`;
                    if (cacheRead > 0)
                        totalsText += `, cache read: ${this.formatTokens(cacheRead)}`;
                    if (cacheWrite > 0)
                        totalsText += `, cache write: ${this.formatTokens(cacheWrite)}`;
                    totalsText += ')';
                }
                else {
                    totalsText += ` (in: ${this.formatTokens(input)}, out: ${this.formatTokens(output)})`;
                }
            }
        }
        else {
            const totals = this.messages
                .filter((m) => m.role === "assistant")
                .reduce((acc, msg) => {
                const usage = msg.usage;
                if (usage) {
                    acc.input += usage.input;
                    acc.output += usage.output;
                    acc.cacheRead += usage.cacheRead;
                    acc.cacheWrite += usage.cacheWrite;
                    acc.cost.total += usage.cost.total;
                }
                return acc;
            }, {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            });
            const hasTotals = totals.input || totals.output || totals.cacheRead || totals.cacheWrite;
            totalsText = hasTotals ? formatUsage(totals) : "";
        }
        return html `
      <div
        class="text-xs text-muted-foreground flex justify-between items-center h-5"
      >
        <div class="flex items-center gap-1">
          ${this.showThemeToggle ? html `<theme-toggle></theme-toggle>` : html ``}
        </div>
        <div class="flex ml-auto items-center gap-3">
          ${totalsText
            ? this.onCostClick
                ? html `<span
                  class="cursor-pointer hover:text-foreground transition-colors"
                  @click=${this.onCostClick}
                  >${totalsText}</span
                >`
                : html `<span>${totalsText}</span>`
            : ""}
        </div>
      </div>
    `;
    }
    formatTokens(tokens) {
        if (tokens >= 1000000) {
            return `${(tokens / 1000000).toFixed(1)}M`;
        }
        else if (tokens >= 1000) {
            return `${(tokens / 1000).toFixed(1)}k`;
        }
        return tokens.toString();
    }
    render() {
        return html `
      <div class="flex flex-col h-full bg-background text-foreground">
        <div class="flex-1 overflow-y-auto">
          <div class="max-w-3xl mx-auto p-4 pb-0">${this.renderMessages()}</div>
        </div>

        <div class="shrink-0">
          <div class="max-w-3xl mx-auto px-2">
            <message-editor
              .isStreaming=${this.isStreaming}
              .showAttachmentButton=${this.enableAttachments}
              .showModelSelector=${this.enableModelSelector}
              .showThinkingSelector=${this.enableThinkingSelector}
              .onSend=${(input, attachments) => {
            this.handleSend(input, attachments);
        }}
              .onAbort=${this.onCancel}
              .onModelSelect=${this.onModelSelect}
            ></message-editor>
            ${this.renderStats()}
          </div>
        </div>
      </div>
    `;
    }
};
__decorate([
    property({ type: Array })
], AgentInterface.prototype, "messages", void 0);
__decorate([
    property({ type: Boolean })
], AgentInterface.prototype, "enableAttachments", void 0);
__decorate([
    property({ type: Boolean })
], AgentInterface.prototype, "enableModelSelector", void 0);
__decorate([
    property({ type: Boolean })
], AgentInterface.prototype, "enableThinkingSelector", void 0);
__decorate([
    property({ type: Boolean })
], AgentInterface.prototype, "showThemeToggle", void 0);
__decorate([
    property({ attribute: false })
], AgentInterface.prototype, "sessionTokenUsage", void 0);
__decorate([
    property({ attribute: false })
], AgentInterface.prototype, "onBeforeSend", void 0);
__decorate([
    property({ attribute: false })
], AgentInterface.prototype, "onCostClick", void 0);
__decorate([
    property({ attribute: false })
], AgentInterface.prototype, "onModelSelect", void 0);
__decorate([
    property({ attribute: false })
], AgentInterface.prototype, "onSend", void 0);
__decorate([
    property({ attribute: false })
], AgentInterface.prototype, "onCancel", void 0);
__decorate([
    property({ type: Boolean })
], AgentInterface.prototype, "isStreaming", void 0);
__decorate([
    state()
], AgentInterface.prototype, "_streamingMessage", void 0);
__decorate([
    query("message-editor")
], AgentInterface.prototype, "_messageEditor", void 0);
__decorate([
    query("streaming-message-container")
], AgentInterface.prototype, "_streamingContainer", void 0);
AgentInterface = __decorate([
    customElement("agent-interface")
], AgentInterface);
export { AgentInterface };
if (!customElements.get("agent-interface")) {
    customElements.define("agent-interface", AgentInterface);
}
