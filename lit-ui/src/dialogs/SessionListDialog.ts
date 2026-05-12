import { DialogContent, DialogHeader } from "@mariozechner/mini-lit/dist/Dialog.js";
import { DialogBase } from "@mariozechner/mini-lit/dist/DialogBase.js";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";

// Simple session item from WebSocket API
interface SessionItem {
	id: string;
	title?: string;
	created_at?: string;
}

@customElement("session-list-dialog")
export class SessionListDialog extends DialogBase {
	@state() private sessions: SessionItem[] = [];
	@state() private loading = false;

	private onSelectCallback?: (sessionId: string) => void;

	protected modalWidth = "min(600px, 90vw)";
	protected modalHeight = "min(700px, 90vh)";

	static async open(onSelect: (sessionId: string) => void, sessions?: SessionItem[]) {
		const dialog = new SessionListDialog();
		dialog.onSelectCallback = onSelect;
		dialog.sessions = sessions || [];
		dialog.open();
	}

	private handleSelect(sessionId: string) {
		if (this.onSelectCallback) {
			this.onSelectCallback(sessionId);
		}
		this.close();
	}

	private formatDate(isoString?: string): string {
		if (!isoString) return "Unknown";
		
		const date = new Date(isoString);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));

		if (days === 0) {
			return "Today";
		} else if (days === 1) {
			return "Yesterday";
		} else if (days < 7) {
			return `${days} days ago`;
		} else {
			return date.toLocaleDateString();
		}
	}

	protected override renderContent() {
		return html`
			${DialogHeader({ title: "Session History" })}
			${DialogContent({
				children: html`
					<div class="flex flex-col gap-2 overflow-auto">
						${this.loading
							? html`<div class="text-center py-4 text-muted-foreground">Loading sessions...</div>`
							: this.sessions.length === 0
								? html`<div class="text-center py-4 text-muted-foreground">No sessions found</div>`
								: this.sessions.map(
										(session) => html`
											<button
												class="flex flex-col gap-1 p-3 border border-border rounded-lg hover:bg-secondary transition-colors text-left"
												@click=${() => this.handleSelect(session.id)}
											>
												<div class="font-medium text-foreground">
													${session.title || "Untitled Session"}
												</div>
												<div class="text-xs text-muted-foreground">
													${this.formatDate(session.created_at)}
												</div>
											</button>
										`,
									)}
					</div>
				`,
			})}
		`;
	}
}
