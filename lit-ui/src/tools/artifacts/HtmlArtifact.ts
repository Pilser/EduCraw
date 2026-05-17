import hljs from "highlight.js";
import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { RefreshCw } from "lucide";
import { i18n } from "../../utils/i18n.js";
import { ArtifactElement } from "./ArtifactElement.js";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { CopyButton } from "@mariozechner/mini-lit/dist/CopyButton.js";
import { DownloadButton } from "@mariozechner/mini-lit/dist/DownloadButton.js";
import { PreviewCodeToggle } from "@mariozechner/mini-lit/dist/PreviewCodeToggle.js";

@customElement("html-artifact")
export class HtmlArtifact extends ArtifactElement {
	@property() override filename = "";

	private _content = "";
	private logs: Array<{ type: "log" | "error"; text: string }> = [];

	@state() private viewMode: "preview" | "code" = "preview";

	private setViewMode(mode: "preview" | "code") {
		this.viewMode = mode;
	}

	public getHeaderButtons() {
		const toggle = new PreviewCodeToggle();
		toggle.mode = this.viewMode;
		toggle.addEventListener("mode-change", (e: Event) => {
			this.setViewMode((e as CustomEvent).detail);
		});

		const copyButton = new CopyButton();
		copyButton.text = this._content;
		copyButton.title = i18n("Copy HTML");
		copyButton.showText = false;

		return html`
			<div class="flex items-center gap-2">
				${toggle}
				${Button({
					variant: "ghost",
					size: "sm",
					onClick: () => {
						this.logs = [];
						this.requestUpdate();
					},
					title: i18n("Reload HTML"),
					children: icon(RefreshCw, "sm"),
				})}
				${copyButton}
				${DownloadButton({ content: this._content, filename: this.filename, mimeType: "text/html", title: i18n("Download HTML") })}
			</div>
		`;
	}

	override set content(value: string) {
		const oldValue = this._content;
		this._content = value;
		if (oldValue !== value) {
			this.logs = [];
			this.requestUpdate();
		}
	}

	override get content(): string {
		return this._content;
	}

	public getLogs(): string {
		if (this.logs.length === 0) return i18n("No logs for {filename}").replace("{filename}", this.filename);
		return this.logs.map((l) => `[${l.type}] ${l.text}`).join("\n");
	}

	override render() {
		return html`
			<div class="h-full flex flex-col">
				<div class="flex-1 overflow-hidden relative">
					<div class="absolute inset-0 overflow-auto" style="display: ${this.viewMode === "preview" ? "block" : "none"}">
						<div class="p-0">${unsafeHTML(this._content)}</div>
					</div>

					<div class="absolute inset-0 overflow-auto bg-background" style="display: ${this.viewMode === "code" ? "block" : "none"}">
						<pre class="m-0 p-4 text-xs"><code class="hljs language-html">${unsafeHTML(
							hljs.highlight(this._content, { language: "html" }).value,
						)}</code></pre>
					</div>
				</div>
			</div>
		`;
	}
}
