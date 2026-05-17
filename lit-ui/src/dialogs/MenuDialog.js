var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var MenuDialog_1;
import { Dialog, DialogContent, DialogHeader } from "@mariozechner/mini-lit/dist/Dialog.js";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
// Base class for menu tabs
export class MenuTab extends LitElement {
    createRenderRoot() {
        return this;
    }
}
let MenuDialog = MenuDialog_1 = class MenuDialog extends LitElement {
    constructor() {
        super(...arguments);
        this.tabs = [];
        this.balance = 0;
        this.isOpen = false;
        this.activeTabIndex = 0;
    }
    createRenderRoot() {
        return this;
    }
    static async open(tabs, onClose, defaultTabIndex = 0, balance = 0) {
        console.log("[MenuDialog] Opening with tabs:", tabs.length, "defaultTabIndex:", defaultTabIndex);
        const dialog = new MenuDialog_1();
        dialog.tabs = tabs;
        dialog.onCloseCallback = onClose;
        dialog.activeTabIndex = defaultTabIndex;
        dialog.balance = balance;
        dialog.isOpen = true;
        // Give each tab a way to close the dialog
        tabs.forEach(tab => {
            tab.closeDialog = () => {
                dialog.isOpen = false;
                dialog.remove();
                dialog.onCloseCallback?.();
            };
        });
        document.body.appendChild(dialog);
        console.log("[MenuDialog] Dialog appended to body");
    }
    setActiveTab(index) {
        this.activeTabIndex = index;
    }
    renderSidebarItem(tab, index) {
        const isActive = this.activeTabIndex === index;
        return html `
			<button
				class="w-full text-left px-4 py-3 rounded-md transition-colors ${isActive
            ? "bg-secondary text-foreground font-medium"
            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"}"
				@click=${() => this.setActiveTab(index)}
			>
				${tab.getTabName()}
			</button>
		`;
    }
    renderMobileTab(tab, index) {
        const isActive = this.activeTabIndex === index;
        return html `
			<button
				class="px-3 py-2 text-sm font-medium transition-colors ${isActive ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}"
				@click=${() => this.setActiveTab(index)}
			>
				${tab.getTabName()}
			</button>
		`;
    }
    render() {
        if (this.tabs.length === 0) {
            return html ``;
        }
        return Dialog({
            isOpen: this.isOpen,
            onClose: () => {
                this.isOpen = false;
                this.remove();
                this.onCloseCallback?.();
            },
            width: "min(1000px, 90vw)",
            height: "min(800px, 90vh)",
            backdropClassName: "bg-black/50 backdrop-blur-sm",
            children: html `
				${DialogContent({
                className: "h-full p-6",
                children: html `
						<div class="flex flex-col h-full overflow-hidden">
							<!-- Header -->
							<div class="pb-4 flex-shrink-0 flex items-center justify-between">
								${DialogHeader({ title: "Menu" })}
								<span class="text-sm text-muted-foreground">
									Balance: <span class="text-amber-500 font-semibold">${this.balance.toLocaleString()}</span> tokens
								</span>
							</div>

							<!-- Mobile Tabs -->
							<div class="md:hidden flex flex-shrink-0 pb-4 overflow-x-auto">
								${this.tabs.map((tab, index) => this.renderMobileTab(tab, index))}
							</div>

							<!-- Layout -->
							<div class="flex flex-1 overflow-hidden">
								<!-- Sidebar (desktop only) -->
								<div class="hidden md:block w-64 flex-shrink-0 space-y-1">
									${this.tabs.map((tab, index) => this.renderSidebarItem(tab, index))}
								</div>

								<!-- Content -->
								<div class="flex-1 overflow-y-auto md:pl-6">
									${this.tabs.map((tab, index) => html `<div style="display: ${this.activeTabIndex === index ? "block" : "none"}">${tab}</div>`)}
								</div>
							</div>
						</div>
					`,
            })}
			`,
        });
    }
};
__decorate([
    property({ type: Array, attribute: false })
], MenuDialog.prototype, "tabs", void 0);
__decorate([
    property({ type: Number })
], MenuDialog.prototype, "balance", void 0);
__decorate([
    state()
], MenuDialog.prototype, "isOpen", void 0);
__decorate([
    state()
], MenuDialog.prototype, "activeTabIndex", void 0);
MenuDialog = MenuDialog_1 = __decorate([
    customElement("menu-dialog")
], MenuDialog);
export { MenuDialog };
