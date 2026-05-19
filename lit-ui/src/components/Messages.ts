import type {
  BackendAssistantMessage,
  BackendContentBlock,
  BackendToolCallBlock,
  BackendUserMessage,
  BackendUserMessageWithAttachments,
  WsToolEndFrame,
} from "../core/edu-types.js";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { renderTool } from "../tools/index.js";
import type { Attachment } from "../utils/attachment-utils.js";
import { formatUsage } from "../utils/format.js";
import { i18n } from "../utils/i18n.js";
import { icon } from "@mariozechner/mini-lit";
import { Check, ChevronDown, ChevronRight, Loader, Wrench, X } from "lucide";
import "./ThinkingBlock.js";
import "./ConsoleBlock.js";
import "@mariozechner/mini-lit/dist/MarkdownBlock.js";
import "@mariozechner/mini-lit/dist/CodeBlock.js";

const FRIENDLY_TOOL_LABELS: Record<string, string> = {
  "bash": "Running command",
  "todo__todo_write": "Updating task list",
  "read": "Reading file",
  "write": "Writing file",
  "edit": "Editing file",
  "glob": "Searching files",
  "grep": "Searching code",
  "web_search": "Searching the web",
  "web_fetch": "Fetching web page",
};

@customElement("user-message")
export class UserMessage extends LitElement {
  @property({ type: Object })
  message!: BackendUserMessage | BackendUserMessageWithAttachments;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "block";
  }

  override render() {
    const content =
      typeof this.message.content === "string"
        ? this.message.content
        : this.message.content.find((c) => c.type === "text")?.text || "";

    return html`
      <div class="flex justify-start mx-4">
        <div class="user-message-container py-2 px-4 rounded-xl">
          <markdown-block .content=${content}></markdown-block>
          ${this.message.role === "user-with-attachments" &&
          this.message.attachments &&
          this.message.attachments.length > 0
            ? html`
                <div class="mt-3 flex flex-wrap gap-2">
                  ${this.message.attachments.map(
                    (attachment) =>
                      html`<attachment-tile .attachment=${attachment}></attachment-tile>`,
                  )}
                </div>
              `
            : ""}
        </div>
      </div>
    `;
  }
}

@customElement("assistant-message")
export class AssistantMessage extends LitElement {
  @property({ type: Object }) message!: BackendAssistantMessage;
  @property({ type: Object }) pendingToolCalls?: ReadonlySet<string>;
  @property({ type: Boolean }) hideToolCalls = false;
  @property({ type: Object }) toolResultsById?: Map<string, WsToolEndFrame>;
  @property({ type: Boolean }) isStreaming: boolean = false;
  @property({ type: Boolean }) hidePendingToolCalls = false;
  @property({ attribute: false }) onCostClick?: () => void;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "block";
  }

  override render() {
    const orderedParts: TemplateResult[] = [];

    for (const chunk of this.message.content) {
      if (chunk.type === "text" && (chunk as any).text?.trim() !== "") {
        orderedParts.push(
          html`<markdown-block .content=${(chunk as any).text}></markdown-block>`,
        );
      } else if (chunk.type === "thinking" && (chunk as any).thinking?.trim() !== "") {
        orderedParts.push(
          html`<thinking-block .content=${(chunk as any).thinking} .isStreaming=${this.isStreaming}></thinking-block>`,
        );
      } else if (chunk.type === "toolCall") {
        if (!this.hideToolCalls) {
          const toolCall = chunk as BackendToolCallBlock;
          const pending = this.pendingToolCalls?.has(toolCall.id) ?? false;
          const result = this.toolResultsById?.get(toolCall.id);
          if (this.hidePendingToolCalls && pending && !result) {
            continue;
          }
          const aborted = this.message.stopReason === "aborted" && !result;
          orderedParts.push(
            html`<tool-message
              .toolCall=${toolCall}
              .result=${result}
              .pending=${pending}
              .aborted=${aborted}
              .isStreaming=${this.isStreaming}
            ></tool-message>`,
          );
        }
      }
    }

    return html`
      <div>
        ${orderedParts.length
          ? html`<div class="px-4 flex flex-col gap-3">${orderedParts}</div>`
          : ""}
        ${this.message.usage && !this.isStreaming
          ? this.onCostClick
            ? html`<div class="px-4 mt-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors" @click=${this.onCostClick}>${formatUsage(this.message.usage)}</div>`
            : html`<div class="px-4 mt-2 text-xs text-muted-foreground">${formatUsage(this.message.usage)}</div>`
          : ""}
        ${this.message.stopReason === "error" && this.message.errorMessage
          ? html`
              <div class="mx-4 mt-3 p-3 bg-destructive/10 text-destructive rounded-lg text-sm overflow-hidden">
                <strong>${i18n("Error:")}</strong> ${this.message.errorMessage}
              </div>
            `
          : ""}
        ${this.message.stopReason === "aborted"
          ? html`<span class="text-sm text-destructive italic">${i18n("Request aborted")}</span>`
          : ""}
      </div>
    `;
  }
}

