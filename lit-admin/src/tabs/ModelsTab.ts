import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Brain, Eye, Loader2, Plus, Power, PowerOff, Save, Trash2, X, Wrench, Settings } from "lucide";
import { adminApi } from "../core/admin-api";
import type { ConfigParamDef, Model, ProviderSchema } from "../core/admin-types";

@customElement("models-tab")
export class ModelsTab extends LitElement {
  @property({ type: String }) token = "";
  @property({ type: String }) role = "";

  @state() private models: Model[] = [];
  @state() private loading = false;
  @state() private error = "";
  @state() private success = "";

  // Create form
  @state() private creating = false;
  @state() private newName = "";
  @state() private newDisplayName = "";
  @state() private newProvider = "";
  @state() private newMultiplier = "1.0";
  @state() private newThinkMode = "";
  @state() private newVisualSupport = false;

  // Inline multiplier edit
  @state() private multEditId = "";
  @state() private multEditName = "";
  @state() private multEditValue = "";

  // Specs editor
  @state() private specsEditId = "";
  @state() private specsProvider = "";
  @state() private specsThinkMode = "";
  @state() private specsVisualSupport = false;

  // Thinking config editor
  @state() private thinkingEditId = "";
  @state() private thinkingParams: Record<string, unknown> = {};
  @state() private thinkingRaw = "";
  @state() private thinkingRawMode = false;
  @state() private providerSchema: ProviderSchema | null = null;
  @state() private schemaLoading = false;
  @state() private schemaError = "";

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.load();
  }

  private async load() {
    this.loading = true;
    this.error = "";
    try {
      this.models = await adminApi.listModels(this.token);
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load models";
    } finally {
      this.loading = false;
    }
  }

  // ── Create ─────────────────────────────────────────

  private async createModel() {
    if (!this.newName.trim() || !this.newDisplayName.trim()) return;
    this.error = "";
    this.success = "";
    this.loading = true;
    try {
      const mult = parseFloat(this.newMultiplier) || 1.0;
      await adminApi.createModel(this.token, this.newName.trim(), this.newDisplayName.trim(), mult);
      this.success = "Model created";
      this.newName = "";
      this.newDisplayName = "";
      this.newProvider = "";
      this.newMultiplier = "1.0";
      this.newThinkMode = "";
      this.newVisualSupport = false;
      this.creating = false;
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Create failed";
    } finally {
      this.loading = false;
    }
  }

  // ── Enable / Disable ───────────────────────────────

  private async toggleEnabled(model: Model) {
    const newVal = model.enabled === 1 ? 0 : 1;
    this.loading = true;
    try {
      await adminApi.setModelEnabled(this.token, model.id, newVal);
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Toggle failed";
    } finally {
      this.loading = false;
    }
  }

  // ── Multiplier ─────────────────────────────────────

  private startMultEdit(m: Model) {
    this.multEditId = m.id;
    this.multEditName = m.name;
    this.multEditValue = String(m.multiplier);
    this.specsEditId = "";
    this.thinkingEditId = "";
  }

  private cancelMultEdit() {
    this.multEditId = "";
  }

  private async saveMultEdit() {
    const val = parseFloat(this.multEditValue);
    if (isNaN(val)) return;
    this.loading = true;
    try {
      await adminApi.setModelMultiplier(this.token, this.multEditName, val);
      this.multEditId = "";
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Update failed";
    } finally {
      this.loading = false;
    }
  }

  // ── Specs editor ───────────────────────────────────

  private startSpecsEdit(m: Model) {
    this.specsEditId = m.id;
    this.specsProvider = m.provider || "";
    this.specsThinkMode = String(m.think_mode ?? "");
    this.specsVisualSupport = m.visual_support === 1;
    this.multEditId = "";
    this.thinkingEditId = "";
  }

  private cancelSpecsEdit() {
    this.specsEditId = "";
  }

  private async saveSpecsEdit() {
    this.loading = true;
    try {
      await adminApi.updateModelSpecs(
        this.token,
        this.specsEditId,
        this.specsProvider || "",
        parseInt(this.specsThinkMode) || 0,
        this.specsVisualSupport ? 1 : 0,
      );
      this.specsEditId = "";
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Save specs failed";
    } finally {
      this.loading = false;
    }
  }

  // ── Thinking config ────────────────────────────────

  private startThinkingEdit(m: Model) {
    this.thinkingEditId = m.id;
    this.thinkingParams = m.thinking_params ? { ...m.thinking_params as Record<string, unknown> } : {};
    this.thinkingRaw = m.thinking_params ? JSON.stringify(m.thinking_params, null, 2) : "";
    this.thinkingRawMode = false;
    this.multEditId = "";
    this.specsEditId = "";
    this.providerSchema = null;
    this.schemaError = "";
    this.loadProviderSchema(m.provider || "");
  }

  private cancelThinkingEdit() {
    this.thinkingEditId = "";
    this.providerSchema = null;
    this.schemaError = "";
  }

  private async loadProviderSchema(provider: string) {
    if (!provider) return;
    this.schemaLoading = true;
    this.schemaError = "";
    this.providerSchema = null;
    try {
      this.providerSchema = await adminApi.getProviderSchema(provider);
    } catch (err) {
      this.schemaError = err instanceof Error ? err.message : "Failed to load schema";
    } finally {
      this.schemaLoading = false;
    }
  }

  private updateThinkingParam(key: string, value: unknown) {
    if (value === "" || value === null || value === undefined) {
      const { [key]: _, ...rest } = this.thinkingParams;
      this.thinkingParams = rest;
    } else {
      this.thinkingParams = { ...this.thinkingParams, [key]: value };
    }
    this.requestUpdate();
  }

  private setThinkingRawMode(mode: boolean) {
    this.thinkingRawMode = mode;
    if (mode && !this.thinkingRaw) {
      this.thinkingRaw = JSON.stringify(this.thinkingParams, null, 2);
    }
  }

  private async saveThinkingConfig() {
    this.loading = true;
    try {
      let params: Record<string, unknown>;
      if (this.thinkingRawMode) {
        params = JSON.parse(this.thinkingRaw);
      } else {
        params = this.thinkingParams;
      }
      await adminApi.updateModelThinking(this.token, this.thinkingEditId, params);
      this.success = "Thinking config saved";
      this.thinkingEditId = "";
      this.providerSchema = null;
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Save thinking config failed";
    } finally {
      this.loading = false;
    }
  }

  private renderParamField(param: ConfigParamDef) {
    const val = this.thinkingParams[param.key];
    if (param.type === "select") {
      return html`
        <select
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          @change=${(e: Event) => {
            this.updateThinkingParam(param.key, (e.target as HTMLSelectElement).value);
          }}
        >
          <option value="" ?selected=${val == null}>Default</option>
          ${(param.values || []).map(
            (v) => html`<option value=${v} ?selected=${String(val) === v}>${v}</option>`,
          )}
        </select>
      `;
    }
    return html`
      ${Input({
        type: "number",
        value: val != null ? String(val) : String(param.default ?? ""),
        placeholder: param.description || param.key,
        className: "w-full",
        min: param.min,
        max: param.max,
        onChange: (e: Event) => {
          const n = parseInt((e.target as HTMLInputElement).value);
          this.updateThinkingParam(param.key, isNaN(n) ? undefined : n);
        },
      })}
    `;
  }

  // ── Delete ─────────────────────────────────────────

  private async deleteModel(id: string) {
    if (!confirm("Delete this model? This cannot be undone.")) return;
    this.loading = true;
    try {
      await adminApi.deleteModel(this.token, id);
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Delete failed";
    } finally {
      this.loading = false;
    }
  }

  render() {
    const isAdmin = this.role === "admin";
    return html`
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-foreground">AI Models</h2>
          <div class="flex gap-2">
            ${Button({ variant: "ghost", size: "sm", children: "Refresh", onClick: () => this.load() })}
            ${isAdmin
              ? Button({
                  variant: "default",
                  size: "sm",
                  children: html`${icon(Plus, "xs")} New Model`,
                  onClick: () => { this.creating = !this.creating; },
                })
              : ""}
          </div>
        </div>

        ${this.error
          ? html`<div class="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">${this.error}</div>`
          : ""}
        ${this.success
          ? html`<div class="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">${this.success}</div>`
          : ""}

        ${this.creating
          ? html`
              <div class="border border-border rounded-lg p-4 bg-card space-y-3 max-w-2xl">
                <h3 class="text-sm font-medium text-foreground">Create Model</h3>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Model Name (API ID)</label>
                    ${Input({ type: "text", value: this.newName, placeholder: "e.g. gpt-4o", className: "w-full font-mono",
                      onChange: (e: Event) => { this.newName = (e.target as HTMLInputElement).value; } })}
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Display Name</label>
                    ${Input({ type: "text", value: this.newDisplayName, placeholder: "e.g. GPT-4o", className: "w-full",
                      onChange: (e: Event) => { this.newDisplayName = (e.target as HTMLInputElement).value; } })}
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Provider</label>
                    <select class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      @change=${(e: Event) => { this.newProvider = (e.target as HTMLSelectElement).value; }}>
                      <option value="">Default</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="xai">xAI</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="google">Google</option>
                      <option value="databricks">Databricks</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Token Multiplier</label>
                    ${Input({ type: "number", value: this.newMultiplier, placeholder: "1.0", className: "w-full",
                      onChange: (e: Event) => { this.newMultiplier = (e.target as HTMLInputElement).value; } })}
                  </div>
                  <div>
                    <label class="block text-xs text-muted-foreground mb-1">Thinking Mode</label>
                    <select class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      @change=${(e: Event) => { this.newThinkMode = (e.target as HTMLSelectElement).value; }}>
                      <option value="">Unknown</option>
                      <option value="1">Thinking</option>
                      <option value="0">Non-thinking</option>
                    </select>
                  </div>
                  <div class="flex items-end pb-2">
                    <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                      <input type="checkbox" .checked=${this.newVisualSupport} @change=${(e: Event) => { this.newVisualSupport = (e.target as HTMLInputElement).checked; }} class="rounded" />
                      Supports vision/images
                    </label>
                  </div>
                </div>
                <div class="flex gap-2">
                  ${Button({ variant: "default", size: "sm", children: html`${icon(Plus, "xs")} Create`, disabled: this.loading, onClick: () => this.createModel() })}
                  ${Button({ variant: "ghost", size: "sm", children: "Cancel", onClick: () => { this.creating = false; } })}
                </div>
              </div>
            `
          : ""}

        ${this.loading && this.models.length === 0
          ? html`<div class="flex items-center justify-center py-12">${icon(Loader2, "md", "animate-spin text-muted-foreground")}</div>`
          : this.models.length === 0
            ? html`<p class="text-center text-muted-foreground py-12">No models yet.</p>`
            : html`
                <div class="border border-border rounded-lg overflow-hidden">
                  <table class="w-full text-sm">
                    <thead class="bg-muted/50 border-b border-border">
                      <tr class="text-left text-muted-foreground">
                        <th class="py-2.5 px-3 font-medium">Display Name</th>
                        <th class="py-2.5 px-3 font-medium">Model ID</th>
                        <th class="py-2.5 px-3 font-medium">Provider</th>
                        <th class="py-2.5 px-3 font-medium">Capabilities</th>
                        <th class="py-2.5 px-3 font-medium">Multiplier</th>
                        <th class="py-2.5 px-3 font-medium">Status</th>
                        <th class="py-2.5 px-3 font-medium">Created</th>
                        ${isAdmin ? html`<th class="py-2.5 px-3 font-medium">Actions</th>` : ""}
                      </tr>
                    </thead>
                    <tbody>
                      ${this.models.map((m) => html`
                        <tr class="border-b border-border hover:bg-muted/30">
                          <td class="py-2 px-3 font-medium">${m.display_name}</td>
                          <td class="py-2 px-3">
                            <code class="text-xs bg-muted px-1.5 py-0.5 rounded">${m.name}</code>
                          </td>
                          <td class="py-2 px-3 text-xs text-muted-foreground">${m.provider || "—"}</td>
                          <td class="py-2 px-3">
                            <div class="flex gap-1.5">
                              ${m.think_mode === 1
                                ? html`<span title="Thinking" class="text-blue-500">${icon(Brain, "sm")}</span>`
                                : ""}
                              ${m.visual_support === 1
                                ? html`<span title="Vision" class="text-green-500">${icon(Eye, "sm")}</span>`
                                : ""}
                            </div>
                          </td>
                          <td class="py-2 px-3">
                            ${this.multEditId === m.id && isAdmin
                              ? html`<div class="flex gap-1 items-center">
                                  ${Input({ type: "number", value: this.multEditValue, className: "w-20 text-xs",
                                    onChange: (e: Event) => { this.multEditValue = (e.target as HTMLInputElement).value; } })}
                                  ${Button({ variant: "default", size: "sm", children: html`${icon(Save, "xs")}`, onClick: () => this.saveMultEdit() })}
                                  ${Button({ variant: "ghost", size: "sm", children: html`${icon(X, "xs")}`, onClick: () => this.cancelMultEdit() })}
                                </div>`
                              : html`<span class="cursor-pointer hover:underline" @click=${() => isAdmin && this.startMultEdit(m)}>
                                  x${m.multiplier}
                                </span>`}
                          </td>
                          <td class="py-2 px-3">
                            <span class="inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${m.enabled === 1
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-gray-100 text-gray-500 dark:bg-gray-900/30 dark:text-gray-500"}">
                              ${m.enabled === 1 ? "Enabled" : "Disabled"}
                            </span>
                          </td>
                          <td class="py-2 px-3 text-muted-foreground text-xs">
                            ${new Date(m.created_at).toLocaleDateString()}
                          </td>
                          ${isAdmin
                            ? html`
                                <td class="py-2 px-3">
                                  <div class="flex gap-1 flex-wrap">
                                    ${m.enabled === 1
                                      ? Button({ variant: "ghost", size: "sm", children: html`${icon(PowerOff, "xs")}`, onClick: () => this.toggleEnabled(m),
                                          title: "Disable" })
                                      : Button({ variant: "ghost", size: "sm", children: html`${icon(Power, "xs")}`, onClick: () => this.toggleEnabled(m),
                                          title: "Enable" })}
                                    ${Button({ variant: "ghost", size: "sm", children: html`${icon(Wrench, "xs")}`, onClick: () =>
                                      this.specsEditId === m.id ? this.cancelSpecsEdit() : this.startSpecsEdit(m),
                                      title: "Edit specs" })}
                                    ${Button({ variant: "ghost", size: "sm", children: html`${icon(Settings, "xs")}`, onClick: () =>
                                      this.thinkingEditId === m.id ? this.cancelThinkingEdit() : this.startThinkingEdit(m),
                                      title: "Thinking config" })}
                                    ${Button({ variant: "ghost", size: "sm", children: html`${icon(Trash2, "xs")}`, onClick: () => this.deleteModel(m.id) })}
                                  </div>
                                </td>
                              `
                            : ""}
                        </tr>

                        <!-- Specs editor sub-row -->
                        ${this.specsEditId === m.id
                          ? html`
                              <tr class="bg-muted/10">
                                <td colspan="8" class="p-4">
                                  <div class="space-y-3 max-w-md">
                                    <h4 class="text-sm font-semibold text-foreground">${icon(Wrench, "xs")} Edit Specs</h4>
                                    <div>
                                      <label class="block text-xs text-muted-foreground mb-1">Provider</label>
                                      ${Input({ type: "text", value: this.specsProvider, placeholder: "e.g. openai", className: "w-full",
                                        onChange: (e: Event) => { this.specsProvider = (e.target as HTMLInputElement).value; } })}
                                    </div>
                                    <div>
                                      <label class="block text-xs text-muted-foreground mb-1">Thinking Mode</label>
                                      <select class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                        @change=${(e: Event) => { this.specsThinkMode = (e.target as HTMLSelectElement).value; }}>
                                        <option value="" ?selected=${this.specsThinkMode === ""}>Unknown</option>
                                        <option value="1" ?selected=${this.specsThinkMode === "1"}>Thinking</option>
                                        <option value="0" ?selected=${this.specsThinkMode === "0"}>Non-thinking</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                                        <input type="checkbox" .checked=${this.specsVisualSupport}
                                          @change=${(e: Event) => { this.specsVisualSupport = (e.target as HTMLInputElement).checked; }} class="rounded" />
                                        Vision support
                                      </label>
                                    </div>
                                    <div class="flex gap-2">
                                      ${Button({ variant: "default", size: "sm", children: html`${icon(Save, "xs")} Save`, onClick: () => this.saveSpecsEdit(), disabled: this.loading })}
                                      ${Button({ variant: "ghost", size: "sm", children: "Cancel", onClick: () => this.cancelSpecsEdit() })}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            `
                          : ""}

                        <!-- Thinking config sub-row -->
                        ${this.thinkingEditId === m.id
                          ? html`
                              <tr class="bg-muted/10">
                                <td colspan="8" class="p-4">
                                  <div class="space-y-3">
                                    <h4 class="text-sm font-semibold text-foreground flex items-center gap-1">
                                      ${icon(Settings, "xs")} Thinking Configuration
                                    </h4>

                                    <div class="flex items-center gap-2">
                                      <button
                                        class="text-xs px-2 py-1 rounded ${!this.thinkingRawMode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}"
                                        @click=${() => this.setThinkingRawMode(false)}>
                                        Form
                                      </button>
                                      <button
                                        class="text-xs px-2 py-1 rounded ${this.thinkingRawMode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}"
                                        @click=${() => this.setThinkingRawMode(true)}>
                                        Raw JSON
                                      </button>
                                    </div>

                                    ${this.thinkingRawMode
                                      ? html`
                                          <textarea
                                            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[120px] font-mono"
                                            .value=${this.thinkingRaw}
                                            @input=${(e: Event) => { this.thinkingRaw = (e.target as HTMLTextAreaElement).value; }}
                                          ></textarea>
                                        `
                                      : html`
                                          ${this.schemaLoading
                                            ? html`<p class="text-xs text-muted-foreground">Loading schema...</p>`
                                            : this.schemaError
                                              ? html`
                                                  <div class="text-xs text-destructive mb-2">${this.schemaError}</div>
                                                  <button class="text-xs text-primary underline" @click=${() => this.setThinkingRawMode(true)}>
                                                    Edit raw JSON instead
                                                  </button>
                                                `
                                              : this.providerSchema && this.providerSchema.params.length > 0
                                                ? html`
                                                    <div class="space-y-3 max-w-md">
                                                      ${this.providerSchema.params.map(
                                                        (p) => html`
                                                          <div>
                                                            <label class="block text-xs text-muted-foreground mb-1">${p.key} ${p.description ? `— ${p.description}` : ""}</label>
                                                            ${this.renderParamField(p)}
                                                          </div>
                                                        `,
                                                      )}
                                                    </div>
                                                  `
                                                : html`
                                                    <p class="text-xs text-muted-foreground mb-2">
                                                      ${m.provider ? "No configurable thinking parameters for this provider." : "Set a provider first to see configurable parameters."}
                                                    </p>
                                                    <button class="text-xs text-primary underline mb-2" @click=${() => this.setThinkingRawMode(true)}>
                                                      Add raw JSON params
                                                    </button>
                                                  `}

                                          <button
                                            class="block text-xs text-destructive hover:underline mt-2"
                                            @click=${() => {
                                              this.thinkingParams = {};
                                              this.requestUpdate();
                                            }}>
                                            Clear all
                                          </button>
                                        `}

                                    <div class="flex gap-2">
                                      ${Button({ variant: "default", size: "sm", children: html`${icon(Save, "xs")} Save Config`, onClick: () => this.saveThinkingConfig(), disabled: this.loading })}
                                      ${Button({ variant: "ghost", size: "sm", children: "Cancel", onClick: () => this.cancelThinkingEdit() })}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            `
                          : ""}
                      `)}
                    </tbody>
                  </table>
                </div>
              `}
      </div>
    `;
  }
}
