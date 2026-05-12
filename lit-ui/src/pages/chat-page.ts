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
import type { LoginResponse, EduModel } from "../core/edu-types";
import { defaultConvertToLlm } from "../components/Messages.js";
import "../ChatPanel.js";
import type { ChatPanel } from "../ChatPanel.js";

// ── Session list item from server (sessions_list frame) ──
interface SessionListItem {
  id: string;
  title?: string;
  updated_at?: string;
  cwd: string;
  metadata?: { messageCount?: number };
}

@customElement("chat-page")
export class ChatPage extends LitElement {
  @property({ attribute: false }) auth!: LoginResponse;
  @property({ attribute: false }) sessionId!: string;
  @property({ attribute: false }) sessionToken!: string;
  @state() private _ready = false;
  @state() private _error = "";

  private agent?: Agent;
  private chatPanel?: ChatPanel;

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
      // After chat is visible, try to load the most recent session
      this.loadMostRecentSession();
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

    // Create the Agent with WebSocket stream function
    // Pass convertToLlm to handle UserMessageWithAttachments (file attachments)
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
   * Opens a temporary WebSocket to list sessions, find the most recent
   * one with messages, load it, and inject replayed messages into the Agent.
   */
  private async loadMostRecentSession() {
    if (!this.agent || !this.sessionId) return;

    const wsBase =
      import.meta.env.VITE_WS_TARGET ||
      `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    const wsUrl = `${wsBase}/sessions/${this.sessionId}/ws?token=${encodeURIComponent(this.sessionToken)}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    // Replay state
    const replayedMessages: AgentMessage[] = [];
    let currentAssistant: AssistantMessage | null = null;
    let currentTextContent: TextContent | null = null;
    let currentThinkingContent: { type: "thinking"; thinking: string } | null =
      null;
    let pendingToolCallId: string | null = null;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "list_sessions" }));
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) return;

      try {
        const frame = JSON.parse(event.data as string);
        // Debug replay frame order
        if (
          frame.type === "user_text" ||
          frame.type === "assistant_text" ||
          frame.type === "chat_start" ||
          frame.type === "chat_end"
        ) {
          console.log(
            "[replay] frame:",
            frame.type,
            (frame as any).text?.slice(0, 30) || "",
          );
        }

        switch (frame.type) {
          case "sessions_list": {
            const sessions: SessionListItem[] =
              (frame.sessions as SessionListItem[]) || [];

            // Filter to sessions with messages (skip empty just-created ones)
            const withMessages = sessions.filter((s) => {
              const count = s.metadata?.messageCount ?? 0;
              return count > 0;
            });

            if (withMessages.length > 0) {
              // Sessions are ordered newest-first by Goose
              const latest = withMessages[0];
              console.log(
                `Loading most recent session: ${latest.id} (${latest.metadata?.messageCount ?? "?"} messages)`,
              );
              ws.send(
                JSON.stringify({
                  type: "load_session",
                  thread_id: latest.id,
                }),
              );
            } else {
              console.log(
                "No existing sessions with messages — starting fresh",
              );
              ws.close();
            }
            break;
          }

          case "user_text": {
            // New user turn — finalize previous assistant message first
            currentAssistant = this.flushAssistant(
              replayedMessages,
              currentAssistant,
            );
            const text = (frame.text as string) || "";
            replayedMessages.push({
              role: "user",
              content: text,
              timestamp: Date.now(),
            } as UserMessage);
            break;
          }

          case "assistant_text": {
            // Clear any pending thinking block (transition to text)
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
            // Auto-create assistant if needed (thinking may arrive before text)
            if (!currentAssistant) {
              currentAssistant = this.makeAssistantMsg();
            }
            const thinkText = (frame.thinking as string) || "";

            // Accumulate thinking chunks into a single block
            if (currentThinkingContent === null) {
              // Start new thinking block
              currentThinkingContent = {
                type: "thinking",
                thinking: thinkText,
              };
              currentAssistant.content = [
                ...currentAssistant.content,
                currentThinkingContent,
              ];
            } else {
              // Continue accumulating
              currentThinkingContent.thinking += thinkText;
            }
            break;
          }

          case "tool_start": {
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
            currentTextContent = null;
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
            // Flush any pending assistant message
            this.flushAssistant(replayedMessages, currentAssistant);
            currentAssistant = null;
            currentTextContent = null;

            console.log(
              `Session replay complete — ${replayedMessages.length} messages restored`,
            );
            console.log(
              "[replay] message order:",
              replayedMessages.map((m: AgentMessage) => m.role),
            );

            if (replayedMessages.length > 0 && this.agent) {
              this.agent.state.messages = replayedMessages;
              // Force UI re-render — find agent-interface and update it
              const agentInterface = this.querySelector("agent-interface");
              if (agentInterface) {
                (agentInterface as LitElement).requestUpdate();
              }
              this.chatPanel?.requestUpdate();
            }

            ws.close();
            break;
          }

          case "error": {
            const errorMsg = (frame as any).message || "Unknown error";
            console.error("Session replay error:", errorMsg);
            // Check if this is an auth-related error
            if (
              errorMsg.includes("Unauthorized") ||
              errorMsg.includes("unauthorized") ||
              errorMsg.includes("401") ||
              errorMsg.includes("403")
            ) {
              console.warn("Authentication error detected in session replay");
              this.dispatchSessionExpired();
            }
            ws.close();
            break;
          }

          default:
            break;
        }
      } catch {
        // Ignore malformed frames
      }
    };

    ws.onerror = (err) => {
      console.error("Session WS error:", err);
      // WebSocket errors might indicate authentication failures
      // Log it for debugging purposes
    };

    ws.onclose = (event) => {
      // Flush any partial assistant message before giving up
      this.flushAssistant(replayedMessages, currentAssistant);
      // Check if close code indicates auth error (1008 = Policy Violation, sometimes used for auth)
      // or 1000 is normal close
      if (event.code !== 1000 && event.code !== 1005) {
        console.warn(
          `WebSocket closed with code ${event.code}: ${event.reason || "no reason provided"}`,
        );
      }
    };

    // Safety timeout
    setTimeout(() => {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        console.log("Session load timed out");
        ws.close();
      }
    }, 15000);
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
        ${this._ready
          ? html`<div class="flex-1 min-h-0 chat-container"></div>`
          : html`
              <div class="w-full h-screen flex items-center justify-center">
                <p class="text-muted-foreground">Initializing chat…</p>
              </div>
            `}
      </div>
    `;
  }
}
