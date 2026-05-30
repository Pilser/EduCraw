import type {
  BackendAssistantMessage,
  BackendMessage,
  SseToolEndFrame,
} from "../core/edu-types.js";
import { html, LitElement, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { renderMessage } from "./message-renderer-registry.js";

export class MessageList extends LitElement {
  @property({ type: Array }) messages: BackendMessage[] = [];
  @property({ type: Object }) pendingToolCalls?: ReadonlySet<string>;
  @property({ type: Boolean }) isStreaming: boolean = false;
  @property({ attribute: false }) onCostClick?: () => void;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "block";
  }

  private buildRenderItems() {
    const resultByCallId = new Map<string, SseToolEndFrame>();
    for (const message of this.messages) {
      if ((message as any).role === "toolResult") {
        const tr = message as any;
        resultByCallId.set(tr.toolCallId, {
          type: "tool_end",
          status: tr.isError ? "failed" : "completed",
          exit_code: tr.exitCode ?? 0,
          stdout: tr.stdout || "",
          stderr: tr.stderr || "",
        });
      }
    }

    const items: Array<{ key: string; template: TemplateResult }> = [];
    let index = 0;
    for (const msg of this.messages) {
      if ((msg as any).role === "artifact") {
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
          template: html`<user-message .message=${msg}></user-message>`,
        });
        index++;
      } else if (msg.role === "assistant") {
        const amsg = msg as BackendAssistantMessage;
        items.push({
          key: `msg:${index}`,
          template: html`<assistant-message
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

  override render() {
    const items = this.buildRenderItems();
    return html`<div class="flex flex-col gap-3">
      ${repeat(
        items,
        (it) => it.key,
        (it) => it.template,
      )}
    </div>`;
  }
}

if (!customElements.get("message-list")) {
  customElements.define("message-list", MessageList);
}
