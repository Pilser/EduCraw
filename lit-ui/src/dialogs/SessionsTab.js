var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { icon } from "@mariozechner/mini-lit";
import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { MenuTab } from "./MenuDialog.js";
import { eduApi } from "../core/edu-api.js";
import { Download, Upload, GitFork, Plus, Trash2 } from "lucide";
let SessionsTab = class SessionsTab extends MenuTab {
    constructor() {
        super(...arguments);
        this.sessionId = "";
        this.sessionToken = "";
        this.sessions = [];
        this.loading = false;
        this.error = "";
        this.initialized = false;
    }
    async updated(changedProperties) {
        super.updated(changedProperties);
        if (!this.initialized && this.sessionId && this.sessionToken) {
            console.log("[SessionsTab] Loading sessions via REST", { sessionId: this.sessionId });
            this.initialized = true;
            await this.loadSessionList();
        }
    }
    async loadSessionList() {
        if (!this.sessionId || !this.sessionToken) {
            this.error = "Session information not available";
            this.requestUpdate();
            return;
        }
        this.loading = true;
        this.error = "";
        this.requestUpdate();
        try {
            this.sessions = await eduApi.listThreads(this.sessionId, this.sessionToken);
            console.log("[SessionsTab] Sessions loaded via REST", this.sessions.length);
        }
        catch (err) {
            console.error("[SessionsTab] Failed to load sessions:", err);
            this.error = err instanceof Error ? err.message : "Failed to load sessions";
        }
        finally {
            this.loading = false;
            this.requestUpdate();
        }
    }
    async exportSession(sessionId) {
        try {
            const result = await eduApi.exportThread(this.sessionId, sessionId, this.sessionToken);
            const blob = new Blob([result.data], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `session-${sessionId}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
        catch (err) {
            console.error("Failed to export session:", err);
            alert(`Failed to export session: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
    }
    async importSession() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file)
                return;
            try {
                const text = await file.text();
                await eduApi.importThread(this.sessionId, text, this.sessionToken);
                console.log("[SessionsTab] Session imported via REST, refreshing list");
                await this.loadSessionList();
            }
            catch (err) {
                console.error("Failed to import session:", err);
                alert(`Failed to import session: ${err instanceof Error ? err.message : "Unknown error"}`);
            }
        };
        input.click();
    }
    async forkSession(sessionId) {
        try {
            const result = await eduApi.forkThread(this.sessionId, sessionId, this.sessionToken);
            console.log("[SessionsTab] Session forked via REST:", result.new_session_id);
            await this.loadSessionList();
        }
        catch (err) {
            console.error("Failed to fork session:", err);
            alert(`Failed to fork session: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
    }
    async deleteSession(sessionId) {
        if (!confirm("Delete this session permanently? This cannot be undone."))
            return;
        try {
            await eduApi.deleteThread(this.sessionId, sessionId, this.sessionToken);
            console.log("[SessionsTab] Session deleted:", sessionId);
            await this.loadSessionList();
        }
        catch (err) {
            console.error("Failed to delete session:", err);
            alert(`Failed to delete session: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
    }
    handleLoadSession(sessionId) {
        console.log("[SessionsTab] Loading session", sessionId);
        if (this.onLoadSession) {
            this.onLoadSession(sessionId);
        }
        if (this.closeDialog) {
            this.closeDialog();
        }
    }
    formatDate(isoString) {
        if (!isoString)
            return "Unknown";
        const date = new Date(isoString);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days === 0) {
            return "Today";
        }
        else if (days === 1) {
            return "Yesterday";
        }
        else if (days < 7) {
            return `${days} days ago`;
        }
        else {
            return date.toLocaleDateString();
        }
    }
    getTabName() {
        return "Sessions";
    }
    render() {
        return html `
			<div class="flex flex-col gap-4">
				<!-- Create New Session + Import Buttons -->
				<div class="flex justify-between gap-2">
					${Button({
            variant: "default",
            size: "sm",
            children: html `${icon(Plus, "sm")} Create New Session`,
            onClick: () => {
                if (this.onNewSession) {
                    this.onNewSession();
                }
                if (this.closeDialog) {
                    this.closeDialog();
                }
            },
        })}
					${Button({
            variant: "outline",
            size: "sm",
            children: html `${icon(Upload, "sm")} Import Session`,
            onClick: () => this.importSession(),
        })}
				</div>

				<!-- Sessions List -->
				<div class="flex flex-col gap-2">
					${this.loading
            ? html `<div class="text-center py-8 text-muted-foreground">Loading sessions...</div>`
            : this.error
                ? html `<div class="text-center py-8 text-destructive">${this.error}</div>`
                : this.sessions.length === 0
                    ? html `<div class="text-center py-8 text-muted-foreground">No sessions found</div>`
                    : this.sessions.map((session) => html `
											<div class="flex items-center gap-2 p-3 border border-border rounded-lg hover:bg-secondary/50 transition-colors">
												<button
													class="flex-1 flex flex-col gap-1 text-left"
													@click=${() => this.handleLoadSession(session.id)}
												>
													<div class="font-medium text-foreground">
														${session.title || "Untitled Session"}
													</div>
													<div class="text-xs text-muted-foreground">
														${this.formatDate(session.updated_at)}
														${session.metadata?.messageCount !== undefined
                        ? html ` • ${session.metadata.messageCount} messages`
                        : ""}
													</div>
												</button>
												<div class="flex gap-1">
													${Button({
                        variant: "ghost",
                        size: "sm",
                        children: icon(Download, "xs"),
                        onClick: () => this.exportSession(session.id),
                        title: "Export",
                    })}
													${Button({
                        variant: "ghost",
                        size: "sm",
                        children: icon(GitFork, "xs"),
                        onClick: () => this.forkSession(session.id),
                        title: "Fork",
                    })}
													${Button({
                        variant: "ghost",
                        size: "sm",
                        children: icon(Trash2, "xs"),
                        onClick: () => this.deleteSession(session.id),
                        title: "Delete",
                        className: "text-destructive hover:text-destructive",
                    })}
												</div>
											</div>
										`)}
				</div>
			</div>
		`;
    }
};
__decorate([
    property({ type: String })
], SessionsTab.prototype, "sessionId", void 0);
__decorate([
    property({ type: String })
], SessionsTab.prototype, "sessionToken", void 0);
__decorate([
    property({ type: Function })
], SessionsTab.prototype, "onLoadSession", void 0);
__decorate([
    property({ type: Function })
], SessionsTab.prototype, "onNewSession", void 0);
__decorate([
    state()
], SessionsTab.prototype, "sessions", void 0);
__decorate([
    state()
], SessionsTab.prototype, "loading", void 0);
__decorate([
    state()
], SessionsTab.prototype, "error", void 0);
__decorate([
    state()
], SessionsTab.prototype, "initialized", void 0);
SessionsTab = __decorate([
    customElement("sessions-tab")
], SessionsTab);
export { SessionsTab };
