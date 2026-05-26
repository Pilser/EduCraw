var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
let MermaidBlockComponent = class MermaidBlockComponent extends LitElement {
    constructor() {
        super(...arguments);
        this.content = "";
        this.error = "";
    }
    createRenderRoot() {
        return this;
    }
    connectedCallback() {
        super.connectedCallback();
        // Schedule rendering after DOM update
        requestAnimationFrame(() => this.loadAndRender());
        // Add resize observer for responsive scaling
        this.setupResizeObserver();
    }
    setupResizeObserver() {
        if (!window.ResizeObserver)
            return;
        const container = this.querySelector(".mermaid-container");
        if (!container)
            return;
        const observer = new ResizeObserver(() => {
            this.adjustMermaidScale();
        });
        observer.observe(container);
    }
    adjustMermaidScale() {
        const container = this.querySelector(".mermaid-container");
        const svg = container?.querySelector("svg");
        if (!svg || !container)
            return;
        // Get container and svg dimensions
        const containerWidth = container.clientWidth;
        const svgWidth = svg.getAttribute("width");
        const svgHeight = svg.getAttribute("height");
        if (!svgWidth || !svgHeight)
            return;
        const width = parseFloat(svgWidth);
        const height = parseFloat(svgHeight);
        const padding = 32;
        // On small screens (< 640px), center the diagram without scaling
        // to avoid truncation of complex diagrams
        if (containerWidth < 640) {
            // Don't scale, just center it
            svg.style.transform = "none";
            svg.style.maxWidth = "100%";
            svg.style.height = "auto";
            container.style.justifyContent = "center";
            container.style.overflow = "auto";
            return;
        }
        // On larger screens, scale down if needed
        if (width > containerWidth - padding) {
            const scale = (containerWidth - padding) / width;
            svg.setAttribute("width", `${width * scale}px`);
            svg.setAttribute("height", `${height * scale}px`);
            svg.style.transform = `scale(${scale})`;
            svg.style.transformOrigin = "top center";
        }
    }
    loadAndRender() {
        try {
            // Dynamically load mermaid script if not already loaded
            if (window.mermaid) {
                this.renderWithMermaid();
            }
            else {
                this.loadMermaidScript();
            }
        }
        catch (err) {
            this.error = err instanceof Error ? err.message : "Failed to render";
            console.error("[Mermaid] Error:", err);
        }
    }
    loadMermaidScript() {
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
    renderWithMermaid() {
        const mermaid = window.mermaid;
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
                        }
                        else {
                            this.error = "Mermaid render method not available";
                            this.requestUpdate();
                        }
                    }
                    catch (e) {
                        this.error = `Render error: ${e.message || "Invalid diagram"}`;
                        console.error("[Mermaid] Render error:", e);
                        this.requestUpdate();
                    }
                }
            });
        }
        catch (err) {
            this.error = err instanceof Error ? err.message : "Failed to render";
            console.error("[Mermaid] Render error:", err);
            this.requestUpdate();
        }
    }
    render() {
        if (this.error) {
            return html `
				<div class="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 my-2">
					<div class="text-sm text-red-700 dark:text-red-300 font-medium">Error: ${this.error}</div>
					<details class="text-xs text-red-600 dark:text-red-400 mt-2">
						<summary class="cursor-pointer hover:underline">Show code</summary>
						<pre class="mt-1 bg-red-100 dark:bg-red-900 p-2 rounded text-xs overflow-auto">${this.content}</pre>
					</details>
				</div>
			`;
        }
        return html `
			<style>
				.mermaid-wrapper {
					width: 100%;
					overflow: auto;
					display: flex;
					justify-content: center;
					align-items: flex-start;
				}
				.mermaid-container {
					width: 100%;
					height: 100%;
					display: flex;
					justify-content: center;
					align-items: flex-start;
					overflow: visible;
				}
				.mermaid-diagram {
					display: block;
					max-width: 100%;
					width: auto;
					height: auto;
				}
				.mermaid-diagram svg {
					max-width: 100%;
					height: auto;
					display: block;
					margin: 0 auto;
				}
			</style>
			<div class="mermaid-wrapper my-2 p-2 sm:p-3 md:p-4 rounded-lg bg-white dark:bg-slate-950 border border-border" style="min-height: 200px; max-height: 70vh;">
				<div class="mermaid-container">
					<div class="mermaid-diagram"></div>
				</div>
			</div>
		`;
    }
};
__decorate([
    property()
], MermaidBlockComponent.prototype, "content", void 0);
__decorate([
    state()
], MermaidBlockComponent.prototype, "error", void 0);
MermaidBlockComponent = __decorate([
    customElement("mermaid-block")
], MermaidBlockComponent);
export { MermaidBlockComponent };
