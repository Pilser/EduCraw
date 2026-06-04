import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { icon } from "@mariozechner/mini-lit";
import { html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { MenuTab } from "./MenuDialog.js";
import { eduApi } from "../core/edu-api.js";
import { handleError } from "../core/error-handler.js";
import type {
	ActivityItem,
	ApplyRecipeResponse,
	DiscoverError,
	RecipeEntry,
	RecipeParameter,
} from "../core/edu-types.js";
import { Download, Upload, Plus, Trash2, Sparkles, Play, Globe, FileText, X } from "lucide";

@customElement("recipes-tab")
export class RecipesTab extends MenuTab {
	@property({ type: String }) sessionId = "";
	@property({ type: String }) sessionToken = "";
	/** Called after a recipe is successfully applied to the current session. */
	@property({ attribute: false }) onRecipeApplied?: (resp: ApplyRecipeResponse) => void;
	/** The currently-applied recipe context for context-switch detection. Null on first load. */
	@property({ attribute: false }) currentRecipeContext?: {
		recipePath: string | null;
		activityGroup: string | null;
	} | null;
	/** Called when user picks "New Thread" in the context-switch dialog. Must spawn a fresh goose thread and clear the UI. */
	@property({ attribute: false }) onNewSessionRequested?: () => Promise<void>;
	/**
	 * Called after a recipe is applied, for tracking what was applied.
	 * `activityGroup` is null for parameter-dialog applies, the discover group for activity clicks.
	 */
	@property({ attribute: false }) onActivityApplied?: (recipePath: string, activityGroup: string | null) => void;

	@state() private recipes: RecipeEntry[] = [];
	@state() private loading = false;
	@state() private error = "";
	@state() private initialized = false;

	@state() private generating = false;
	@state() private applyingPath: string | null = null;
	@state() private paramDrafts: Record<string, string> = {};
	@state() private importMode: false | "deeplink" | "file" = false;
	@state() private deeplinkInput = "";
	@state() private discoverErrors: Record<string, DiscoverError[]> = {};
	@state() private applyingActivityKey: string | null = null;
	@state() private showContextSwitch = false;
	@state() private pendingSwitchActivity: {
		recipe: RecipeEntry;
		activity: ActivityItem;
		label: string;
	} | null = null;

	async updated(changedProperties: Map<string, any>) {
		super.updated(changedProperties);

		if (!this.initialized && this.sessionId && this.sessionToken) {
			console.log("[RecipesTab] Loading recipes via REST", { sessionId: this.sessionId });
			this.initialized = true;
			await this.loadRecipes();
		}
	}

	private async loadRecipes() {
		if (!this.sessionId || !this.sessionToken) {
			this.error = "Session information not available";
			this.requestUpdate();
			return;
		}

		this.loading = true;
		this.error = "";
		this.requestUpdate();

		try {
			this.recipes = await eduApi.listRecipes(this.sessionId, this.sessionToken);
			console.log("[RecipesTab] Recipes loaded", this.recipes.length);
		} catch (err) {
			const e = handleError(err);
			this.error = e.message || "Failed to load recipes";
		} finally {
			this.loading = false;
			this.requestUpdate();
		}
	}

	private async generateFromCurrentChat() {
		if (this.generating) return;
		if (!confirm("Generate a recipe from the current conversation? The LLM will analyse the chat and write a new recipe file.")) return;

		this.generating = true;
		this.error = "";
		this.requestUpdate();
		try {
			const result = await eduApi.generateRecipe(this.sessionId, this.sessionToken);
			console.log("[RecipesTab] Recipe generated", result);
			await this.loadRecipes();
			alert(`Recipe created: ${result.title}\n${result.description}`);
		} catch (err) {
			const e = handleError(err);
			this.error = `Generate failed: ${e.message || "Unknown error"}`;
		} finally {
			this.generating = false;
			this.requestUpdate();
		}
	}

	private openApplyDialog(path: string) {
		this.applyingPath = path;
		this.paramDrafts = {};
		this.requestUpdate();
	}

	private closeApplyDialog() {
		this.applyingPath = null;
		this.paramDrafts = {};
		this.requestUpdate();
	}

	private async confirmApply() {
		const path = this.applyingPath;
		if (!path) return;
		try {
			const values = Object.keys(this.paramDrafts).length > 0 ? this.paramDrafts : undefined;
			const result = await eduApi.applyRecipe(this.sessionId, this.sessionToken, path, values);
			console.log("[RecipesTab] Recipe applied", result);
			this.closeApplyDialog();
			if (this.onRecipeApplied) {
				this.onRecipeApplied(result);
			}
			if (this.onActivityApplied) {
				this.onActivityApplied(path, null);
			}
			await this.loadRecipes();
		} catch (err) {
			handleError(err);
		}
	}

	private async exportRecipe(entry: RecipeEntry) {
		try {
			const result = await eduApi.exportRecipe(this.sessionId, this.sessionToken, entry.path);
			const blob = new Blob([result.recipeJson], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = result.filename;
			a.click();
			URL.revokeObjectURL(url);

			if (result.deeplink) {
				try {
					await navigator.clipboard.writeText(result.deeplink);
					alert(`Deeplink copied to clipboard:\n${result.deeplink}`);
				} catch {
					// Clipboard unavailable — file download is enough
				}
			}
		} catch (err) {
			const e = handleError(err);
			alert(`Failed to export recipe: ${e.message || "Unknown error"}`);
		}
	}

	private startImportDeeplink() {
		this.importMode = "deeplink";
		this.deeplinkInput = "";
		this.requestUpdate();
	}

	private startImportFile() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";

		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			try {
				const text = await file.text();
				await eduApi.importRecipe(this.sessionId, this.sessionToken, { recipeJson: text });
				console.log("[RecipesTab] Recipe imported from file");
				await this.loadRecipes();
			} catch (err) {
				const e = handleError(err);
				alert(`Failed to import recipe: ${e.message || "Unknown error"}`);
			}
		};
		input.click();
	}

	private async confirmImportDeeplink() {
		const link = this.deeplinkInput.trim();
		if (!link) return;
		try {
			await eduApi.importRecipe(this.sessionId, this.sessionToken, { deeplink: link });
			this.importMode = false;
			this.deeplinkInput = "";
			await this.loadRecipes();
		} catch (err) {
			handleError(err);
		}
	}

	private cancelImport() {
		this.importMode = false;
		this.deeplinkInput = "";
		this.requestUpdate();
	}

	private async deleteRecipe(entry: RecipeEntry) {
		if (!confirm(`Delete recipe "${entry.title}"? This cannot be undone.`)) return;
		try {
			await eduApi.deleteRecipe(this.sessionId, this.sessionToken, entry.path);
			console.log("[RecipesTab] Recipe deleted", entry.path);
			await this.loadRecipes();
		} catch (err) {
			const e = handleError(err);
			alert(`Failed to delete recipe: ${e.message || "Unknown error"}`);
		}
	}

	private getActivityKey(recipePath: string, label: string): string {
		return `${recipePath}::${label}`;
	}

	private isActivityLoading(recipePath: string, label: string): boolean {
		return this.applyingActivityKey === this.getActivityKey(recipePath, label);
	}

	private async handleActivityClick(recipe: RecipeEntry, activity: ActivityItem) {
		if (this.applyingActivityKey || this.showContextSwitch) return;

		const label = typeof activity === "string" ? activity : activity.label;
		const discover = typeof activity === "object" && activity.discover;
		if (!discover) return;

		// Context-switch detection
		const ctx = this.currentRecipeContext;
		if (ctx) {
			const sameRecipe = ctx.recipePath === recipe.path;
			const sameGroup = ctx.activityGroup === discover.group;
			if (!sameRecipe || !sameGroup) {
				this.pendingSwitchActivity = { recipe, activity, label };
				this.showContextSwitch = true;
				this.requestUpdate();
				return;
			}
		}

		await this.executeActivityApply(recipe, activity, label);
	}

	private async executeActivityApply(recipe: RecipeEntry, activity: ActivityItem, label: string) {
		const discover = typeof activity === "object" ? activity.discover : null;
		if (!discover) return;

		this.applyingActivityKey = this.getActivityKey(recipe.path, label);
		this.discoverErrors = {};
		this.requestUpdate();

		try {
			const result = await eduApi.applyRecipe(
				this.sessionId,
				this.sessionToken,
				recipe.path,
				undefined,
				{ group: discover.group, params: discover.params },
			);

			if (result.discoverErrors && result.discoverErrors.length > 0) {
				this.discoverErrors = { ...this.discoverErrors, [recipe.path]: result.discoverErrors };
			}

			if (this.onRecipeApplied) {
				this.onRecipeApplied(result);
			}
			if (this.onActivityApplied) {
				this.onActivityApplied(recipe.path, discover.group);
			}

			await this.loadRecipes();
		} catch (err) {
			handleError(err);
		} finally {
			this.applyingActivityKey = null;
			this.requestUpdate();
		}
	}

	private async handleSwitchNewThread() {
		const pending = this.pendingSwitchActivity;
		if (!pending) return;
		this.showContextSwitch = false;
		this.pendingSwitchActivity = null;
		if (this.onNewSessionRequested) {
			await this.onNewSessionRequested();
		}
		await this.executeActivityApply(pending.recipe, pending.activity, pending.label);
	}

	private async handleSwitchContinue() {
		const pending = this.pendingSwitchActivity;
		if (!pending) return;
		this.showContextSwitch = false;
		this.pendingSwitchActivity = null;
		await this.executeActivityApply(pending.recipe, pending.activity, pending.label);
	}

	private handleSwitchCancel() {
		this.showContextSwitch = false;
		this.pendingSwitchActivity = null;
		this.requestUpdate();
	}

	private renderActivities(recipe: RecipeEntry): TemplateResult | null {
		if (!recipe.activities || recipe.activities.length === 0) return null;

		return html`
			<div class="flex flex-wrap gap-1.5 mt-2">
				${recipe.activities.map((activity) => {
					const label = typeof activity === "string" ? activity : activity.label;
					const hint = typeof activity === "object" ? activity.hint : undefined;
					const hasDiscover = typeof activity === "object" && !!activity.discover;
					const loading = this.isActivityLoading(recipe.path, label);

					return html`
						<button
							class="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border hover:bg-secondary/50 transition-colors disabled:opacity-50"
							title=${hint || label}
							?disabled=${!hasDiscover || loading}
							@click=${() => hasDiscover && this.handleActivityClick(recipe, activity)}
						>
							${loading ? html`<span class="animate-spin">⟳</span>` : ""}
							${label}
						</button>
					`;
				})}
			</div>
		`;
	}

	private renderDiscoverErrors(recipePath: string): TemplateResult | null {
		const errors = this.discoverErrors[recipePath];
		if (!errors || errors.length === 0) return null;

		return html`
			<div class="mt-2 p-2 rounded-md bg-destructive/10 border border-destructive/30 relative">
				<button
					class="absolute top-1 right-1 text-destructive/60 hover:text-destructive"
					@click=${() => {
						const next = { ...this.discoverErrors };
						delete next[recipePath];
						this.discoverErrors = next;
						this.requestUpdate();
					}}
				>${icon(X, "xs")}</button>
				<div class="text-xs font-medium text-destructive mb-1">Discovery Errors</div>
				${errors.map(
					(err) => html`
						<div class="text-xs text-destructive/80 flex flex-col gap-0.5 mb-1 last:mb-0">
							<span class="font-medium">${err.step} (${err.stepType})</span>
							<span>${err.message}</span>
						</div>
					`,
				)}
			</div>
		`;
	}

	private renderApplyDialog(entry: RecipeEntry): TemplateResult {
		const params: RecipeParameter[] = entry.parameters || [];
		return html`
			<div
				class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
				@click=${(e: Event) => {
					if (e.target === e.currentTarget) this.closeApplyDialog();
				}}
			>
				<div class="bg-background border border-border rounded-lg shadow-xl max-w-lg w-full p-6 flex flex-col gap-4">
					<div class="flex items-start justify-between">
						<div>
							<h3 class="text-lg font-semibold text-foreground">Apply Recipe</h3>
							<p class="text-sm text-muted-foreground">${entry.title}</p>
						</div>
						${Button({
							variant: "ghost",
							size: "sm",
							children: icon(X, "sm"),
							onClick: () => this.closeApplyDialog(),
						})}
					</div>
					${params.length === 0
						? html`<p class="text-sm text-muted-foreground">No parameters required.</p>`
						: html`
							<div class="flex flex-col gap-3 max-h-80 overflow-y-auto">
								${params.map(
									(p) => html`
										<label class="flex flex-col gap-1">
											<span class="text-sm font-medium text-foreground">
												${p.key}
												<span class="text-xs text-muted-foreground">(${p.inputType}${p.requirement === "Required" ? " • required" : ""})</span>
											</span>
											<input
												type="text"
												class="px-3 py-2 border border-border rounded-md bg-background text-foreground"
												.value=${this.paramDrafts[p.key] ?? p.default ?? ""}
												placeholder=${p.description || p.key}
												@input=${(e: Event) => {
													this.paramDrafts = {
														...this.paramDrafts,
														[p.key]: (e.target as HTMLInputElement).value,
													};
												}}
											/>
											${p.description
												? html`<span class="text-xs text-muted-foreground">${p.description}</span>`
												: ""}
										</label>
									`,
								)}
							</div>
						`}
					<div class="flex justify-end gap-2">
						${Button({
							variant: "outline",
							size: "sm",
							children: "Cancel",
							onClick: () => this.closeApplyDialog(),
						})}
						${Button({
							variant: "default",
							size: "sm",
							children: html`${icon(Play, "sm")} Apply`,
							onClick: () => this.confirmApply(),
						})}
					</div>
				</div>
			</div>
		`;
	}

	private renderImportPanel(): TemplateResult {
		return html`
			<div
				class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
				@click=${(e: Event) => {
					if (e.target === e.currentTarget) this.cancelImport();
				}}
			>
				<div class="bg-background border border-border rounded-lg shadow-xl max-w-md w-full p-6 flex flex-col gap-4">
					<div class="flex items-start justify-between">
						<h3 class="text-lg font-semibold text-foreground">Import Recipe (Deeplink)</h3>
						${Button({
							variant: "ghost",
							size: "sm",
							children: icon(X, "sm"),
							onClick: () => this.cancelImport(),
						})}
					</div>
					<textarea
						class="w-full h-32 px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm font-mono"
						placeholder="goose://recipe?config=..."
						.value=${this.deeplinkInput}
						@input=${(e: Event) => {
							this.deeplinkInput = (e.target as HTMLTextAreaElement).value;
						}}
					></textarea>
					<div class="flex justify-end gap-2">
						${Button({
							variant: "outline",
							size: "sm",
							children: "Cancel",
							onClick: () => this.cancelImport(),
						})}
						${Button({
							variant: "default",
							size: "sm",
							children: "Import",
							onClick: () => this.confirmImportDeeplink(),
						})}
					</div>
				</div>
			</div>
		`;
	}

	private renderContextSwitchDialog(): TemplateResult {
		const pending = this.pendingSwitchActivity;
		const fromGroup = this.currentRecipeContext?.activityGroup || "none";
		const toGroup = pending
			? (typeof pending.activity === "object" ? pending.activity.discover?.group : "?")
			: "?";
		const recipeTitle = pending?.recipe.title || "Recipe";

		return html`
			<div
				class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
				@click=${(e: Event) => {
					if (e.target === e.currentTarget) this.handleSwitchCancel();
				}}
			>
				<div class="bg-background border border-border rounded-lg shadow-xl max-w-md w-full p-6 flex flex-col gap-4">
					<div class="flex items-start justify-between">
						<div>
							<h3 class="text-lg font-semibold text-foreground">Change Context</h3>
							<p class="text-sm text-muted-foreground">${recipeTitle}</p>
						</div>
					</div>

					<div class="flex flex-col gap-2 text-sm">
						<div class="flex items-center gap-2">
							<span class="text-muted-foreground">From:</span>
							<span class="font-medium">${fromGroup}</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="text-muted-foreground">To:</span>
							<span class="font-medium">${toGroup}</span>
						</div>
						<p class="text-xs text-muted-foreground mt-1">
							Starting a new thread will clear the current conversation. The current conversation stays saved.
						</p>
					</div>

					<div class="flex justify-end gap-2 mt-2">
						${Button({
							variant: "ghost",
							size: "sm",
							children: "Cancel",
							onClick: () => this.handleSwitchCancel(),
						})}
						${Button({
							variant: "outline",
							size: "sm",
							children: "Continue Anyway",
							onClick: () => this.handleSwitchContinue(),
						})}
						${Button({
							variant: "default",
							size: "sm",
							children: "New Thread",
							onClick: () => this.handleSwitchNewThread(),
						})}
					</div>
				</div>
			</div>
		`;
	}

	getTabName(): string {
		return "Recipes";
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-4">
				<!-- Toolbar -->
				<div class="flex flex-wrap gap-2">
					${Button({
						variant: "default",
						size: "sm",
						children: html`${icon(Sparkles, "sm")} ${this.generating ? "Generating…" : "Generate from Chat"}`,
						onClick: () => this.generateFromCurrentChat(),
					})}
					${Button({
						variant: "outline",
						size: "sm",
						children: html`${icon(Upload, "sm")} Import File`,
						onClick: () => this.startImportFile(),
					})}
					${Button({
						variant: "outline",
						size: "sm",
						children: html`${icon(Plus, "sm")} Import Deeplink`,
						onClick: () => this.startImportDeeplink(),
					})}
				</div>

				${this.error
					? html`<div class="text-sm text-destructive">${this.error}</div>`
					: ""}

				<!-- Recipes List -->
				<div class="flex flex-col gap-2">
					${this.loading
						? html`<div class="text-center py-8 text-muted-foreground">Loading recipes...</div>`
						: this.recipes.length === 0
							? html`
									<div class="text-center py-8 text-muted-foreground flex flex-col items-center gap-2">
										${icon(FileText, "lg")}
										<div>No recipes yet. Click "Generate from Chat" to create one from the current conversation.</div>
									</div>
								`
							: this.recipes.map(
									(recipe) => html`
										<div class="flex items-center gap-2 p-3 border border-border rounded-lg hover:bg-secondary/50 transition-colors">
											<button
												class="flex-1 flex flex-col gap-1 text-left"
												@click=${() => this.openApplyDialog(recipe.path)}
												title="Click to apply this recipe"
											>
												<div class="font-medium text-foreground flex items-center gap-2">
													${recipe.title}
													${recipe.appliedToCurrentSession
														? html`<span class="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800">✓ Applied</span>`
														: ""}
													${recipe.global
														? html`<span class="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground flex items-center gap-1">${icon(Globe, "xs")} global</span>`
														: ""}
												</div>
												${recipe.description
													? html`<div class="text-xs text-muted-foreground line-clamp-2">${recipe.description}</div>`
													: ""}
												${recipe.parameters && recipe.parameters.length > 0
													? html`<div class="text-xs text-muted-foreground">${recipe.parameters.length} parameter${recipe.parameters.length === 1 ? "" : "s"}</div>`
													: ""}
												${this.renderActivities(recipe)}
												${this.renderDiscoverErrors(recipe.path)}
											</button>
											<div class="flex gap-1">
												${Button({
													variant: "ghost",
													size: "sm",
													children: icon(Play, "xs"),
													onClick: () => this.openApplyDialog(recipe.path),
													title: "Apply to current session",
												})}
												${Button({
													variant: "ghost",
													size: "sm",
													children: icon(Download, "xs"),
													onClick: () => this.exportRecipe(recipe),
													title: "Export",
												})}
												${recipe.isUserRecipe !== false
													? Button({
															variant: "ghost",
															size: "sm",
															children: icon(Trash2, "xs"),
															onClick: () => this.deleteRecipe(recipe),
															title: "Delete",
															className: "text-destructive hover:text-destructive",
														})
													: ""}
											</div>
										</div>
									`,
								)}
				</div>
			</div>

			${this.applyingPath
				? this.renderApplyDialog(
						this.recipes.find((r) => r.path === this.applyingPath) || {
							name: "",
							title: "Recipe",
							description: "",
							path: this.applyingPath,
							global: false,
							parameters: [],
						},
					)
				: ""}
			${this.importMode === "deeplink" ? this.renderImportPanel() : ""}
			${this.showContextSwitch ? this.renderContextSwitchDialog() : ""}
		`;
	}
}
