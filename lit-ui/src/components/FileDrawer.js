var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { icon } from "@mariozechner/mini-lit";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Eye, Plus, X, FileText, FileCode, FileJson, Image as ImageIcon, Check, Upload, FileSpreadsheet, FileVideo, FileAudio, Archive, FileType, Loader2, HardDrive } from "lucide";
import { eduApi } from "../core/edu-api.js";
import { handleError } from "../core/error-handler.js";
import { i18n } from "../utils/i18n.js";
let FileDrawer = class FileDrawer extends LitElement {
    constructor() {
        super(...arguments);
        this.open = false;
        this.sessionId = "";
        this.sessionToken = "";
        this.studentToken = "";
        this.subjectIds = [];
        this.tab = "workspace";
        this.subjectFiles = [];
        this.studentFiles = [];
        this.loading = false;
        this.error = "";
        this.expandedPaths = new Set();
        this.attachedFiles = new Set(); // Track attached files for visual feedback
        this.uploading = false;
        this.uploadError = "";
        this.quota = null;
    }
    createRenderRoot() {
        return this;
    }
    connectedCallback() {
        super.connectedCallback();
        // Position the element itself absolutely so it doesn't affect layout
        this.style.position = "fixed";
        this.style.top = "0";
        this.style.right = "0";
        this.style.bottom = "0";
        this.style.left = "0";
        this.style.pointerEvents = "none"; // Don't block clicks when closed
        this.style.zIndex = "50"; // Above most content
    }
    async updated(changedProperties) {
        super.updated(changedProperties);
        // Update pointer events based on open state
        if (changedProperties.has("open")) {
            this.style.pointerEvents = this.open ? "auto" : "none";
        }
        // Load files when drawer opens
        if (changedProperties.has("open") && this.open && !this.loading) {
            if (this.subjectFiles.length === 0 && this.studentFiles.length === 0) {
                await this.loadFiles();
            }
        }
    }
    async loadFiles() {
        this.loading = true;
        this.error = "";
        this.requestUpdate();
        try {
            // Load subject files
            if (this.subjectIds.length > 0 && this.studentToken) {
                try {
                    this.subjectFiles = await eduApi.listSubjectFiles(this.subjectIds[0], this.studentToken);
                }
                catch (err) {
                    handleError(err);
                }
            }
            // Load student workspace files
            if (this.sessionId && this.sessionToken) {
                try {
                    this.studentFiles = await eduApi.listStudentFiles(this.sessionId, this.sessionToken);
                }
                catch (err) {
                    const e = handleError(err);
                    this.error = `Failed to load workspace files`;
                }
                try {
                    this.quota = await eduApi.getStudentQuota(this.sessionId, this.sessionToken);
                }
                catch (err) {
                    handleError(err);
                }
            }
        }
        catch (err) {
            const e = handleError(err);
            this.error = e.message || "Failed to load files";
        }
        finally {
            this.loading = false;
            this.requestUpdate();
        }
    }
    toggleExpand(path) {
        if (this.expandedPaths.has(path)) {
            this.expandedPaths.delete(path);
        }
        else {
            this.expandedPaths.add(path);
        }
        this.requestUpdate();
    }
    handlePreview(node, e) {
        e.stopPropagation();
        const isSubject = this.tab === "subject";
        const subjectId = isSubject ? this.subjectIds[0] : undefined;
        this.onPreviewFile?.(node, isSubject, subjectId);
    }
    handleAttach(node, e) {
        e.stopPropagation();
        const isSubject = this.tab === "subject";
        const subjectId = isSubject ? this.subjectIds[0] : undefined;
        // Add to attached set for visual feedback
        this.attachedFiles.add(node.path);
        this.requestUpdate();
        // Call callback
        this.onAttachFile?.(node, isSubject, subjectId);
        // Remove visual feedback after 2 seconds
        setTimeout(() => {
            this.attachedFiles.delete(node.path);
            this.requestUpdate();
        }, 2000);
    }
    getFileIcon(fileName) {
        const lower = fileName.toLowerCase();
        // Documents
        if (lower.endsWith('.pdf'))
            return icon(FileText, "sm", "text-red-500");
        if (lower.endsWith('.md'))
            return icon(FileText, "sm", "text-blue-500");
        if (lower.match(/\.(doc|docx)$/))
            return icon(FileText, "sm", "text-blue-600");
        if (lower.endsWith('.txt'))
            return icon(FileType, "sm", "text-gray-500");
        // Spreadsheets
        if (lower.match(/\.(xlsx?|csv)$/))
            return icon(FileSpreadsheet, "sm", "text-green-600");
        // Images
        if (lower.match(/\.(png|jpg|jpeg)$/))
            return icon(ImageIcon, "sm", "text-purple-500");
        if (lower.match(/\.(svg|gif|webp)$/))
            return icon(ImageIcon, "sm", "text-purple-400");
        // Code files
        if (lower.match(/\.(py|pyw)$/))
            return icon(FileCode, "sm", "text-blue-400");
        if (lower.match(/\.(js|jsx|ts|tsx)$/))
            return icon(FileCode, "sm", "text-yellow-500");
        if (lower.match(/\.(rs|toml)$/))
            return icon(FileCode, "sm", "text-orange-500");
        if (lower.match(/\.(cpp|c|h|hpp)$/))
            return icon(FileCode, "sm", "text-blue-600");
        if (lower.match(/\.(java|kt|scala)$/))
            return icon(FileCode, "sm", "text-red-600");
        if (lower.match(/\.(go|mod)$/))
            return icon(FileCode, "sm", "text-cyan-500");
        if (lower.match(/\.(php|rb|lua)$/))
            return icon(FileCode, "sm", "text-purple-600");
        if (lower.match(/\.(html|htm|xml)$/))
            return icon(FileCode, "sm", "text-orange-600");
        if (lower.match(/\.(css|scss|sass|less)$/))
            return icon(FileCode, "sm", "text-blue-500");
        // Data files
        if (lower.endsWith('.json'))
            return icon(FileJson, "sm", "text-yellow-600");
        if (lower.match(/\.(yaml|yml)$/))
            return icon(FileJson, "sm", "text-red-500");
        // Media
        if (lower.match(/\.(mp4|avi|mov|mkv|webm)$/))
            return icon(FileVideo, "sm", "text-pink-500");
        if (lower.match(/\.(mp3|wav|ogg|flac|m4a)$/))
            return icon(FileAudio, "sm", "text-indigo-500");
        // Archives
        if (lower.match(/\.(zip|tar|gz|rar|7z)$/))
            return icon(Archive, "sm", "text-yellow-700");
        // Default
        return icon(File, "sm", "text-muted-foreground");
    }
    renderFileRow(node, level = 0) {
        const isSubject = this.tab === "subject";
        const indent = level * 16;
        const isAttached = this.attachedFiles.has(node.path);
        if (node.kind === "dir") {
            const isExpanded = this.expandedPaths.has(node.path);
            return html `
				<div>
					<div
						class="flex items-center gap-2 px-2 py-1.5 hover:bg-secondary rounded cursor-pointer transition-colors"
						style="padding-left: ${indent + 8}px"
						@click=${() => this.toggleExpand(node.path)}
					>
						<span class="w-4 h-4 flex-shrink-0 text-muted-foreground">
							${isExpanded ? icon(ChevronDown, "xs") : icon(ChevronRight, "xs")}
						</span>
						<span class="w-4 h-4 flex-shrink-0 text-muted-foreground">
							${isExpanded ? icon(FolderOpen, "xs") : icon(Folder, "xs")}
						</span>
						<span class="text-sm text-foreground flex-1 truncate">${node.name}</span>
					</div>
					${isExpanded && node.children && node.children.length > 0
                ? html `<div>${node.children.map(child => this.renderFileRow(child, level + 1))}</div>`
                : ""}
				</div>
			`;
        }
        // File row - clicking anywhere opens preview
        return html `
			<div
				class="group flex items-center gap-2 px-2 py-1.5 hover:bg-secondary rounded transition-colors cursor-pointer ${isAttached ? 'bg-primary/10 border-l-2 border-primary' : ''}"
				style="padding-left: ${indent + 8}px"
				@click=${(e) => {
            // If clicking on action buttons, don't trigger preview
            const target = e.target;
            if (target.closest('button'))
                return;
            this.handlePreview(node, e);
        }}
			>
				<span class="w-4 h-4 flex-shrink-0"></span>
				<span class="w-4 h-4 flex-shrink-0">
					${this.getFileIcon(node.name)}
				</span>
				<span class="text-sm text-foreground flex-1 truncate" title="${node.name}">${node.name}</span>
				${node.size !== undefined
            ? html `<span class="text-xs text-muted-foreground">${this.formatFileSize(node.size)}</span>`
            : ""}
				
				<!-- Action buttons (show on hover, always visible on mobile) -->
				<div class="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
					${isAttached
            ? html `
							<div class="flex items-center gap-1 px-2 py-1 bg-primary/20 rounded text-xs text-primary font-medium">
								${icon(Check, "xs")}
								<span>Attached</span>
							</div>
						`
            : html `
							<button
								class="h-7 w-7 flex items-center justify-center hover:bg-primary/20 rounded transition-colors"
								@click=${(e) => this.handlePreview(node, e)}
								title="${i18n('Preview')}"
							>
								${icon(Eye, "xs")}
							</button>
							<button
								class="h-7 w-7 flex items-center justify-center hover:bg-primary/20 rounded transition-colors"
								@click=${(e) => this.handleAttach(node, e)}
								title="Attach to chat"
							>
								${icon(Plus, "xs")}
							</button>
						`}
				</div>
			</div>
		`;
    }
    formatFileSize(bytes) {
        if (bytes < 1024)
            return `${bytes} B`;
        if (bytes < 1024 * 1024)
            return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    renderQuotaBar() {
        if (!this.quota || this.quota.quota_bytes === 0)
            return "";
        const pct = Math.min(100, Math.round((this.quota.used_bytes / this.quota.quota_bytes) * 100));
        const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-primary';
        return html `
			<div class="shrink-0 px-3 py-2 border-b border-border bg-muted/20">
				<div class="flex items-center justify-between text-xs text-muted-foreground mb-1">
					<span class="flex items-center gap-1">${icon(HardDrive, "xs")} ${this.formatFileSize(this.quota.used_bytes)} / ${this.formatFileSize(this.quota.quota_bytes)}</span>
					<span>${pct}%</span>
				</div>
				<div class="w-full h-1.5 bg-muted rounded-full overflow-hidden">
					<div class="h-full ${color} rounded-full transition-all" style="width: ${pct}%"></div>
				</div>
			</div>
		`;
    }
    async handleUploadFiles(e) {
        const input = e.target;
        const files = Array.from(input.files || []);
        if (files.length === 0)
            return;
        this.uploading = true;
        this.uploadError = "";
        this.requestUpdate();
        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
        try {
            for (const file of files) {
                if (file.size > MAX_FILE_SIZE) {
                    this.uploadError = `File "${file.name}" exceeds 50MB limit`;
                    continue;
                }
                const content = await file.arrayBuffer();
                const relativePath = `uploads/${file.name}`;
                await eduApi.writeStudentFile(this.sessionId, relativePath, new Blob([content]), this.sessionToken);
            }
            // Reload files after upload
            await this.loadFiles();
            input.value = ""; // Reset input
        }
        catch (err) {
            const e = handleError(err);
            this.uploadError = e.message || "Upload failed";
        }
        finally {
            this.uploading = false;
            this.requestUpdate();
        }
    }
    render() {
        const files = this.tab === "subject" ? this.subjectFiles : this.studentFiles;
        return html `
			<!-- Drawer Container -->
			<div
				class="absolute top-0 right-0 h-full flex flex-col bg-card border-l border-border shadow-2xl transition-transform duration-300 ease-in-out
					${this.open ? 'translate-x-0' : 'translate-x-full'}
					w-full md:w-1/2 max-w-2xl"
				style="pointer-events: auto;"
			>
				<!-- Header -->
				<div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-card">
					<h2 class="text-lg font-semibold text-foreground">Files</h2>
					<button
						class="h-8 w-8 flex items-center justify-center hover:bg-secondary rounded transition-colors"
						@click=${() => {
            this.open = false;
            this.onClose?.();
        }}
						title="${i18n('Close')}"
					>
						${icon(X, "sm")}
					</button>
				</div>

				<!-- Tabs -->
				<div class="shrink-0 flex border-b border-border bg-muted/30">
					<button
						class="flex-1 px-4 py-3 text-sm font-medium transition-colors relative
							${this.tab === 'subject'
            ? 'text-primary border-b-2 border-primary bg-card'
            : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}"
						@click=${() => { this.tab = 'subject'; }}
					>
						Subject Files
					</button>
					<button
						class="flex-1 px-4 py-3 text-sm font-medium transition-colors relative
							${this.tab === 'workspace'
            ? 'text-primary border-b-2 border-primary bg-card'
            : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}"
						@click=${() => { this.tab = 'workspace'; }}
					>
						Workspace
					</button>
				</div>

				<!-- Upload Bar (Workspace tab only) -->
				${this.tab === 'workspace'
            ? html `
						<div class="shrink-0 px-3 py-2 border-b border-border bg-accent/10">
							<input
								type="file"
								id="file-upload-input"
								multiple
								@change=${this.handleUploadFiles}
								class="hidden"
								?disabled=${this.uploading}
							/>
							<button
								class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
								@click=${() => document.getElementById('file-upload-input')?.click()}
								?disabled=${this.uploading}
							>
								${this.uploading
                ? html `${icon(Loader2, "sm", "animate-spin")} <span>Uploading...</span>`
                : html `${icon(Upload, "sm")} <span>Upload Files</span>`}
							</button>
							${this.uploadError
                ? html `
									<div class="mt-2 px-3 py-2 bg-destructive/10 border border-destructive text-destructive text-xs rounded">
										${this.uploadError}
									</div>
								`
                : ""}
						</div>
					`
            : ""}

				<!-- Quota bar (workspace tab only) -->
				${this.tab === 'workspace' ? this.renderQuotaBar() : ""}

				<!-- Content Area -->
				<div class="flex-1 overflow-y-auto p-2">
					${this.loading
            ? html `
							<div class="flex items-center justify-center h-full">
								<div class="text-center">
									<div class="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin mx-auto mb-2"></div>
									<p class="text-sm text-muted-foreground">Loading files...</p>
								</div>
							</div>
						`
            : this.error
                ? html `
							<div class="flex items-center justify-center h-full p-4">
								<div class="text-center text-destructive">
									<p class="font-medium mb-1">Error</p>
										<p class="text-sm">${this.error}</p>
									</div>
								</div>
							`
                : files.length === 0
                    ? html `
								<div class="flex flex-col items-center justify-center h-full text-center p-4">
									${icon(Folder, "lg", "text-muted-foreground opacity-30 mb-2")}
									<p class="text-sm font-medium text-muted-foreground">No files yet</p>
									<p class="text-xs text-muted-foreground mt-1">
										${this.tab === 'workspace'
                        ? 'Files you create will appear here'
                        : 'No course materials available'}
										</p>
									</div>
								`
                    : html `
									<div class="space-y-0.5">
										${files.map(node => {
                        const subId = this.tab === 'subject' ? node.name : undefined;
                        return this.renderFileRow(node, 0);
                    })}
									</div>
								`}
				</div>

				<!-- Footer hint -->
				<div class="shrink-0 px-4 py-2 border-t border-border bg-muted/30">
					<p class="text-xs text-muted-foreground text-center">
						${icon(Eye, "xs", "inline-block mr-1")} Preview · 
						${icon(Plus, "xs", "inline-block mx-1")} Attach to chat
					</p>
				</div>
			</div>

			<!-- Backdrop (mobile only) -->
			${this.open
            ? html `
					<div
						class="absolute inset-0 bg-background/80 backdrop-blur-sm md:hidden"
						style="pointer-events: auto; z-index: -1;"
						@click=${() => {
                this.open = false;
                this.onClose?.();
            }}
					></div>
				`
            : ""}
		`;
    }
};
__decorate([
    property({ type: Boolean })
], FileDrawer.prototype, "open", void 0);
__decorate([
    property({ type: String })
], FileDrawer.prototype, "sessionId", void 0);
__decorate([
    property({ type: String })
], FileDrawer.prototype, "sessionToken", void 0);
__decorate([
    property({ type: String })
], FileDrawer.prototype, "studentToken", void 0);
__decorate([
    property({ type: Array })
], FileDrawer.prototype, "subjectIds", void 0);
__decorate([
    property()
], FileDrawer.prototype, "onClose", void 0);
__decorate([
    property()
], FileDrawer.prototype, "onPreviewFile", void 0);
__decorate([
    property()
], FileDrawer.prototype, "onAttachFile", void 0);
__decorate([
    state()
], FileDrawer.prototype, "tab", void 0);
__decorate([
    state()
], FileDrawer.prototype, "subjectFiles", void 0);
__decorate([
    state()
], FileDrawer.prototype, "studentFiles", void 0);
__decorate([
    state()
], FileDrawer.prototype, "loading", void 0);
__decorate([
    state()
], FileDrawer.prototype, "error", void 0);
__decorate([
    state()
], FileDrawer.prototype, "expandedPaths", void 0);
__decorate([
    state()
], FileDrawer.prototype, "attachedFiles", void 0);
__decorate([
    state()
], FileDrawer.prototype, "uploading", void 0);
__decorate([
    state()
], FileDrawer.prototype, "uploadError", void 0);
__decorate([
    state()
], FileDrawer.prototype, "quota", void 0);
FileDrawer = __decorate([
    customElement("file-drawer")
], FileDrawer);
export { FileDrawer };
