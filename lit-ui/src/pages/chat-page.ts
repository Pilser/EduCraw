import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  Model,
  UserMessage,
  AssistantMessage,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { createWsStreamFn } from "../core/ws-stream-fn";
import { eduModelToPiModel } from "../core/edu-model-provider";
import { eduApi } from "../core/edu-api";
import { SessionManager } from "../core/session-manager";
import { WsManager } from "../core/ws-manager";
import type { LoginResponse, EduModel, SessionListItem } from "../core/edu-types";
import { defaultConvertToLlm } from "../components/Messages.js";
import "../ChatPanel.js";
import type { ChatPanel } from "../ChatPanel.js";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { icon } from "@mariozechner/mini-lit";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { Menu, Plus } from "lucide";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { MenuDialog } from "../dialogs/MenuDialog.js";
import { FilesTab } from "../dialogs/FilesTab.js";
import { SessionsTab } from "../dialogs/SessionsTab.js";
import { AccountTab } from "../dialogs/AccountTab.js";

@customElement("chat-page")
export class ChatPage extends LitElement {
  @property({ attribute: false }) auth!: LoginResponse;
  @property({ attribute: false }) sessionId!: string;
  @property({ attribute: false }) sessionToken!: string;
  @state() private _ready = false;
  @state() private _error = "";
  @state() private currentTitle = "";
  @state() private isEditingTitle = false;

  private agent?: Agent;
  private chatPanel?: ChatPanel;
  private lastLoadedThreadId: string | null = null; // Track loaded session

  /**
   * Helper: Detect if an error is auth-related (401/403)
   */
  private isAuthError(err: any): boolean {
    // Check for HTTP error status codes
    if (err?.status === 401 || err?.status === 403) {
      return true;
    }
    // Check for "Unauthorized" in error message
    if (
      err?.message?.includes("Unauthorized") ||
      err?.message?.includes("unauthorized")
    ) {
      return true;
    }
    // Check for common auth error patterns
    if (err?.response?.status === 401 || err?.response?.status === 403) {
      return true;
    }
    return false;
  }

