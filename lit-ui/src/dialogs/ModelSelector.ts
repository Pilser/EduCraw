import { type Model } from "@earendil-works/pi-ai";
import { icon } from "@mariozechner/mini-lit";
import { Badge } from "@mariozechner/mini-lit/dist/Badge.js";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { DialogHeader } from "@mariozechner/mini-lit/dist/Dialog.js";
import { DialogBase } from "@mariozechner/mini-lit/dist/DialogBase.js";
import { html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { Brain, Image as ImageIcon } from "lucide";
import { Input } from "../components/Input.js";
import { formatModelCost } from "../utils/format.js";
import { i18n } from "../utils/i18n.js";
import { eduApi } from "../core/edu-api.js";
import { eduModelToPiModel } from "../core/edu-model-provider.js";
import { SessionManager } from "../core/session-manager.js";
function subsequenceScore(query: string, text: string): number {
  let qi = 0;
  let ti = 0;
  let gaps = 0;
  let lastMatchIndex = -1;

  while (qi < query.length && ti < text.length) {
    if (query[qi] === text[ti]) {
      if (lastMatchIndex >= 0) {
        gaps += ti - lastMatchIndex - 1;
      }
      lastMatchIndex = ti;
      qi++;
    }
    ti++;
  }

  // All query chars must match
  if (qi < query.length) return 0;

  // Score: longer query match = better, fewer gaps = better
  // Normalize so exact substring gets highest score
  return query.length / (query.length + gaps);
}


/** Check if two models are the same by comparing IDs */
function modelsAreEqual(a: Model<any> | null, b: Model<any> | null): boolean {
  if (!a || !b) return false;
  return a.id === b.id && a.provider === b.provider;
}

@customElement("agent-model-selector")
export class ModelSelector extends DialogBase {
  @state() currentModel: Model<any> | null = null;
  @state() searchQuery = "";
  @state() filterThinking = false;
  @state() filterVision = false;
  @state() modelsLoading = false;
  @state() selectedIndex = 0;
  @state() private navigationMode: "mouse" | "keyboard" = "mouse";
  @state() private eduModels: Model<any>[] = [];

  private onSelectCallback?: (model: Model<any>) => void;
  private allowedProviders?: Set<string>;
  private scrollContainerRef = createRef<HTMLDivElement>();
  private searchInputRef = createRef<HTMLInputElement>();
  private lastMousePosition = { x: 0, y: 0 };
  private sessionId?: string;
  private authToken?: string;

  protected override modalWidth = "min(400px, 90vw)";

  static async open(
    currentModel: Model<any> | null,
    onSelect: (model: Model<any>) => void,
    allowedProviders?: string[],
  ) {
    const selector = new ModelSelector();
    selector.currentModel = currentModel;
    selector.onSelectCallback = onSelect;
    if (allowedProviders) {
      selector.allowedProviders = new Set(allowedProviders);
    }
    selector.open();
    selector.loadEduModels();
  }

  override async firstUpdated(
    changedProperties: PropertyValues,
  ): Promise<void> {
    super.firstUpdated(changedProperties);
    // Wait for dialog to be fully rendered
    await this.updateComplete;
    // Focus the search input when dialog opens
    this.searchInputRef.value?.focus();

    // Track actual mouse movement
    this.addEventListener("mousemove", (e: MouseEvent) => {
      // Check if mouse actually moved
      if (
        e.clientX !== this.lastMousePosition.x ||
        e.clientY !== this.lastMousePosition.y
      ) {
        this.lastMousePosition = { x: e.clientX, y: e.clientY };
        // Only switch to mouse mode on actual mouse movement
        if (this.navigationMode === "keyboard") {
          this.navigationMode = "mouse";
          // Update selection to the item under the mouse
          const target = e.target as HTMLElement;
          const modelItem = target.closest("[data-model-item]");
          if (modelItem) {
            const allItems =
              this.scrollContainerRef.value?.querySelectorAll(
                "[data-model-item]",
              );
            if (allItems) {
              const index = Array.from(allItems).indexOf(modelItem);
              if (index !== -1) {
                this.selectedIndex = index;
              }
            }
          }
        }
      }
    });

    // Add global keyboard handler for the dialog
    this.addEventListener("keydown", (e: KeyboardEvent) => {
      // Ignore key events during IME composition (e.g. CJK input)
      if (e.isComposing || e.key === "Process") return;

      // Get filtered models to know the bounds
      const filteredModels = this.getFilteredModels();

      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.navigationMode = "keyboard";
        this.selectedIndex = Math.min(
          this.selectedIndex + 1,
          filteredModels.length - 1,
        );
        this.scrollToSelected();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.navigationMode = "keyboard";
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.scrollToSelected();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredModels[this.selectedIndex]) {
          this.handleSelect(filteredModels[this.selectedIndex].model);
        }
      }
    });
  }

  private async loadEduModels() {
    this.modelsLoading = true;
    try {
      const auth = SessionManager.loadAuth();
      const sid = this.sessionId || SessionManager.loadSessionId();
      if (!auth || !sid) return;

      const { models } = await eduApi.getSessionModels(sid, auth.token);
      this.eduModels = models
        .filter((m: any) => m.enabled === 1)
        .map((m: any) => eduModelToPiModel(m));
    } catch (error) {
      console.error("Failed to load models:", error);
    } finally {
      this.modelsLoading = false;
      this.requestUpdate();
    }
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}`;
    return String(tokens);
  }

  private handleSelect(model: Model<any>) {
    if (model) {
      this.onSelectCallback?.(model);
      this.close();
    }
  }

  private getFilteredModels(): Array<{
    provider: string;
    id: string;
    model: any;
  }> {
    // Collect models from EduCrawl server
    const allModels: Array<{ provider: string; id: string; model: any }> = [];
    for (const model of this.eduModels) {
      allModels.push({ provider: model.provider, id: model.id, model });
    }

    // Filter by allowed providers if set
    if (this.allowedProviders) {
      const allowed = this.allowedProviders;
      allModels.splice(
        0,
        allModels.length,
        ...allModels.filter(({ provider }) => allowed.has(provider)),
      );
    }

    // Filter models based on search and capability filters
    let filteredModels = allModels;

    // Apply search filter (subsequence match: characters must appear in order)
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase().replace(/\s+/g, "");
      if (query) {
        const scored: Array<{ item: (typeof allModels)[0]; score: number }> =
          [];
        for (const entry of filteredModels) {
          const searchText =
            `${entry.provider} ${entry.id} ${entry.model.name}`.toLowerCase();
          const score = subsequenceScore(query, searchText);
          if (score > 0) {
            scored.push({ item: entry, score });
          }
        }
        scored.sort((a, b) => b.score - a.score);
        filteredModels = scored.map((s) => s.item);
      }
    }

    // Apply capability filters
    if (this.filterThinking) {
      filteredModels = filteredModels.filter(({ model }) => model.reasoning);
    }
    if (this.filterVision) {
      filteredModels = filteredModels.filter(({ model }) =>
        model.input.includes("image"),
      );
    }

    // Sort: when not searching, current model first then by provider.
    // When searching, preserve the score-based order from above,
    // but still float the current model to the top.
    if (!this.searchQuery) {
      filteredModels.sort((a, b) => {
        const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
        const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
        if (aIsCurrent && !bIsCurrent) return -1;
        if (!aIsCurrent && bIsCurrent) return 1;
        return a.provider.localeCompare(b.provider);
      });
    }

    return filteredModels;
  }

  private scrollToSelected() {
    requestAnimationFrame(() => {
      const scrollContainer = this.scrollContainerRef.value;
      const selectedElement = scrollContainer?.querySelectorAll(
        "[data-model-item]",
      )[this.selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    });
  }

  protected override renderContent(): TemplateResult {
    const filteredModels = this.getFilteredModels();

    return html`
      <!-- Header and Search -->
      <div
        class="p-6 pb-4 flex flex-col gap-4 border-b border-border flex-shrink-0"
      >
        ${DialogHeader({ title: i18n("Select Model") })}
        ${Input({
          placeholder: i18n("Search models..."),
          value: this.searchQuery,
          inputRef: this.searchInputRef,
          onInput: (e: Event) => {
            this.searchQuery = (e.target as HTMLInputElement).value;
            this.selectedIndex = 0;
            // Reset scroll position when search changes
            if (this.scrollContainerRef.value) {
              this.scrollContainerRef.value.scrollTop = 0;
            }
          },
        })}
        <div class="flex gap-2">
          ${Button({
            variant: this.filterThinking ? "default" : "secondary",
            size: "sm",
            onClick: () => {
              this.filterThinking = !this.filterThinking;
              this.selectedIndex = 0;
              if (this.scrollContainerRef.value) {
                this.scrollContainerRef.value.scrollTop = 0;
              }
            },
            className: "rounded-full",
            children: html`<span class="inline-flex items-center gap-1"
              >${icon(Brain, "sm")} ${i18n("Thinking")}</span
            >`,
          })}
          ${Button({
            variant: this.filterVision ? "default" : "secondary",
            size: "sm",
            onClick: () => {
              this.filterVision = !this.filterVision;
              this.selectedIndex = 0;
              if (this.scrollContainerRef.value) {
                this.scrollContainerRef.value.scrollTop = 0;
              }
            },
            className: "rounded-full",
            children: html`<span class="inline-flex items-center gap-1"
              >${icon(ImageIcon, "sm")} ${i18n("Vision")}</span
            >`,
          })}
        </div>
      </div>

      <!-- Scrollable model list -->
      <div class="flex-1 overflow-y-auto" ${ref(this.scrollContainerRef)}>
        ${filteredModels.map(({ provider, id, model }, index) => {
          const isCurrent = modelsAreEqual(this.currentModel, model);
          const isSelected = index === this.selectedIndex;
          return html`
            <div
              data-model-item
              class="px-4 py-3 ${this.navigationMode === "mouse"
                ? "hover:bg-muted"
                : ""} cursor-pointer border-b border-border ${isSelected
                ? "bg-accent"
                : ""}"
              @click=${() => this.handleSelect(model)}
              @mouseenter=${() => {
                // Only update selection in mouse mode
                if (this.navigationMode === "mouse") {
                  this.selectedIndex = index;
                }
              }}
            >
              <div class="flex items-center justify-between gap-2 mb-1">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <span class="text-sm font-medium text-foreground truncate"
                    >${id}</span
                  >
                  ${isCurrent
                    ? html`<span class="text-green-500">✓</span>`
                    : ""}
                </div>
                ${Badge(provider, "outline")}
              </div>
              <div
                class="flex items-center justify-between text-xs text-muted-foreground"
              >
                <div class="flex items-center gap-2">
                  <span class="${model.reasoning ? "" : "opacity-30"}"
                    >${icon(Brain, "sm")}</span
                  >
                  <span
                    class="${model.input.includes("image") ? "" : "opacity-30"}"
                    >${icon(ImageIcon, "sm")}</span
                  >
                  <span
                    >${this.formatTokens(
                      model.contextWindow,
                    )}K/${this.formatTokens(model.maxTokens)}K</span
                  >
                </div>
                <span>${formatModelCost(model.cost)}</span>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }
}
