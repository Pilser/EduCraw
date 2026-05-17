var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { icon } from "@mariozechner/mini-lit";
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { FolderOpen } from "lucide";
let FileDrawerToggle = class FileDrawerToggle extends LitElement {
    constructor() {
        super(...arguments);
        this.drawerOpen = false;
    }
    createRenderRoot() {
        return this;
    }
    connectedCallback() {
        super.connectedCallback();
        this.style.display = "block";
    }
    render() {
        if (this.drawerOpen)
            return html ``; // Hide when drawer is open
        return html `
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
};
__decorate([
    property({ type: Boolean })
], FileDrawerToggle.prototype, "drawerOpen", void 0);
__decorate([
    property()
], FileDrawerToggle.prototype, "onClick", void 0);
FileDrawerToggle = __decorate([
    customElement("file-drawer-toggle")
], FileDrawerToggle);
export { FileDrawerToggle };
