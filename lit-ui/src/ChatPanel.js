var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./components/AgentInterface.js";
const BREAKPOINT = 800;
let ChatPanel = class ChatPanel extends LitElement {
    constructor() {
        super(...arguments);
        this.windowWidth = 0;
        this.resizeHandler = () => {
            this.windowWidth = window.innerWidth;
            this.requestUpdate();
        };
    }
    createRenderRoot() {
        return this;
    }
    connectedCallback() {
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
    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener("resize", this.resizeHandler);
    }
    init(config) {
        this.agentInterface = document.createElement("agent-interface");
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
            return html `<div class="flex items-center justify-center h-full">
        <div class="text-muted-foreground">No agent interface</div>
      </div>`;
        }
        const isMobile = this.windowWidth < BREAKPOINT;
        return html `
      <div class="relative w-full h-full overflow-hidden flex">
        <div class="h-full" style="width: 100%;">
          ${this.agentInterface}
        </div>
      </div>
    `;
    }
};
__decorate([
    state()
], ChatPanel.prototype, "agentInterface", void 0);
__decorate([
    state()
], ChatPanel.prototype, "windowWidth", void 0);
ChatPanel = __decorate([
    customElement("pi-chat-panel")
], ChatPanel);
export { ChatPanel };
