import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { MenuTab } from "./MenuDialog.js";
import { eduApi } from "../core/edu-api.js";
import type { TokenUsage } from "../core/edu-types.js";

@customElement("account-tab")
export class AccountTab extends MenuTab {
	@property({ type: String }) sessionId = "";
	@property({ type: String }) sessionToken = "";
	@property({ type: Function }) onLogout?: () => void;

	@state() private tokenUsage?: TokenUsage;
	@state() private loading = false;
	@state() private error = "";
	@state() private initialized = false;

	async updated(changedProperties: Map<string, any>) {
		super.updated(changedProperties);
		
		// Load data once we have the required properties
		if (!this.initialized && this.sessionId && this.sessionToken) {
			console.log("[AccountTab] Loading token usage", { sessionId: this.sessionId });
			this.initialized = true;
			await this.loadTokenUsage();
		}
	}

	private async loadTokenUsage() {
		if (!this.sessionId || !this.sessionToken) {
			this.error = "Session information not available";
			this.requestUpdate();
			return;
		}

		this.loading = true;
		this.error = "";
		this.requestUpdate();

		try {
			this.tokenUsage = await eduApi.getSessionTokenUsage(
				this.sessionId,
				this.sessionToken
			);
			console.log("[AccountTab] Token usage loaded", this.tokenUsage);
		} catch (err) {
			console.error("[AccountTab] Failed to load token usage:", err);
			this.error = err instanceof Error ? err.message : "Failed to load token usage";
		} finally {
			this.loading = false;
			this.requestUpdate();
		}
	}

	private handleLogout() {
		if (this.onLogout) {
			this.onLogout();
		}
	}

	getTabName(): string {
		return "Account";
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-6">
				<!-- Token Usage Section -->
				<div class="space-y-3">
					<h3 class="text-lg font-semibold text-foreground">Token Usage</h3>
					
					${this.loading
						? html`<div class="text-sm text-muted-foreground">Loading...</div>`
						: this.error
							? html`<div class="text-sm text-destructive">${this.error}</div>`
							: this.tokenUsage
								? html`
									<div class="grid grid-cols-2 gap-4">
										<div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
											<span class="text-sm text-muted-foreground">Total Tokens</span>
											<span class="text-2xl font-bold text-foreground">${(this.tokenUsage.total_input_tokens + this.tokenUsage.total_output_tokens).toLocaleString()}</span>
										</div>
										<div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
											<span class="text-sm text-muted-foreground">Turns</span>
											<span class="text-2xl font-bold text-foreground">${this.tokenUsage.turn_count}</span>
										</div>
										<div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
											<span class="text-sm text-muted-foreground">Input Tokens</span>
											<span class="text-lg font-semibold text-foreground">${this.tokenUsage.total_input_tokens.toLocaleString()}</span>
										</div>
										<div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
											<span class="text-sm text-muted-foreground">Output Tokens</span>
											<span class="text-lg font-semibold text-foreground">${this.tokenUsage.total_output_tokens.toLocaleString()}</span>
										</div>
										<div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
											<span class="text-sm text-muted-foreground">Cache Creation</span>
											<span class="text-lg font-semibold text-foreground">${this.tokenUsage.total_cache_creation_tokens.toLocaleString()}</span>
										</div>
										<div class="flex flex-col gap-1 p-4 border border-border rounded-lg bg-secondary/30">
											<span class="text-sm text-muted-foreground">Cache Read</span>
											<span class="text-lg font-semibold text-foreground">${this.tokenUsage.total_cache_read_tokens.toLocaleString()}</span>
										</div>
									</div>
								`
								: html`<div class="text-sm text-muted-foreground">No usage data available</div>`
					}

					${!this.loading && this.tokenUsage
						? Button({
							variant: "ghost",
							size: "sm",
							children: "Refresh",
							onClick: () => this.loadTokenUsage(),
							className: "mt-2",
						})
						: ""
					}
				</div>

				<!-- Logout Section -->
				<div class="pt-4 border-t border-border">
					${Button({
						variant: "destructive",
						children: "Logout",
						onClick: () => this.handleLogout(),
						className: "w-full",
					})}
				</div>
			</div>
		`;
	}
}
