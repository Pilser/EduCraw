import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { X, Download, Paperclip, ChevronLeft, ChevronRight } from "lucide";
import { eduApi } from "../core/edu-api.js";
import { handleError } from "../core/error-handler.js";
import { i18n } from "../utils/i18n.js";
import { marked } from "marked";
import hljs from "highlight.js";
import * as pdfjsLib from "pdfjs-dist";
import * as docxPreview from "docx-preview";
import * as XLSX from "xlsx";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// Configure marked for syntax highlighting
(marked as any).setOptions({
	breaks: true,
	gfm: true,
});

interface FileNode {
	name: string;
	path: string;
	kind: "file" | "dir";
	size?: number;
}

type FileType = "markdown" | "image" | "pdf" | "docx" | "xlsx" | "code" | "text" | "unknown";

@customElement("file-preview-modal")
export class FilePreviewModal extends LitElement {
	@property({ type: Boolean }) open = false;
	@property({ type: Object }) fileNode?: FileNode;
	@property({ type: Boolean }) isSubject = false;
	@property({ type: String }) subjectId?: string;
	@property({ type: String }) sessionId = "";
	@property({ type: String }) sessionToken = "";
	@property({ type: String }) studentToken = "";

	@property() onClose?: () => void;
	@property() onAttach?: (node: FileNode, isSubject: boolean, subjectId?: string) => void;

	@state() private content: string | Uint8Array | null = null;
	@state() private loading = false;
	@state() private error = "";
	@state() private fileType: FileType = "unknown";
	@state() private currentPage = 1;
	@state() private totalPages = 1;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback() {
		super.connectedCallback();
		this.style.display = "block";
	}

	override async updated(changedProperties: Map<string, any>) {
		super.updated(changedProperties);

		if ((changedProperties.has("open") || changedProperties.has("fileNode")) && this.open && this.fileNode) {
			await this.loadFile();
		}

		// Render PDF/DOCX/XLSX after DOM is ready
		if (changedProperties.has("content") && this.content && !this.loading) {
			await this.updateComplete;
			if (this.fileType === "pdf") {
				await this.renderPdf();
			} else if (this.fileType === "docx") {
				await this.renderDocx();
			} else if (this.fileType === "xlsx") {
				this.renderXlsx();
			}
		}
	}

	private detectFileType(fileName: string): FileType {
		const lower = fileName.toLowerCase();
		if (lower.endsWith(".md")) return "markdown";
		if (lower.match(/\.(png|jpg|jpeg|gif|svg|webp)$/)) return "image";
		if (lower.endsWith(".pdf")) return "pdf";
		if (lower.endsWith(".docx")) return "docx";
		if (lower.match(/\.(xlsx|xls)$/)) return "xlsx";
		if (lower.match(/\.(py|js|ts|jsx|tsx|rs|go|rb|java|cpp|c|h|php|css|html|json|xml|yaml|yml|sh)$/)) return "code";
		if (lower.match(/\.(txt|csv|log|rst)$/)) return "text";
		return "unknown";
	}

	private async loadFile() {
		if (!this.fileNode) return;

		this.loading = true;
		this.error = "";
		this.content = null;
		this.fileType = this.detectFileType(this.fileNode.name);
		this.currentPage = 1;
		this.requestUpdate();

		try {
			const token = this.isSubject ? this.studentToken : this.sessionToken;
			const blob = this.isSubject
				? await eduApi.readSubjectFile(this.subjectId!, this.fileNode.path, token)
				: await eduApi.readStudentFile(this.sessionId, this.fileNode.path, token);

			// Handle different file types
			if (this.fileType === "image") {
				const url = URL.createObjectURL(blob);
				this.content = url;
			} else if (this.fileType === "pdf" || this.fileType === "docx" || this.fileType === "xlsx") {
				const arrayBuffer = await blob.arrayBuffer();
				this.content = new Uint8Array(arrayBuffer);
				// Rendering will be triggered in updated() lifecycle after DOM is ready
			} else {
				// Text-based files
				const text = await blob.text();
				this.content = text;
			}
		} catch (err) {
			const e = handleError(err);
			this.error = e.message || "Failed to load file";
		} finally {
			this.loading = false;
			this.requestUpdate();
		}
	}

