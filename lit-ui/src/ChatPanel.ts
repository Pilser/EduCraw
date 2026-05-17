import { Badge } from "@mariozechner/mini-lit/dist/Badge.js";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./components/AgentInterface.js";
import type { AgentInterface } from "./components/AgentInterface.js";
import type { Attachment } from "./utils/attachment-utils.js";
import { i18n } from "./utils/i18n.js";

const BREAKPOINT = 800;

@customElement("pi-chat-panel")
export class ChatPanel extends LitElement {
  @state() public agentInterface?: AgentInterface;
  @state() private windowWidth = 0;

  private resizeHandler = () => {
    this.windowWidth = window.innerWidth;
    this.requestUpdate();
  };

  createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.windowWidth = window.innerWidth;
    window.addEventListener("resize", this.resizeHandler);
    this.style.display = "flex";
    this.style.flexDirection = "column";
    this.style.height = "100%";
    this.style.minHeight = "0";
    requestAnimationFrame(() => {
      this.windowWidth = window.innerWidth;
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.resizeHandler);
  }

  init(config?: {
    onApiKeyRequired?: (provider: string) => Promise<boolean>;
    onBeforeSend?: () => void | Promise<void>;
    onCostClick?: () => void;
    onModelSelect?: () => void;
    onSend?: (text: string, attachments: Attachment[]) => void;
    onCancel?: () => void;
  }) {
    this.agentInterface = document.createElement("agent-interface") as AgentInterface;
    this.agentInterface.enableAttachments = true;
    this.agentInterface.enableModelSelector = true;
    this.agentInterface.enableThinkingSelector = true;
    this.agentInterface.showThemeToggle = false;
    this.agentInterface.onBeforeSend = config?.onBeforeSend;
    this.agentInterface.onCostClick = config?.onCostClick;
    this.agentInterface.onModelSelect = config?.onModelSelect;
    this.agentInterface.onSend = config?.onSend;
    this.agentInterface.onCancel = config?.onCancel;

    this.requestUpdate();
  }

  render() {
    if (!this.agentInterface) {
      return html`<div class="flex items-center justify-center h-full">
        <div class="text-muted-foreground">No agent interface</div>
      </div>`;
    }

    const isMobile = this.windowWidth < BREAKPOINT;

    return html`
      <div class="relative w-full h-full overflow-hidden flex">
        <div class="h-full" style="width: 100%;">
          ${this.agentInterface}
        </div>
      </div>
    `;
  }
}
