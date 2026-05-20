var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { i18n } from "../../utils/i18n.js";
import { CopyButton } from "@mariozechner/mini-lit/dist/CopyButton.js";
import { DownloadButton } from "@mariozechner/mini-lit/dist/DownloadButton.js";
import { PreviewCodeToggle } from "@mariozechner/mini-lit/dist/PreviewCodeToggle.js";
import { ArtifactElement } from "./ArtifactElement.js";
let MermaidArtifact = class MermaidArtifact extends ArtifactElement {
    constructor() {
        super(...arguments);
        this.filename = "diagram.mmd";
        this._content = "";
        this.viewMode = "preview";
        this.mermaidLoaded = false;
        this.renderError = "";
    }
    get content() {
        return this._content;
    }
    set content(value) {
        this._content = value;
        this.requestUpdate();
    }
    createRenderRoot() {
        return this; // light DOM
    }
    connectedCallback() {
        super.connectedCallback();
        // Load mermaid on first connection if needed
        if (this.viewMode === "preview") {
            this.loadMermaid();
        }
    }
    async loadMermaid() {
        if (this.mermaidLoaded || window.mermaid) {
            return;
        }
        try {
            // Lazy load mermaid from CDN
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
            script.type = "module";
            script.onload = async () => {
                if (window.mermaid) {
                    window.mermaid.initialize({ startOnLoad: true, theme: "default" });
                    this.mermaidLoaded = true;
                    // Re-render to trigger mermaid processing
                    this.requestUpdate();
                    // Wait for DOM update, then run mermaid
                    await this.updateComplete;
                    if (window.mermaid.contentLoaded) {
                        try {
                            await window.mermaid.contentLoaded();
                        }
                        catch (e) {
                            console.warn("Mermaid content loading:", e);
                        }
                    }
                }
            };
            script.onerror = () => {
                this.renderError = "Failed to load Mermaid library";
                this.mermaidLoaded = false;
            };
            document.head.appendChild(script);
        }
        catch (err) {
            this.renderError = err instanceof Error ? err.message : "Failed to load Mermaid";
            console.error("[Mermaid] Load error:", err);
        }
    }
    setViewMode(mode) {
        this.viewMode = mode;
        if (mode === "preview") {
            this.loadMermaid();
        }
    }
    getHeaderButtons() {
        const toggle = new PreviewCodeToggle();
        toggle.mode = this.viewMode;
        toggle.addEventListener("mode-change", (e) => {
            this.setViewMode(e.detail);
        });
        const copyButton = new CopyButton();
        copyButton.text = this._content;
        copyButton.title = i18n("Copy");
        copyButton.showText = false;
        return html `
			<div class="flex items-center gap-2">
				${toggle}
				${copyButton}
				${DownloadButton({
            content: this._content,
            filename: this.filename,
            mimeType: "text/mermaid",
            title: i18n("Download"),
        })}
			</div>
		`;
    }
    render() {
        return html `
			<div class="h-full flex flex-col">
				<div class="flex-1 overflow-auto bg-white dark:bg-slate-950 flex items-center justify-center">
					${this.viewMode === "preview"
            ? html `
							<div class="mermaid p-4 w-full flex justify-center">
								${this.renderError
                ? html `<div class="text-red-500 text-sm">${this.renderError}</div>`
                : this._content}
							</div>
							${!this.mermaidLoaded
                ? html `<script>
										if (window.mermaid) {
											window.mermaid.contentLoaded();
										}
									</script>`
                : ""}
						`
            : html `
							<pre class="m-0 p-4 text-xs whitespace-pre-wrap break-words w-full">
								<code class="language-mermaid">${unsafeHTML(this._content
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;"))}</code>
							</pre>
						`}
				</div>
			</div>
		`;
    }
};
__decorate([
    property()
], MermaidArtifact.prototype, "filename", void 0);
__decorate([
    state()
], MermaidArtifact.prototype, "viewMode", void 0);
__decorate([
    state()
], MermaidArtifact.prototype, "mermaidLoaded", void 0);
__decorate([
    state()
], MermaidArtifact.prototype, "renderError", void 0);
MermaidArtifact = __decorate([
    customElement("mermaid-artifact")
], MermaidArtifact);
export { MermaidArtifact };
