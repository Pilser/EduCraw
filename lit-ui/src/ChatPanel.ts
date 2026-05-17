import { Badge } from "@mariozechner/mini-lit/dist/Badge.js";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./components/AgentInterface.js";
import type { AgentInterface } from "./components/AgentInterface.js";
import type { Attachment } from "./utils/attachment-utils.js";
import { i18n } from "./utils/i18n.js";

const BREAKPOINT = 800;

interface ChatPanelConfig {
  onApiKeyRequired?: (provider: string) => Promise<boolean>;
  onBeforeSend?: () => void | Promise<void>;
  onCostClick?: () => void;
  onModelSelect?: () => void;
  onSend?: (text: string, attachments: Attachment[]) => void;
  onCancel?: () => void;
}

@customElement("pi-chat-panel")
export class ChatPanel extends LitElement {
  @state() private windowWidth = 0;

  private _config?: ChatPanelConfig;

  get agentInterface(): AgentInterface | null {
    return this.querySelector("agent-interface");
  }

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

  init(config?: ChatPanelConfig) {
    this._config = config;
    this.requestUpdate();
  }

  render() {
    return html`
      <div class="relative w-full h-full overflow-hidden flex">
        <div class="h-full" style="width: 100%;">
          <agent-interface
            .enableAttachments=${true}
            .enableModelSelector=${true}
            .enableThinkingSelector=${true}
            .showThemeToggle=${false}
            .onBeforeSend=${this._config?.onBeforeSend}
            .onCostClick=${this._config?.onCostClick}
            .onModelSelect=${this._config?.onModelSelect}
            .onSend=${this._config?.onSend}
            .onCancel=${this._config?.onCancel}
          ></agent-interface>
        </div>
      </div>
    `;
  }
}