@customElement("tool-message")
export class ToolMessage extends LitElement {
  @property({ type: Object }) toolCall!: BackendToolCallBlock;
  @property({ type: Object }) result?: WsToolEndFrame;
  @property({ type: Boolean }) pending: boolean = false;
  @property({ type: Boolean }) aborted: boolean = false;
  @property({ type: Boolean }) isStreaming: boolean = false;
  @state() private isExpanded = false;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "block";
  }

  private getFriendlyLabel(): string {
    const name = this.toolCall.name;
    if (FRIENDLY_TOOL_LABELS[name]) return FRIENDLY_TOOL_LABELS[name];
    if (name.startsWith("todo__")) return "Updating task list";
    return "Working on it...";
  }

  private getToolState(): "inprogress" | "complete" | "error" {
    if (this.aborted) return "error";
    if (this.isStreaming || this.pending) return "inprogress";
    if (this.result) {
      return this.result.status === "failed" ? "error" : "complete";
    }
    if (this.toolCall.resultStatus === "failed") return "error";
    return "complete";
  }

  private renderStatusIcon(state: "inprogress" | "complete" | "error") {
    switch (state) {
      case "inprogress":
        return html`<span class="inline-block text-foreground animate-spin">${icon(Loader, "sm")}</span>`;
      case "complete":
        return html`<span class="inline-block text-green-600 dark:text-green-500">${icon(Check, "sm")}</span>`;
      case "error":
        return html`<span class="inline-block text-destructive">${icon(X, "sm")}</span>`;
    }
  }

  private toggleExpanded() {
    this.isExpanded = !this.isExpanded;
  }

  override render() {
    const toolName = this.toolCall.name;
    const state = this.getToolState();
    const friendlyLabel = this.getFriendlyLabel();

    // Debug: log tool data for diagnosis
    console.log("[tool-message] render:", {
      name: this.toolCall.name,
      id: this.toolCall.id,
      hasResult: !!this.result,
      resultStatus: this.toolCall.resultStatus,
      resultStdoutLen: this.toolCall.resultStdout?.length,
      resultStderrLen: this.toolCall.resultStderr?.length,
      pending: this.pending,
      aborted: this.aborted,
    });

    const effectiveResult = this.result ?? (
      this.toolCall.resultStatus
        ? {
            type: "tool_end" as const,
            status: (this.toolCall.resultStatus === "failed" ? "failed" : "completed") as "completed" | "failed",
            exit_code: this.toolCall.resultExitCode ?? 0,
            stdout: this.toolCall.resultStdout ?? "",
            stderr: this.toolCall.resultStderr ?? "",
          }
        : undefined
    );

    console.log("[tool-message] effectiveResult:", effectiveResult ? {
      hasStdout: !!effectiveResult.stdout,
      hasStderr: !!effectiveResult.stderr,
      stdoutLen: effectiveResult.stdout?.length,
      stderrLen: effectiveResult.stderr?.length,
      status: effectiveResult.status,
    } : "undefined");

    const renderResult = renderTool(
      toolName,
      this.toolCall.arguments,
      this.aborted
        ? {
            type: "tool_end",
            status: "failed",
            exit_code: 1,
            stdout: "",
            stderr: "Aborted",
          }
        : effectiveResult,
      !this.aborted && (this.isStreaming || this.pending),
    );

    const toolContent = renderResult.isCustom
      ? html`<div class="mt-2">${renderResult.content}</div>`
      : html`<div class="mt-2 p-2.5 border border-border rounded-md bg-card text-card-foreground shadow-xs">${renderResult.content}</div>`;

    const chevronIcon = this.isExpanded
      ? icon(ChevronDown, "sm")
      : icon(ChevronRight, "sm");

    return html`
      <div class="tool-message-container border border-border rounded-md bg-muted/30">
        <div
          class="tool-message-header cursor-pointer select-none flex items-center gap-2 p-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          @click=${this.toggleExpanded}
        >
          <span class="transition-transform inline-block">${chevronIcon}</span>
          ${this.renderStatusIcon(state)}
          <span class="inline-block">${icon(Wrench, "sm")}</span>
          <span>${friendlyLabel}</span>
        </div>
        ${this.isExpanded ? toolContent : ""}
      </div>
    `;
  }
}

@customElement("aborted-message")
export class AbortedMessage extends LitElement {
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "block";
  }

  protected override render(): unknown {
    return html`<span class="text-sm text-destructive italic">${i18n("Request aborted")}</span>`;
  }
}
