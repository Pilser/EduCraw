import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { i18n } from "../../utils/i18n.js";
import { CopyButton } from "@mariozechner/mini-lit/dist/CopyButton.js";
import { DownloadButton } from "@mariozechner/mini-lit/dist/DownloadButton.js";
import { PreviewCodeToggle } from "@mariozechner/mini-lit/dist/PreviewCodeToggle.js";
import { ArtifactElement } from "./ArtifactElement.js";

declare global {
	interface Window {
		mermaid?: any;
	}
}

@customElement("mermaid-artifact")
export class MermaidArtifact extends ArtifactElement {
	@property() override filename = "diagram.mmd";

	private _content = "";
	override get content(): string {
		return this._content;
	}
	override set content(value: string) {
		this._content = value;
		this.requestUpdate();
	}

	@state() private viewMode: "preview" | "code" = "preview";
	@state() private mermaidLoaded = false;
	@state() private renderError = "";

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this; // light DOM
	}

	override connectedCallback(): void {
		super.connectedCallback();
		// Load mermaid on first connection if needed
		if (this.viewMode === "preview") {
			this.loadMermaid();
		}
	}

	private async loadMermaid() {
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
						} catch (e) {
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
		} catch (err) {
			this.renderError = err instanceof Error ? err.message : "Failed to load Mermaid";
			console.error("[Mermaid] Load error:", err);
		}
	}

	private setViewMode(mode: "preview" | "code") {
		this.viewMode = mode;
		if (mode === "preview") {
			this.loadMermaid();
		}
	}

	public getHeaderButtons() {
		const toggle = new PreviewCodeToggle();
		toggle.mode = this.viewMode;
		toggle.addEventListener("mode-change", (e: Event) => {
			this.setViewMode((e as CustomEvent).detail);
		});

		const copyButton = new CopyButton();
		copyButton.text = this._content;
		copyButton.title = i18n("Copy");
		copyButton.showText = false;

		return html`
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

	override render() {
		return html`
			<div class="h-full flex flex-col">
				<div class="flex-1 overflow-auto bg-white dark:bg-slate-950 flex items-center justify-center">
					${this.viewMode === "preview"
						? html`
							<div class="mermaid p-4 w-full flex justify-center">
								${this.renderError
									? html`<div class="text-red-500 text-sm">${this.renderError}</div>`
									: this._content}
							</div>
							${!this.mermaidLoaded
								? html`<script>
										if (window.mermaid) {
											window.mermaid.contentLoaded();
										}
									</script>`
								: ""}
						`
						: html`
							<pre class="m-0 p-4 text-xs whitespace-pre-wrap break-words w-full">
								<code class="language-mermaid">${unsafeHTML(
									this._content
										.replace(/&/g, "&amp;")
										.replace(/</g, "&lt;")
										.replace(/>/g, "&gt;")
										.replace(/"/g, "&quot;")
										.replace(/'/g, "&#39;"),
								)}</code>
							</pre>
						`}
				</div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"mermaid-artifact": MermaidArtifact;
	}
}