	private async renderPdf() {
		const container = this.querySelector("#pdf-preview-container");
		if (!container || !this.content || !(this.content instanceof Uint8Array)) return;

		try {
			const loadingTask = pdfjsLib.getDocument({ data: this.content });
			const pdf = await loadingTask.promise;
			this.totalPages = pdf.numPages;

			container.innerHTML = "";
			const wrapper = document.createElement("div");
			wrapper.className = "p-4 space-y-4";
			container.appendChild(wrapper);

			// Render all pages
			for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
				const page = await pdf.getPage(pageNum);
				const pageContainer = document.createElement("div");
				pageContainer.className = "relative";

				const canvas = document.createElement("canvas");
				const context = canvas.getContext("2d");
				const viewport = page.getViewport({ scale: 1.5 });

				canvas.height = viewport.height;
				canvas.width = viewport.width;
				canvas.className = "w-full max-w-full h-auto block mx-auto bg-white rounded shadow-sm border border-border";

				if (context) {
					context.fillStyle = "white";
					context.fillRect(0, 0, canvas.width, canvas.height);
					await page.render({ 
						canvasContext: context, 
						viewport,
						canvas 
					}).promise;
				}

				// Page number badge
				const badge = document.createElement("div");
				badge.className = "absolute top-2 right-2 bg-background/90 text-foreground px-2 py-1 rounded text-xs font-medium border border-border";
				badge.textContent = `Page ${pageNum} / ${pdf.numPages}`;
				
				pageContainer.appendChild(canvas);
				pageContainer.appendChild(badge);
				wrapper.appendChild(pageContainer);
			}

			pdf.destroy();
		} catch (err) {
			handleError(err);
			this.error = "Failed to render PDF";
			this.requestUpdate();
		}
	}

	private async renderDocx() {
		const container = this.querySelector("#docx-preview-container");
		if (!container || !this.content || !(this.content instanceof Uint8Array)) return;

		try {
			container.innerHTML = "";
			await docxPreview.renderAsync(this.content.buffer, container as HTMLElement, undefined, {
				className: "docx-preview-content",
				inWrapper: true,
				ignoreWidth: false,
				ignoreHeight: false,
				renderHeaders: true,
				renderFooters: true,
			});
		} catch (err) {
			handleError(err);
			this.error = "Failed to render DOCX";
			this.requestUpdate();
		}
	}

	private renderXlsx() {
		const container = this.querySelector("#xlsx-preview-container");
		if (!container || !this.content || !(this.content instanceof Uint8Array)) return;

		try {
			const workbook = XLSX.read(this.content, { type: "array" });
			container.innerHTML = "";

			// Render each sheet
			workbook.SheetNames.forEach((sheetName, index) => {
				const worksheet = workbook.Sheets[sheetName];
				
				// Sheet header
				const header = document.createElement("div");
				header.className = "bg-muted px-3 py-2 border-b border-border font-medium text-sm";
				header.textContent = sheetName;
				container.appendChild(header);

				// Convert sheet to HTML table
				const htmlTable = XLSX.utils.sheet_to_html(worksheet, { id: `sheet-${index}` });
				const tableContainer = document.createElement("div");
				tableContainer.className = "overflow-auto p-3";
				tableContainer.innerHTML = htmlTable;

				// Style the table
				const table = tableContainer.querySelector("table");
				if (table) {
					table.className = "w-full border-collapse text-sm";
					table.querySelectorAll("td, th").forEach(cell => {
						cell.classList.add("border", "border-border", "px-3", "py-2");
					});
					table.querySelectorAll("th").forEach(cell => {
						cell.classList.add("bg-muted", "font-semibold", "text-left");
					});
				}

				container.appendChild(tableContainer);
			});
		} catch (err) {
			handleError(err);
			this.error = "Failed to render Excel file";
			this.requestUpdate();
		}
	}

	private handleDownload() {
		if (!this.fileNode) return;

		const token = this.isSubject ? this.studentToken : this.sessionToken;
		const fetchPromise = this.isSubject
			? eduApi.readSubjectFile(this.subjectId!, this.fileNode.path, token)
			: eduApi.readStudentFile(this.sessionId, this.fileNode.path, token);

		fetchPromise.then(blob => {
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = this.fileNode!.name;
			a.click();
			URL.revokeObjectURL(url);
		}).catch(err => {
			const e = handleError(err);
			alert(`Download failed: ${e.message || "Unknown error"}`);
		});
	}

	private handleAttach() {
		if (!this.fileNode) return;
		this.onAttach?.(this.fileNode, this.isSubject, this.subjectId);
	}

	private getLanguageFromFileName(fileName: string): string {
		const lower = fileName.toLowerCase();
		if (lower.endsWith(".py")) return "python";
		if (lower.endsWith(".rs")) return "rust";
		if (lower.endsWith(".js")) return "javascript";
		if (lower.endsWith(".ts")) return "typescript";
		if (lower.endsWith(".jsx")) return "jsx";
		if (lower.endsWith(".tsx")) return "tsx";
		if (lower.endsWith(".go")) return "go";
		if (lower.endsWith(".rb")) return "ruby";
		if (lower.endsWith(".java")) return "java";
		if (lower.match(/\.(cpp|cc)$/)) return "cpp";
		if (lower.endsWith(".c")) return "c";
		if (lower.endsWith(".h")) return "c";
		if (lower.endsWith(".php")) return "php";
		if (lower.endsWith(".css")) return "css";
		if (lower.match(/\.(html|htm)$/)) return "html";
		if (lower.endsWith(".json")) return "json";
		if (lower.endsWith(".xml")) return "xml";
		if (lower.match(/\.(yaml|yml)$/)) return "yaml";
		if (lower.match(/\.(sh|bash)$/)) return "bash";
		return "plaintext";
	}

	private renderPreviewContent(): TemplateResult {
		if (this.loading) {
			return html`
				<div class="flex items-center justify-center h-full">
					<div class="text-center">
						<div class="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin mx-auto mb-2"></div>
						<p class="text-sm text-muted-foreground">Loading file...</p>
					</div>
				</div>
			`;
		}

		if (this.error) {
			return html`
				<div class="flex items-center justify-center h-full p-4">
					<div class="text-center">
						<p class="text-destructive font-medium mb-2">Failed to load file</p>
						<p class="text-sm text-muted-foreground">${this.error}</p>
					</div>
				</div>
			`;
		}

		if (!this.content) {
			return html`<div class="flex items-center justify-center h-full text-muted-foreground">No content</div>`;
		}

		// Render based on file type
		switch (this.fileType) {
			case "image":
				return html`
					<div class="flex items-center justify-center h-full p-4 bg-muted/30">
						<img 
							src="${this.content}" 
							alt="${this.fileNode?.name}" 
							class="max-w-full max-h-full object-contain rounded shadow-lg"
						/>
					</div>
				`;

			case "pdf":
				return html`<div id="pdf-preview-container" class="h-full overflow-auto bg-muted/20"></div>`;

			case "docx":
				return html`
					<div id="docx-preview-container" class="h-full overflow-auto p-4 bg-background">
						<style>
							.docx-preview-content { max-width: 800px; margin: 0 auto; background: white; padding: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
						</style>
					</div>
				`;

			case "xlsx":
				return html`<div id="xlsx-preview-container" class="h-full overflow-auto bg-background"></div>`;

			case "markdown":
				// Parse markdown synchronously (marked.parse can return Promise or string)
				const mdResult = marked.parse(this.content as string);
				const mdHtml = typeof mdResult === 'string' ? mdResult : '';
				return html`
					<div class="h-full overflow-auto p-6 prose prose-sm max-w-none dark:prose-invert">
						<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github-dark.min.css">
						${unsafeHTML(mdHtml)}
					</div>
				`;

			case "code":
				const lang = this.getLanguageFromFileName(this.fileNode?.name || "");
				const highlighted = hljs.highlight(this.content as string, { language: lang }).value;
				return html`
					<div class="h-full overflow-auto p-4 bg-background">
						<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github-dark.min.css">
						<pre class="hljs rounded p-4 text-sm"><code>${unsafeHTML(highlighted)}</code></pre>
					</div>
				`;

			case "text":
			case "unknown":
			default:
				return html`
					<div class="h-full overflow-auto p-4 bg-muted/20">
						<pre class="text-sm text-foreground font-mono whitespace-pre-wrap break-words">${this.content}</pre>
					</div>
				`;
		}
	}

	override render() {
		if (!this.open) return html``;

		return html`
			<!-- Modal Overlay -->
			<div class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
				<!-- Modal Container (responsive sizing) -->
				<div class="relative w-full h-full md:h-[90vh] md:max-w-5xl md:rounded-lg overflow-hidden bg-card border border-border shadow-2xl flex flex-col">
					<!-- Header -->
					<div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-card">
						<div class="flex items-center gap-2 flex-1 min-w-0">
							<span class="text-base font-semibold text-foreground truncate" title="${this.fileNode?.name}">
								${this.fileNode?.name}
							</span>
							${this.fileNode?.size
								? html`
									<span class="text-xs text-muted-foreground shrink-0">
										(${this.formatFileSize(this.fileNode.size)})
									</span>
								`
								: ""}
						</div>
						
						<!-- Header Actions -->
						<div class="flex items-center gap-1 shrink-0">
							<button
								class="h-8 px-3 flex items-center gap-1.5 hover:bg-secondary rounded transition-colors text-sm"
								@click=${this.handleDownload}
								title="Download"
							>
								${icon(Download, "xs")}
								<span class="hidden md:inline">${i18n('Download')}</span>
							</button>
							<button
								class="h-8 px-3 flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded transition-colors text-sm font-medium"
								@click=${this.handleAttach}
								title="Attach to chat"
							>
								${icon(Paperclip, "xs")}
								<span class="hidden md:inline">Attach</span>
							</button>
							<button
								class="h-8 w-8 flex items-center justify-center hover:bg-secondary rounded transition-colors ml-1"
								@click=${() => {
									this.open = false;
									this.onClose?.();
								}}
								title="${i18n('Close')}"
							>
								${icon(X, "sm")}
							</button>
						</div>
					</div>

					<!-- Preview Content Area -->
					<div class="flex-1 overflow-hidden">
						${this.renderPreviewContent()}
					</div>
				</div>
			</div>
		`;
	}

	private formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"file-preview-modal": FilePreviewModal;
	}
}
