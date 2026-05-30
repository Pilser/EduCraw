import type {
  BackendAssistantMessage,
  BackendMessage,
  WsToolEndFrame,
} from "../core/edu-types.js";
import { html, LitElement } from "lit";
import { property, state } from "lit/decorators.js";

export class StreamingMessageContainer extends LitElement {
  @property({ type: Boolean }) isStreaming = false;
  @property({ type: Object }) pendingToolCalls?: ReadonlySet<string>;
  @property({ type: Object }) toolResultsById?: Map<string, WsToolEndFrame>;
  @property({ attribute: false }) onCostClick?: () => void;

  @state() private _message: BackendAssistantMessage | null = null;
  private _pendingMessage: BackendAssistantMessage | null = null;
  private _updateScheduled = false;
  private _immediateUpdate = false;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "block";
  }

  public setMessage(message: BackendAssistantMessage | null, immediate = false) {
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

  override render() {
    if (!this._message) {
      if (this.isStreaming)
        return html`<div class="flex flex-col gap-3 mb-3">
          <div class="px-4">
            <span class="inline-block w-4 h-4 rounded-full bg-foreground/70 animate-pulse"></span>
          </div>
        </div>`;
      return html``;
    }
    const msg = this._message;

    if ((msg as any).role === "toolResult" || (msg as any).role === "user" || (msg as any).role === "user-with-attachments") {
      return html``;
    } else if (msg.role === "assistant") {
      return html`
        <div class="flex flex-col gap-3 mb-3">
          <assistant-message
            .message=${msg}
            .isStreaming=${this.isStreaming}
            .pendingToolCalls=${this.pendingToolCalls}
            .toolResultsById=${this.toolResultsById}
            .hideToolCalls=${false}
            .onCostClick=${this.onCostClick}
          ></assistant-message>
          ${this.isStreaming ? html`<div class="px-4 -mt-2"><span class="inline-block w-4 h-4 rounded-full bg-foreground/70 animate-pulse"></span></div>` : ""}
        </div>
      `;
    }
  }
}

if (!customElements.get("streaming-message-container")) {
  customElements.define("streaming-message-container", StreamingMessageContainer);
}
