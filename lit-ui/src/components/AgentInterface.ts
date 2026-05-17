import type {
  BackendAssistantMessage,
  BackendMessage,
  WsToolEndFrame,
} from "../core/edu-types.js";
import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ModelSelector } from "../dialogs/ModelSelector.js";
import type { MessageEditor, ThinkingLevel } from "./MessageEditor.js";
import "./MessageEditor.js";
import "./MessageList.js";
import "./Messages.js";
import "./StreamingMessageContainer.js";
import type { Attachment } from "../utils/attachment-utils.js";
import { formatUsage } from "../utils/format.js";
import { i18n } from "../utils/i18n.js";
import type { StreamingMessageContainer } from "./StreamingMessageContainer.js";

@customElement("agent-interface")
export class AgentInterface extends LitElement {
  @property({ type: Array }) messages: BackendMessage[] = [];
  @property({ attribute: false }) currentModel?: { id: string; name: string; provider: string; reasoning?: boolean };
  @property({ type: Boolean }) enableAttachments = true;
  @property({ type: Boolean }) enableModelSelector = true;
  @property({ type: Boolean }) enableThinkingSelector = true;
  @property({ type: Boolean }) showThemeToggle = false;
  @property({ attribute: false }) sessionTokenUsage?: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cache_creation_tokens?: number;
    total_cache_read_tokens?: number;
  };
  @property({ attribute: false }) onBeforeSend?: () => void | Promise<void>;
  @property({ attribute: false }) onCostClick?: () => void;
  @property({ attribute: false }) onModelSelect?: () => void;
  @property({ attribute: false }) onSend?: (text: string, attachments: Attachment[]) => void;
  @property({ attribute: false }) onCancel?: () => void;
  @property({ type: Boolean }) isStreaming = false;
  @property() thinkingLevel: ThinkingLevel = "off";

  @state() private _streamingMessage: BackendAssistantMessage | null = null;

  @query("message-editor") private _messageEditor!: MessageEditor;
  @query("streaming-message-container")
  private _streamingContainer!: StreamingMessageContainer;

  private _autoScroll = true;
  private _lastScrollTop = 0;
  private _lastClientHeight = 0;
  private _scrollContainer?: HTMLElement;
  private _resizeObserver?: ResizeObserver;

  public setInput(text: string, attachments?: Attachment[]) {
    const update = () => {
      if (!this._messageEditor) requestAnimationFrame(update);
      else {
        this._messageEditor.value = text;
        this._messageEditor.attachments = attachments || [];
      }
    };
    update();
  }

  public setAutoScroll(enabled: boolean) {
    this._autoScroll = enabled;
  }

  public setStreamingMessage(msg: BackendAssistantMessage | null, immediate = false) {
    if (this._streamingContainer) {
      this._streamingContainer.setMessage(msg, immediate);
    }
    this._streamingMessage = msg;
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override async connectedCallback() {
    super.connectedCallback();

    this.style.display = "flex";
    this.style.flexDirection = "column";
    this.style.height = "100%";
    this.style.minHeight = "0";

    await this.updateComplete;
    this._scrollContainer = this.querySelector(
      ".overflow-y-auto",
    ) as HTMLElement;

    if (this._scrollContainer) {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._autoScroll && this._scrollContainer) {
          this._scrollContainer.scrollTop = this._scrollContainer.scrollHeight;
        }
      });

      const contentContainer =
        this._scrollContainer.querySelector(".max-w-3xl");
      if (contentContainer) {
        this._resizeObserver.observe(contentContainer);
      }

      this._scrollContainer.addEventListener("scroll", this._handleScroll);
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = undefined;
    }

    if (this._scrollContainer) {
      this._scrollContainer.removeEventListener("scroll", this._handleScroll);
    }
  }

  private _handleScroll = (_ev: any) => {
    if (!this._scrollContainer) return;

    const currentScrollTop = this._scrollContainer.scrollTop;
    const scrollHeight = this._scrollContainer.scrollHeight;
    const clientHeight = this._scrollContainer.clientHeight;
    const distanceFromBottom = scrollHeight - currentScrollTop - clientHeight;

    if (clientHeight < this._lastClientHeight) {
      this._lastClientHeight = clientHeight;
      return;
    }

    if (
      currentScrollTop !== 0 &&
      currentScrollTop < this._lastScrollTop &&
      distanceFromBottom > 50
    ) {
      this._autoScroll = false;
    } else if (distanceFromBottom < 10) {
      this._autoScroll = true;
    }

    this._lastScrollTop = currentScrollTop;
    this._lastClientHeight = clientHeight;
  };

  public async handleSend(input: string, attachments?: Attachment[]) {
    if ((!input.trim() && attachments?.length === 0) || this.isStreaming) return;

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

  private renderMessages() {
    const toolResultsById = new Map<string, WsToolEndFrame>();
    for (const message of this.messages) {
      if ((message as any).role === "toolResult") {
        const tr = message as any;
        toolResultsById.set(tr.toolCallId, {
          type: "tool_end",
          status: tr.isError ? "failed" : "completed",
          exit_code: tr.exitCode ?? 0,
          stdout: tr.stdout || "",
          stderr: tr.stderr || "",
        });
      }
    }

    return html`
      <div class="flex flex-col gap-3">
        <message-list
          .messages=${[...this.messages]}
          .pendingToolCalls=${new Set<string>()}
          .isStreaming=${this.isStreaming}
          .onCostClick=${this.onCostClick}
        ></message-list>

        <streaming-message-container
          class="${this.isStreaming ? "" : "hidden"}"
          .isStreaming=${this.isStreaming}
          .pendingToolCalls=${new Set<string>()}
          .toolResultsById=${toolResultsById}
          .onCostClick=${this.onCostClick}
        ></streaming-message-container>
      </div>
    `;
  }

  private renderStats() {
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
          if (cacheRead > 0) totalsText += `, cache read: ${this.formatTokens(cacheRead)}`;
          if (cacheWrite > 0) totalsText += `, cache write: ${this.formatTokens(cacheWrite)}`;
          totalsText += ')';
        } else {
          totalsText += ` (in: ${this.formatTokens(input)}, out: ${this.formatTokens(output)})`;
        }
      }
    } else {
      const totals = this.messages
        .filter((m) => m.role === "assistant")
        .reduce(
          (acc, msg: any) => {
            const usage = msg.usage;
            if (usage) {
              acc.input += usage.input;
              acc.output += usage.output;
              acc.cacheRead += usage.cacheRead;
              acc.cacheWrite += usage.cacheWrite;
              acc.cost.total += usage.cost.total;
            }
            return acc;
          },
          {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        );

      const hasTotals =
        totals.input || totals.output || totals.cacheRead || totals.cacheWrite;
      totalsText = hasTotals ? formatUsage(totals) : "";
    }

    return html`
      <div
        class="text-xs text-muted-foreground flex justify-between items-center h-5"
      >
        <div class="flex items-center gap-1">
          ${this.showThemeToggle ? html`<theme-toggle></theme-toggle>` : html``}
        </div>
        <div class="flex ml-auto items-center gap-3">
          ${totalsText
            ? this.onCostClick
              ? html`<span
                  class="cursor-pointer hover:text-foreground transition-colors"
                  @click=${this.onCostClick}
                  >${totalsText}</span
                >`
              : html`<span>${totalsText}</span>`
            : ""}
        </div>
      </div>
    `;
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toString();
  }

  override render() {
    return html`
      <div class="flex flex-col h-full bg-background text-foreground">
        <div class="flex-1 overflow-y-auto">
          <div class="max-w-3xl mx-auto p-4 pb-0">${this.renderMessages()}</div>
        </div>

        <div class="shrink-0">
          <div class="max-w-3xl mx-auto px-2">
            <message-editor
              .isStreaming=${this.isStreaming}
              .currentModel=${this.currentModel}
              .thinkingLevel=${this.thinkingLevel}
              .showAttachmentButton=${this.enableAttachments}
              .showModelSelector=${this.enableModelSelector}
              .showThinkingSelector=${this.enableThinkingSelector}
              .onSend=${(input: string, attachments: Attachment[]) => {
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
}

if (!customElements.get("agent-interface")) {
  customElements.define("agent-interface", AgentInterface);
}
