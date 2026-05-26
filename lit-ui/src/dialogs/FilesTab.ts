import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { icon } from "@mariozechner/mini-lit";
import { html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { MenuTab } from "./MenuDialog.js";
import { eduApi } from "../core/edu-api.js";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Download, Trash2, FilePlus, FileText, FileCode, FileJson, Image as ImageIcon, FileSpreadsheet, FileVideo, FileAudio, Archive, FileType, HardDrive } from "lucide";

interface FileNode {
	name: string;
	path: string;
	kind: "file" | "dir";
	size?: number;
	children?: FileNode[];
}

@customElement("files-tab")
export class FilesTab extends MenuTab {
	@property({ type: String }) sessionId = "";
	@property({ type: String }) sessionToken = "";
	@property({ type: String }) studentToken = "";
	@property({ type: Array }) subjectIds: string[] = [];
	@property({ attribute: false }) onPreviewFile?: (node: FileNode, isSubject: boolean, subjectId?: string) => void;

	@state() private subjectFiles: FileNode[] = [];
	@state() private studentFiles: FileNode[] = [];
	@state() private loading = false;
	@state() private error = "";
	@state() private expandedPaths = new Set<string>();
	@state() private initialized = false;
	@state() private quota: { used_bytes: number; quota_bytes: number } | null = null;

	async updated(changedProperties: Map<string, any>) {
		super.updated(changedProperties);
		
		// Load files once we have the required properties
		if (!this.initialized && this.sessionId && this.sessionToken) {
			console.log("[FilesTab] Loading files", { sessionId: this.sessionId, subjectIds: this.subjectIds });
			this.initialized = true;
			await this.loadFiles();
		}
	}

	private async loadFiles() {
		this.loading = true;
		this.error = "";
		this.requestUpdate();

		try {
			console.log("[FilesTab] Loading files...", {
				subjectIds: this.subjectIds,
				sessionId: this.sessionId,
				hasStudentToken: !!this.studentToken,
				hasSessionToken: !!this.sessionToken
			});

			// Load subject files if available
			if (this.subjectIds.length > 0 && this.studentToken) {
				try {
					console.log("[FilesTab] Requesting subject files for:", this.subjectIds[0]);
					this.subjectFiles = await eduApi.listSubjectFiles(
						this.subjectIds[0],
						this.studentToken
					);
					console.log("[FilesTab] Subject files loaded:", this.subjectFiles.length, this.subjectFiles);
				} catch (err) {
					console.warn("[FilesTab] Failed to load subject files:", err);
					this.error = `Subject files: ${err instanceof Error ? err.message : "Unknown error"}`;
				}
			} else {
				console.log("[FilesTab] Skipping subject files - no subject IDs or token");
			}

			// Load student workspace files
			if (this.sessionId && this.sessionToken) {
				try {
					console.log("[FilesTab] Requesting student files for session:", this.sessionId);
					this.studentFiles = await eduApi.listStudentFiles(
						this.sessionId,
						this.sessionToken
					);
					console.log("[FilesTab] Student files loaded:", this.studentFiles.length, this.studentFiles);
				} catch (err) {
					console.warn("[FilesTab] Failed to load student files:", err);
					if (!this.error) {
						this.error = `Student files: ${err instanceof Error ? err.message : "Unknown error"}`;
					}
				}
				try {
					this.quota = await eduApi.getStudentQuota(
						this.sessionId,
						this.sessionToken
					);
				} catch (err) {
					console.warn("[FilesTab] Failed to load quota:", err);
				}
			} else {
				console.log("[FilesTab] Skipping student files - no session ID or token");
			}
		} catch (err) {
			console.error("[FilesTab] Failed to load files:", err);
			this.error = err instanceof Error ? err.message : "Failed to load files";
		} finally {
			this.loading = false;
			this.requestUpdate();
		}
	}

	private toggleExpand(path: string) {
		if (this.expandedPaths.has(path)) {
			this.expandedPaths.delete(path);
		} else {
			this.expandedPaths.add(path);
		}
		this.requestUpdate();
	}

	private handleFileClick(node: FileNode, isStudentFile: boolean) {
		if (node.kind === "dir") {
			this.toggleExpand(node.path);
			return;
		}

		// If preview callback is provided, use it; otherwise download
		if (this.onPreviewFile) {
			const subjectId = !isStudentFile && this.subjectIds.length > 0 ? this.subjectIds[0] : undefined;
			this.onPreviewFile(node, !isStudentFile, subjectId);
		} else {
			this.downloadFile(node, isStudentFile);
		}
	}

