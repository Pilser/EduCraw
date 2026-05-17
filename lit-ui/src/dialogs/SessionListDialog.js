var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SessionListDialog_1;
import { DialogContent, DialogHeader } from "@mariozechner/mini-lit/dist/Dialog.js";
import { DialogBase } from "@mariozechner/mini-lit/dist/DialogBase.js";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
let SessionListDialog = SessionListDialog_1 = class SessionListDialog extends DialogBase {
    constructor() {
        super(...arguments);
        this.sessions = [];
        this.loading = false;
        this.modalWidth = "min(600px, 90vw)";
        this.modalHeight = "min(700px, 90vh)";
    }
    static async open(onSelect, sessions) {
        const dialog = new SessionListDialog_1();
        dialog.onSelectCallback = onSelect;
        dialog.sessions = sessions || [];
        dialog.open();
    }
    handleSelect(sessionId) {
        if (this.onSelectCallback) {
            this.onSelectCallback(sessionId);
        }
        this.close();
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
    renderContent() {
        return html `
			${DialogHeader({ title: "Session History" })}
			${DialogContent({
            children: html `
					<div class="flex flex-col gap-2 overflow-auto">
						${this.loading
                ? html `<div class="text-center py-4 text-muted-foreground">Loading sessions...</div>`
                : this.sessions.length === 0
                    ? html `<div class="text-center py-4 text-muted-foreground">No sessions found</div>`
                    : this.sessions.map((session) => html `
											<button
												class="flex flex-col gap-1 p-3 border border-border rounded-lg hover:bg-secondary transition-colors text-left"
												@click=${() => this.handleSelect(session.id)}
											>
												<div class="font-medium text-foreground">
													${session.title || "Untitled Session"}
												</div>
												<div class="text-xs text-muted-foreground">
													${this.formatDate(session.updated_at)}
												</div>
											</button>
										`)}
					</div>
				`,
        })}
		`;
    }
};
__decorate([
    state()
], SessionListDialog.prototype, "sessions", void 0);
__decorate([
    state()
], SessionListDialog.prototype, "loading", void 0);
SessionListDialog = SessionListDialog_1 = __decorate([
    customElement("session-list-dialog")
], SessionListDialog);
export { SessionListDialog };