  /**
   * Helper: Dispatch session-expired event when auth fails
   */
  private dispatchSessionExpired() {
    console.log("Session expired - dispatching session-expired event");
    this.dispatchEvent(
      new CustomEvent("session-expired", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  createRenderRoot() {
    return this;
  }

  override async firstUpdated() {
    try {
      await this.initChat();
      this._ready = true;
      // Wait for re-render so .chat-container exists in DOM, then append
      await this.updateComplete;
      this.appendChatPanel();
      
      // IMPORTANT: Wait for WsManager to connect before loading session
      const wsManager = WsManager.getExistingInstance(
        this.sessionId,
        this.sessionToken,
      );
      if (wsManager) {
        console.log("[chat-page] Waiting for WebSocket connection...");
        const connected = await wsManager.waitForConnection(10000);
        if (connected) {
          console.log("[chat-page] WebSocket connected - loading recent session");
          // After chat is visible and WS is connected, try to load the most recent session
          this.loadMostRecentSession();
        } else {
          console.error(
            "[chat-page] WebSocket connection timeout - cannot load session",
          );
        }
      }
    } catch (err) {
      // Check if this is an authentication error (session expired)
      if (this.isAuthError(err)) {
        console.warn(
          "Authentication error detected during initialization",
          err,
        );
        this.dispatchSessionExpired();
        return;
      }
      this._error =
        err instanceof Error ? err.message : "Failed to initialize chat";
    }
  }

  override updated(changedProperties: Map<string, unknown>) {
    if (
      changedProperties.has("_ready") &&
      this._ready &&
      this.chatPanel?.parentElement === null
    ) {
      this.appendChatPanel();
    }
  }

  private appendChatPanel() {
    const container = this.querySelector(".chat-container");
    if (container && this.chatPanel && this.chatPanel.parentElement === null) {
      container.appendChild(this.chatPanel);
    }
  }

  private async initChat() {
    // Fetch models to get the active model
    let model: Model<any> | undefined;
    try {
      const sessionModels = await eduApi.getSessionModels(
        this.sessionId,
        this.auth.token,
      );
      const activeModel = sessionModels.models.find(
        (m: EduModel) => m.id === sessionModels.active,
      );
      if (activeModel) {
        model = eduModelToPiModel(activeModel);
      }
    } catch (err) {
      // Check if this is an authentication error (session expired)
      if (this.isAuthError(err)) {
        console.warn("Authentication error while fetching session models", err);
        throw err; // Re-throw to be caught by firstUpdated
      }
      // Will use default model for other errors
      console.error("Failed to fetch session models:", err);
    }

    // IMPORTANT: Create WsManager BEFORE creating Agent
    // This ensures the persistent connection exists for session replay
    console.log("[chat-page] Creating persistent WsManager connection");
    WsManager.getInstance({
      sessionId: this.sessionId,
      token: this.sessionToken,
      onReconnected: () => {
        console.log("[chat-page] WebSocket reconnected - reloading session");
        this.handleReconnection();
      },
      onError: (error) => {
        // Handle session expiration or auth failures
        console.error("[chat-page] WsManager error:", error.message);
        if (
          error.message.includes("Session expired") ||
          error.message.includes("authentication failed")
        ) {
          console.warn("[chat-page] Session/auth expired - dispatching event");
          this.dispatchSessionExpired();
        }
      },
      onMessage: () => {
        // Initial empty handler - will be overridden by ws-stream-fn
      },
    });

    // Create the Agent with WebSocket stream function
    // Pass convertToLlm to handle UserMessageWithAttachments (file attachments)
    // Pass onReconnected handler to reload session on reconnection
    this.agent = new Agent({
      initialState: {
        model: model!,
        thinkingLevel: "off",
      },
      streamFn: createWsStreamFn({
        sessionId: this.sessionId,
        authToken: this.sessionToken,
      }),
      convertToLlm: defaultConvertToLlm,
    });

    // Create ChatPanel and set the agent
    this.chatPanel = document.createElement("pi-chat-panel") as ChatPanel;
    await this.chatPanel.setAgent(this.agent, {
      onModelSelect: async () => {
        const { ModelSelector } = await import("../dialogs/ModelSelector.js");
        ModelSelector.open(this.agent!.state.model, async (newModel) => {
          this.agent!.state.model = newModel;
          try {
            await eduApi.setSessionModel(
              this.sessionId,
              this.auth.token,
              newModel.id,
            );
          } catch (err) {
            // Check if this is an authentication error
            if (this.isAuthError(err)) {
              console.warn("Session expired while switching model", err);
              this.dispatchSessionExpired();
              return;
            }
            console.error("Failed to switch model on server:", err);
          }
        });
      },
    });
  }

  // ── Session auto-load (matches legacy educlaw-web behavior) ──

  /**
   * Handle WebSocket reconnection - reload last session to restore state
   */
  private handleReconnection() {
    // Try to reload the last loaded session if we have one
    const lastThreadId = SessionManager.loadLastThreadId(this.sessionId);
    if (lastThreadId) {
      console.log(
        `[chat-page] Reloading last session ${lastThreadId} after reconnection`,
      );
      this.loadSessionById(lastThreadId);
    } else {
      console.log(
        "[chat-page] No previous session to reload - starting fresh after reconnection",
      );
    }
  }

  /** Helper: finalize current assistant message and push to array */
  private flushAssistant(
    msgs: AgentMessage[],
    assistant: AssistantMessage | null,
  ): AssistantMessage | null {
    if (assistant && assistant.content.length > 0) {
      msgs.push(assistant);
    }
    return null;
  }

  /** Helper: create a fresh assistant message shell */
  private makeAssistantMsg(): AssistantMessage {
    const m = this.agent!.state.model;
    return {
      role: "assistant",
      content: [],
      api: m.api,
      provider: m.provider,
      model: m.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };
  }

  /**
   * Load a specific session by thread ID using the persistent WsManager
   */
  private async loadSessionById(threadId: string) {
    if (!this.agent) return;

    // Get the persistent WsManager instance (already created by Agent)
    const wsManager = WsManager.getExistingInstance(
      this.sessionId,
      this.sessionToken,
    );
    if (!wsManager) {
      console.error("[replay] WsManager not found - cannot load session");
      return;
    }

    console.log(`[replay] Loading session ${threadId} via persistent WsManager`);

    // Replay state
    const replayedMessages: AgentMessage[] = [];
    let currentAssistant: AssistantMessage | null = null;
    let currentTextContent: TextContent | null = null;
    let currentThinkingContent: { type: "thinking"; thinking: string } | null =
      null;
    let pendingToolCallId: string | null = null;
    let replayComplete = false;

    // Save the original onMessage handler from ws-stream-fn
    const originalOnMessage = (wsManager as any).onMessage;

    // Temporarily override onMessage to intercept replay frames
    (wsManager as any).onMessage = (frame: any) => {
      // If replay is complete, restore original handler and forward
      if (replayComplete) {
        if (originalOnMessage) {
          originalOnMessage(frame);
        }
        return;
      }

      // Handle replay frames
      try {
        switch (frame.type) {
          case "user_text": {
            // CRITICAL: Flush previous assistant message BEFORE adding user message
            if (currentAssistant) {
              currentAssistant = this.flushAssistant(
                replayedMessages,
                currentAssistant,
              );
              currentTextContent = null;
              currentThinkingContent = null;
            }

            const text = (frame.text as string) || "";
            replayedMessages.push({
              role: "user",
              content: text,
              timestamp: Date.now(),
            } as UserMessage);
            break;
          }

          case "assistant_text": {
            currentThinkingContent = null;
            const delta = (frame.text as string) || "";

            if (!currentAssistant) {
              currentAssistant = this.makeAssistantMsg();
            }

            if (!currentTextContent) {
              currentTextContent = { type: "text", text: delta };
              currentAssistant.content = [
                ...currentAssistant.content,
                currentTextContent,
              ];
            } else {
              currentTextContent.text += delta;
            }
            break;
          }

          case "thinking": {
            if (!currentAssistant) {
              currentAssistant = this.makeAssistantMsg();
            }
            const thinkText = (frame.thinking as string) || "";

            if (currentThinkingContent === null) {
              currentThinkingContent = {
                type: "thinking",
                thinking: thinkText,
              };
              currentAssistant.content = [
                ...currentAssistant.content,
                currentThinkingContent,
              ];
            } else {
              currentThinkingContent.thinking += thinkText;
            }
            break;
          }

          case "tool_start": {
            currentTextContent = null;
            currentThinkingContent = null;

            if (!currentAssistant) {
              currentAssistant = this.makeAssistantMsg();
            }

            const name = (frame.name as string) || "unknown";
            const argsStr = (frame.input as string) || "{}";
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(argsStr);
            } catch {
              args = { input: argsStr };
            }

            const toolCall: ToolCall = {
              type: "toolCall",
              id: crypto.randomUUID(),
              name,
              arguments: args,
            };

            currentAssistant.content = [...currentAssistant.content, toolCall];
            pendingToolCallId = toolCall.id;
            break;
          }

          case "tool_end": {
            if (pendingToolCallId && currentAssistant) {
              const exitCode = (frame.exit_code as number) ?? 0;
              const stdout = (frame.stdout as string) || "";
              const stderr = (frame.stderr as string) || "";
              const status = frame.status as string;

              const resultText =
                stdout + (stderr ? "\n[stderr]\n" + stderr : "");

              const toolResult: ToolResultMessage = {
                role: "toolResult",
                toolCallId: pendingToolCallId,
                toolName: "",
                content: resultText ? [{ type: "text", text: resultText }] : [],
                isError: status === "failed" || exitCode !== 0,
                timestamp: Date.now(),
              } as ToolResultMessage;

              replayedMessages.push(toolResult);
              pendingToolCallId = null;
            }
            break;
          }

          case "load_session_complete": {
            if (currentAssistant) {
              this.flushAssistant(replayedMessages, currentAssistant);
              currentAssistant = null;
              currentTextContent = null;
              currentThinkingContent = null;
            }

            const loadedThreadId = (frame.thread_id as string) || "";
            if (loadedThreadId) {
              this.lastLoadedThreadId = loadedThreadId;
              SessionManager.saveLastThreadId(loadedThreadId, this.sessionId);
              console.log(
                `[replay] Saved thread ID ${loadedThreadId} for reconnection`,
              );
            }

            console.log(
              `[replay] Session replay complete — ${replayedMessages.length} messages restored`,
            );

            if (this.agent) {
              this.agent.state.messages = replayedMessages;

              if (replayedMessages.length > 0 && !this.currentTitle) {
                this.currentTitle = this.generateTitle(replayedMessages);
              }

              const agentInterface = this.querySelector("agent-interface");
              if (agentInterface) {
                (agentInterface as LitElement).requestUpdate();
              }
              this.chatPanel?.requestUpdate();
            }

            // Mark replay as complete and restore original handler
            replayComplete = true;
            (wsManager as any).onMessage = originalOnMessage;
            console.log("[replay] Restored original WsManager onMessage handler");
            break;
          }

          case "error": {
            const errorMsg = (frame as any).message || "Unknown error";
            console.error("[replay] Session replay error:", errorMsg);
            if (
              errorMsg.includes("Unauthorized") ||
              errorMsg.includes("unauthorized") ||
              errorMsg.includes("401") ||
              errorMsg.includes("403")
            ) {
              console.warn(
                "[replay] Authentication error detected in session replay",
              );
              this.dispatchSessionExpired();
            }
            // Restore original handler on error
            replayComplete = true;
            (wsManager as any).onMessage = originalOnMessage;
            break;
          }

          default:
            // Forward other frames to original handler (like binary, chat frames during replay)
            if (originalOnMessage) {
              originalOnMessage(frame);
            }
            break;
        }
      } catch (err) {
        console.error("[replay] Error processing frame:", err);
      }
    };

    // Send load_session command via the persistent connection
    const sent = wsManager.send({
      type: "load_session",
      thread_id: threadId,
    });

    if (!sent) {
      console.error("[replay] Failed to send load_session - WS not open");
      // Restore original handler
      (wsManager as any).onMessage = originalOnMessage;
      return;
    }

    // Safety timeout in case load_session_complete never arrives
    setTimeout(() => {
      if (!replayComplete) {
        console.warn("[replay] Load timeout - restoring original handler");
        if (currentAssistant) {
          this.flushAssistant(replayedMessages, currentAssistant);
        }
        if (this.agent) {
          this.agent.state.messages = replayedMessages;
          const agentInterface = this.querySelector("agent-interface");
          if (agentInterface) {
            (agentInterface as LitElement).requestUpdate();
          }
          this.chatPanel?.requestUpdate();
        }
        replayComplete = true;
        (wsManager as any).onMessage = originalOnMessage;
      }
    }, 15000);
  }

  /**
   * Opens a temporary WebSocket to list sessions, find the most recent
   * one with messages, and load it.
   */
  private async loadMostRecentSession() {
    if (!this.agent || !this.sessionId) return;

    console.log("[replay] Listing threads via REST");

    try {
      const sessions = await eduApi.listThreads(this.sessionId, this.sessionToken);

      const withMessages = sessions.filter((s) => {
        const count = s.metadata?.messageCount ?? 0;
        return count > 0;
      });

      if (withMessages.length > 0) {
        const latest = withMessages[0];
        console.log(
          `[replay] Loading most recent session: ${latest.id} (${latest.metadata?.messageCount ?? "?"} messages)`,
        );
        this.loadSessionById(latest.id);
      } else {
        console.log(
          "[replay] No existing sessions with messages — starting fresh",
        );
      }
    } catch (err) {
      console.error("[replay] Failed to list threads:", err);
    }
  }

  // ── Title Generation ──

  private generateTitle(messages: AgentMessage[]): string {
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg) return "";

    let text = "";
    const content = firstUserMsg.content;

    if (typeof content === "string") {
      text = content;
    } else {
      const textBlocks = content.filter((c): c is TextContent => c.type === "text");
      text = textBlocks.map((c) => c.text || "").join(" ");
    }

    text = text.trim();
    if (!text) return "";

    const sentenceEnd = text.search(/[.!?]/);
    if (sentenceEnd > 0 && sentenceEnd <= 50) {
      return text.substring(0, sentenceEnd + 1);
    }
    return text.length <= 50 ? text : `${text.substring(0, 47)}...`;
  }

  private shouldSaveSession(messages: AgentMessage[]): boolean {
    const hasUserMsg = messages.some((m) => m.role === "user");
    const hasAssistantMsg = messages.some((m) => m.role === "assistant");
    return hasUserMsg && hasAssistantMsg;
  }

  // ── Session Management UI ──

  private async openMenu() {
    console.log("[chat-page] Opening menu dialog");

    const filesTab = new FilesTab();
    filesTab.sessionId = this.sessionId;
    filesTab.sessionToken = this.sessionToken;
    filesTab.studentToken = this.auth.token;
    filesTab.subjectIds = this.auth.subject_ids;

    const sessionsTab = new SessionsTab();
    sessionsTab.sessionId = this.sessionId;
    sessionsTab.sessionToken = this.sessionToken;
    sessionsTab.onLoadSession = (sessionId: string) => this.loadSessionById(sessionId);
    sessionsTab.onNewSession = () => this.newSession();

    const accountTab = new AccountTab();
    accountTab.sessionId = this.sessionId;
    accountTab.sessionToken = this.sessionToken;
    accountTab.onLogout = () => this.handleLogout();

    MenuDialog.open([filesTab, sessionsTab, accountTab]);
  }

  private async newSession() {
    try {
      const { thread_id } = await eduApi.createThread(this.sessionId, this.sessionToken);
      console.log("[chat-page] New thread created:", thread_id);

      if (this.agent) {
        this.agent.state.messages = [];
        this.currentTitle = "";
        this.lastLoadedThreadId = thread_id;

        const agentInterface = this.querySelector("agent-interface");
        if (agentInterface) {
          (agentInterface as LitElement).requestUpdate();
        }
        this.chatPanel?.requestUpdate();
        this.requestUpdate();
      }
    } catch (err) {
      console.error("[chat-page] Failed to create new thread:", err);
    }
  }

  // ── Logout ──

  private handleLogout() {
    SessionManager.clearAuth();
    this.dispatchEvent(
      new CustomEvent("logout", { bubbles: true, composed: true }),
    );
  }

  render() {
    if (this._error) {
      return html`
        <div
          class="w-full h-screen flex items-center justify-center bg-background text-foreground"
        >
          <div class="text-center">
            <p class="text-destructive mb-4">${this._error}</p>
            <button
              class="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
              @click=${this.handleLogout}
            >
              Back to Login
            </button>
          </div>
        </div>
      `;
    }

    return html`
      <div
        class="w-full h-screen flex flex-col bg-background text-foreground overflow-hidden"
      >
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-border shrink-0">
          <div class="flex items-center gap-2 px-4 py-2">
            ${Button({
              variant: "ghost",
              size: "sm",
              children: icon(Menu, "sm"),
              onClick: () => this.openMenu(),
              title: "Menu",
            })}
            ${Button({
              variant: "ghost",
              size: "sm",
              children: icon(Plus, "sm"),
              onClick: () => this.newSession(),
              title: "New Session",
            })}

            ${
              this.currentTitle
                ? this.isEditingTitle
                  ? html`<div class="flex items-center gap-2">
                      ${Input({
                        type: "text",
                        value: this.currentTitle,
                        className: "text-sm w-64",
                        onChange: async (e: Event) => {
                          const newTitle = (e.target as HTMLInputElement).value.trim();
                          if (newTitle && newTitle !== this.currentTitle) {
                            this.currentTitle = newTitle;
                            // TODO: Wire to backend API to update session title
                          }
                          this.isEditingTitle = false;
                          this.requestUpdate();
                        },
                        onKeyDown: async (e: KeyboardEvent) => {
                          if (e.key === "Enter") {
                            const newTitle = (e.target as HTMLInputElement).value.trim();
                            if (newTitle && newTitle !== this.currentTitle) {
                              this.currentTitle = newTitle;
                              // TODO: Wire to backend API to update session title
                            }
                            this.isEditingTitle = false;
                            this.requestUpdate();
                          } else if (e.key === "Escape") {
                            this.isEditingTitle = false;
                            this.requestUpdate();
                          }
                        },
                      })}
                    </div>`
                  : html`<button
                      class="px-2 py-1 text-sm text-foreground hover:bg-secondary rounded transition-colors"
                      @click=${() => {
                        this.isEditingTitle = true;
                        this.requestUpdate();
                        requestAnimationFrame(() => {
                          const input = this.querySelector('input[type="text"]') as HTMLInputElement;
                          if (input) {
                            input.focus();
                            input.select();
                          }
                        });
                      }}
                      title="Click to edit title"
                    >
                      ${this.currentTitle}
                    </button>`
                : html`<span class="text-base font-semibold text-foreground">EduCraw Chat</span>`
            }
          </div>
          <div class="flex items-center gap-1 px-2">
            <theme-toggle></theme-toggle>
          </div>
        </div>

        <!-- Chat Panel -->
        ${this._ready
          ? html`<div class="flex-1 min-h-0 chat-container"></div>`
          : html`
              <div class="w-full h-full flex items-center justify-center">
                <p class="text-muted-foreground">Initializing chat…</p>
              </div>
            `}
      </div>
    `;
  }
}