	private async downloadFile(node: FileNode, isStudentFile: boolean) {

		// Open file in new tab for preview/download
		try {
			let blob: Blob;
			if (isStudentFile) {
				blob = await eduApi.readStudentFile(
					this.sessionId,
					node.path,
					this.sessionToken
				);
			} else {
				blob = await eduApi.readSubjectFile(
					this.subjectIds[0],
					node.path,
					this.studentToken
				);
			}

			// Create object URL and open in new tab
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = node.name;
			a.target = "_blank"; // Open in new tab
			a.click();
			
			// Clean up after a delay
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (err) {
			console.error("Failed to open file:", err);
			alert(`Failed to open file: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	}

	private async handleDeleteFile(node: FileNode) {
		if (!confirm(`Are you sure you want to delete "${node.name}"?`)) {
			return;
		}

		try {
			await eduApi.deleteStudentFile(
				this.sessionId,
				node.path,
				this.sessionToken
			);
			await this.loadFiles();
		} catch (err) {
			console.error("Failed to delete file:", err);
			alert(`Failed to delete file: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	}

	private async handleUploadFile() {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;

		input.onchange = async () => {
			const files = input.files;
			if (!files) return;

			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				try {
					await eduApi.writeStudentFile(
						this.sessionId,
						file.name,
						file,
						this.sessionToken
					);
				} catch (err) {
					console.error(`Failed to upload ${file.name}:`, err);
					alert(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
				}
			}

			await this.loadFiles();
		};

		input.click();
	}

	private renderFileTree(nodes: FileNode[], isStudentFile: boolean, level = 0): TemplateResult {
		return html`
			${nodes.map(
				(node) => html`
					<div class="select-none">
						<div
							class="group flex items-center gap-2 px-2 py-1.5 hover:bg-secondary rounded cursor-pointer transition-colors"
							style="padding-left: ${level * 16 + 8}px"
							@click=${() => this.handleFileClick(node, isStudentFile)}
						>
							${node.kind === "dir"
							? html`
								<span class="w-4 h-4 flex-shrink-0">
									${this.expandedPaths.has(node.path)
										? icon(ChevronDown, "xs")
										: icon(ChevronRight, "xs")}
								</span>
								<span class="w-4 h-4 flex-shrink-0">
									${this.expandedPaths.has(node.path)
										? icon(FolderOpen, "xs", "text-yellow-500")
										: icon(Folder, "xs", "text-yellow-600")}
								</span>
							`
							: html`
								<span class="w-4 h-4 flex-shrink-0"></span>
								<span class="w-4 h-4 flex-shrink-0">
									${this.getFileIcon(node.name, "xs")}
								</span>
							`}
						<span class="text-sm text-foreground flex-1 truncate">${node.name}</span>
						${node.size !== undefined
							? html`<span class="text-xs text-muted-foreground shrink-0">${this.formatFileSize(node.size)}</span>`
							: ""}
						${isStudentFile && node.kind === "file"
							? html`
								<button
									class="w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/20 rounded transition-all"
									@click=${(e: Event) => {
										e.stopPropagation();
										this.handleDeleteFile(node);
									}}
									title="Delete"
								>
									${icon(Trash2, "xs", "text-destructive")}
								</button>
							`
							: node.kind === "file"
								? html`
									<button
										class="w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-primary/20 rounded transition-all"
										@click=${(e: Event) => {
											e.stopPropagation();
											this.downloadFile(node, isStudentFile);
										}}
										title="Download"
									>
										${icon(Download, "xs", "text-primary")}
									</button>
								`
								: ""}
							${node.kind === "file"
								? html`
									<div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
										<button
											class="w-6 h-6 flex items-center justify-center hover:bg-primary/20 rounded transition-colors"
											@click=${(e: Event) => {
												e.stopPropagation();
												this.downloadFile(node, isStudentFile);
											}}
											title="Download"
										>
											${icon(Download, "xs")}
										</button>
										${isStudentFile
											? html`
												<button
													class="w-6 h-6 flex items-center justify-center hover:bg-destructive/20 rounded transition-colors"
													@click=${(e: Event) => {
														e.stopPropagation();
														this.handleDeleteFile(node);
													}}
													title="Delete"
												>
													${icon(Trash2, "xs")}
												</button>
											`
											: ""}
									</div>
								`
								: ""}
						</div>
						${node.kind === "dir" &&
						this.expandedPaths.has(node.path) &&
						node.children &&
						node.children.length > 0
							? this.renderFileTree(node.children, isStudentFile, level + 1)
							: ""}
					</div>
				`
			)}
		`;
	}

	private formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	private getFileIcon(fileName: string, size: "xs" | "sm" | "md" = "xs") {
		const lower = fileName.toLowerCase();
		
		// Documents
		if (lower.endsWith('.pdf')) return icon(FileText, size, "text-red-500");
		if (lower.endsWith('.md')) return icon(FileText, size, "text-blue-500");
		if (lower.match(/\.(doc|docx)$/)) return icon(FileText, size, "text-blue-600");
		if (lower.endsWith('.txt')) return icon(FileType, size, "text-gray-500");
		
		// Spreadsheets
		if (lower.match(/\.(xlsx?|csv)$/)) return icon(FileSpreadsheet, size, "text-green-600");
		
		// Images
		if (lower.match(/\.(png|jpg|jpeg)$/)) return icon(ImageIcon, size, "text-purple-500");
		if (lower.match(/\.(svg|gif|webp)$/)) return icon(ImageIcon, size, "text-purple-400");
		
		// Code files
		if (lower.match(/\.(py|pyw)$/)) return icon(FileCode, size, "text-blue-400");
		if (lower.match(/\.(js|jsx|ts|tsx)$/)) return icon(FileCode, size, "text-yellow-500");
		if (lower.match(/\.(rs|toml)$/)) return icon(FileCode, size, "text-orange-500");
		if (lower.match(/\.(cpp|c|h|hpp)$/)) return icon(FileCode, size, "text-blue-600");
		if (lower.match(/\.(java|kt|scala)$/)) return icon(FileCode, size, "text-red-600");
		if (lower.match(/\.(go|mod)$/)) return icon(FileCode, size, "text-cyan-500");
		if (lower.match(/\.(php|rb|lua)$/)) return icon(FileCode, size, "text-purple-600");
		if (lower.match(/\.(html|htm|xml)$/)) return icon(FileCode, size, "text-orange-600");
		if (lower.match(/\.(css|scss|sass|less)$/)) return icon(FileCode, size, "text-blue-500");
		
		// Data files
		if (lower.endsWith('.json')) return icon(FileJson, size, "text-yellow-600");
		if (lower.match(/\.(yaml|yml)$/)) return icon(FileJson, size, "text-red-500");
		
		// Media
		if (lower.match(/\.(mp4|avi|mov|mkv|webm)$/)) return icon(FileVideo, size, "text-pink-500");
		if (lower.match(/\.(mp3|wav|ogg|flac|m4a)$/)) return icon(FileAudio, size, "text-indigo-500");
		
		// Archives
		if (lower.match(/\.(zip|tar|gz|rar|7z)$/)) return icon(Archive, size, "text-yellow-700");
		
		// Default
		return icon(File, size, "text-muted-foreground");
	}

	getTabName(): string {
		return "Files";
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-6">
				${this.loading
					? html`<div class="text-center py-8 text-muted-foreground">Loading files...</div>`
					: this.error
						? html`<div class="text-center py-8 text-destructive">${this.error}</div>`
						: html`
							<!-- Subject Files (Read-Only) -->
							<div class="space-y-3">
								<div class="flex items-center justify-between">
									<h3 class="text-lg font-semibold text-foreground">Course Materials</h3>
									<span class="text-xs text-muted-foreground">(Read-only)</span>
								</div>
								<div class="border border-border rounded-lg overflow-hidden">
									<div class="max-h-64 overflow-y-auto p-2">
										${this.subjectFiles.length > 0
											? this.renderFileTree(this.subjectFiles, false)
											: html`<div class="text-sm text-muted-foreground text-center py-4">No course materials available</div>`}
									</div>
								</div>
							</div>

							<!-- Student Workspace (Read-Write) -->
							<div class="space-y-3">
								<div class="flex items-center justify-between">
									<h3 class="text-lg font-semibold text-foreground">Your Workspace</h3>
									${Button({
										variant: "ghost",
										size: "sm",
										children: html`${icon(FilePlus, "sm")} Upload`,
										onClick: () => this.handleUploadFile(),
									})}
								</div>
								${this.quota && this.quota.quota_bytes > 0
									? (() => {
										const pct = Math.min(100, Math.round((this.quota!.used_bytes / this.quota!.quota_bytes) * 100));
										const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-primary';
										return html`
											<div class="flex items-center gap-2 px-2 py-1.5 bg-muted/30 rounded text-xs text-muted-foreground">
												${icon(HardDrive, "sm")}
												<span class="flex-1">${this.formatFileSize(this.quota!.used_bytes)} / ${this.formatFileSize(this.quota!.quota_bytes)}</span>
												<div class="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
													<div class="h-full ${color} rounded-full transition-all" style="width: ${pct}%"></div>
												</div>
												<span>${pct}%</span>
											</div>
										`;
									})()
									: ""}
								<div class="border border-border rounded-lg overflow-hidden">
									<div class="max-h-64 overflow-y-auto p-2">
										${this.studentFiles.length > 0
											? this.renderFileTree(this.studentFiles, true)
											: html`<div class="text-sm text-muted-foreground text-center py-4">No files in your workspace</div>`}
									</div>
								</div>
							</div>
						`}
			</div>
		`;
	}
}
