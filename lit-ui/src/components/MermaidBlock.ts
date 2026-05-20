import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

@customElement("mermaid-block")
export class MermaidBlockComponent extends LitElement {
	@property() content: string = "";
	@state() private error = "";

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		// Schedule rendering after DOM update
		requestAnimationFrame(() => this.loadAndRender());
		// Add resize observer for responsive scaling
		this.setupResizeObserver();
	}

	private setupResizeObserver() {
		if (!window.ResizeObserver) return;

		const container = this.querySelector(".mermaid-container");
		if (!container) return;

		const observer = new ResizeObserver(() => {
			this.adjustMermaidScale();
		});

		observer.observe(container);
	}

	private adjustMermaidScale() {
		const container = this.querySelector(".mermaid-container");
		const svg = container?.querySelector("svg");
		
		if (!svg || !container) return;

		// Get container width
		const containerWidth = container.clientWidth;
		const svgWidth = svg.getAttribute("width");
		const svgHeight = svg.getAttribute("height");

		if (!svgWidth || !svgHeight) return;

		const width = parseFloat(svgWidth);
		const height = parseFloat(svgHeight);

		if (width > containerWidth - 32) {
			const scale = (containerWidth - 32) / width;
			svg.setAttribute("width", `${width * scale}px`);
			svg.setAttribute("height", `${height * scale}px`);
			svg.style.transform = `scale(${scale})`;
			svg.style.transformOrigin = "top center";
		}
	}

	private loadAndRender() {
		try {
			// Dynamically load mermaid script if not already loaded
			if ((window as any).mermaid) {
				this.renderWithMermaid();
			} else {
				this.loadMermaidScript();
			}
		} catch (err) {
			this.error = err instanceof Error ? err.message : "Failed to render";
			console.error("[Mermaid] Error:", err);
		}
	}

	private loadMermaidScript() {
		const script = document.createElement("script");
		script.src = "https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js";
		script.async = true;

		script.onload = () => {
			this.renderWithMermaid();
		};

		script.onerror = () => {
			this.error = "Failed to load Mermaid library";
			this.requestUpdate();
		};

		document.head.appendChild(script);
	}

	private renderWithMermaid() {
		const mermaid = (window as any).mermaid;
		if (!mermaid) {
			this.error = "Mermaid library not available";
			this.requestUpdate();
			return;
		}

		try {
			// Initialize mermaid with responsive config
			mermaid.initialize({
				startOnLoad: false,
				securityLevel: "loose",
				theme: "default",
				flowchart: {
					useMaxWidth: true,
					htmlLabels: true,
				},
			});

			// Find container and render
			requestAnimationFrame(async () => {
				const container = this.querySelector(".mermaid-diagram");
				if (container) {
					// Clear and set mermaid class FIRST
					container.innerHTML = "";
					container.classList.add("mermaid");
					container.id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
					
					// Set content with proper escaping
					container.textContent = this.content;
					
					try {
						// Use mermaid.run() to render all mermaid divs
						if (mermaid.run) {
							await mermaid.run();
							console.log("[Mermaid] Rendered successfully");
							// Adjust scaling after render
							setTimeout(() => this.adjustMermaidScale(), 100);
						} else {
							this.error = "Mermaid render method not available";
							this.requestUpdate();
						}
					} catch (e: any) {
						this.error = `Render error: ${e.message || "Invalid diagram"}`;
						console.error("[Mermaid] Render error:", e);
						this.requestUpdate();
					}
				}
			});
		} catch (err) {
			this.error = err instanceof Error ? err.message : "Failed to render";
			console.error("[Mermaid] Render error:", err);
			this.requestUpdate();
		}
	}

	override render() {
		if (this.error) {
			return html`
				<div class="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 my-2">
					<div class="text-sm text-red-700 dark:text-red-300 font-medium">Error: ${this.error}</div>
					<details class="text-xs text-red-600 dark:text-red-400 mt-2">
						<summary class="cursor-pointer hover:underline">Show code</summary>
						<pre class="mt-1 bg-red-100 dark:bg-red-900 p-2 rounded text-xs overflow-auto">${this.content}</pre>
					</details>
				</div>
			`;
		}

		return html`
			<style>
				.mermaid-container {
					width: 100%;
					overflow-x: auto;
					overflow-y: hidden;
					display: flex;
					justify-content: center;
				}
				.mermaid-diagram {
					display: block;
					max-width: 100%;
					width: 100%;
					height: auto;
				}
				.mermaid-diagram svg {
					max-width: 100%;
					height: auto;
					display: block;
				}
			</style>
			<div class="mermaid-container my-2 p-2 sm:p-3 md:p-4 rounded-lg bg-white dark:bg-slate-950 border border-border min-h-[150px] sm:min-h-[200px]">
				<div class="mermaid-diagram"></div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"mermaid-block": MermaidBlockComponent;
	}
}
