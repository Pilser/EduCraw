import { icon } from "@mariozechner/mini-lit";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { FolderOpen } from "lucide";
import { i18n } from "../utils/i18n.js";

@customElement("file-drawer-toggle")
export class FileDrawerToggle extends LitElement {
	@property({ type: Boolean }) drawerOpen = false;
	@property() onClick?: () => void;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback() {
		super.connectedCallback();
		this.style.display = "block";
	}

	override render(): TemplateResult {
		if (this.drawerOpen) return html``; // Hide when drawer is open

		return html`
			<button
				class="fixed right-0 top-1/2 -translate-y-1/2 z-30
					flex items-center gap-2 
					bg-primary text-primary-foreground 
					px-3 py-4 rounded-l-lg 
					shadow-lg hover:shadow-xl
					hover:px-4
					transition-all duration-200
					border border-r-0 border-primary
					group"
				@click=${() => this.onClick?.()}
				title="Open files"
			>
				<!-- Icon -->
				<div class="transform group-hover:scale-110 transition-transform">
					${icon(FolderOpen, "md")}
				</div>
				
				<!-- Text label (hidden on small screens) -->
				<span class="hidden md:block text-sm font-medium whitespace-nowrap">
					Files
				</span>
			</button>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"file-drawer-toggle": FileDrawerToggle;
	}
}
