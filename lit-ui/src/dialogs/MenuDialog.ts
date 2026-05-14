import { Dialog, DialogContent, DialogHeader } from "@mariozechner/mini-lit/dist/Dialog.js";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

// Base class for menu tabs
export abstract class MenuTab extends LitElement {
	abstract getTabName(): string;

	// Callback to close the parent dialog
	closeDialog?: () => void;

	protected createRenderRoot() {
		return this;
	}
}

@customElement("menu-dialog")
export class MenuDialog extends LitElement {
	@property({ type: Array, attribute: false }) tabs: MenuTab[] = [];
	@state() private isOpen = false;
	@state() private activeTabIndex = 0;

	protected createRenderRoot() {
		return this;
	}

	private onCloseCallback?: () => void;

	static async open(tabs: MenuTab[], onClose?: () => void, defaultTabIndex: number = 0) {
		console.log("[MenuDialog] Opening with tabs:", tabs.length, "defaultTabIndex:", defaultTabIndex);
		const dialog = new MenuDialog();
		dialog.tabs = tabs;
		dialog.onCloseCallback = onClose;
		dialog.activeTabIndex = defaultTabIndex;
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

	private setActiveTab(index: number) {
		this.activeTabIndex = index;
	}

	private renderSidebarItem(tab: MenuTab, index: number): TemplateResult {
		const isActive = this.activeTabIndex === index;
		return html`
			<button
				class="w-full text-left px-4 py-3 rounded-md transition-colors ${
					isActive
						? "bg-secondary text-foreground font-medium"
						: "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
				}"
				@click=${() => this.setActiveTab(index)}
			>
				${tab.getTabName()}
			</button>
		`;
	}

	private renderMobileTab(tab: MenuTab, index: number): TemplateResult {
		const isActive = this.activeTabIndex === index;
		return html`
			<button
				class="px-3 py-2 text-sm font-medium transition-colors ${
					isActive ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
				}"
				@click=${() => this.setActiveTab(index)}
			>
				${tab.getTabName()}
			</button>
		`;
	}

	render() {
		if (this.tabs.length === 0) {
			return html``;
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
			children: html`
				${DialogContent({
					className: "h-full p-6",
					children: html`
						<div class="flex flex-col h-full overflow-hidden">
							<!-- Header -->
							<div class="pb-4 flex-shrink-0">${DialogHeader({ title: "Menu" })}</div>

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
									${this.tabs.map(
										(tab, index) =>
											html`<div style="display: ${this.activeTabIndex === index ? "block" : "none"}">${tab}</div>`,
									)}
								</div>
							</div>
						</div>
					`,
				})}
			`,
		});
	}
}
