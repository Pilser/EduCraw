import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createWsStreamFn, type StreamCallbacks } from "../core/ws-stream-fn.js";
import { eduApi } from "../core/edu-api.js";
import { SessionManager } from "../core/session-manager.js";
import { WsManager } from "../core/ws-manager.js";
import type {
  LoginResponse,
  EduModel,
  SessionListItem,
  BackendAssistantMessage,
  BackendMessage,
  BackendUserMessage,
  BackendToolCallBlock,
} from "../core/edu-types.js";
import "../ChatPanel.js";
import type { ChatPanel } from "../ChatPanel.js";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { icon } from "@mariozechner/mini-lit";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { Menu, Plus } from "lucide";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import "../components/MatrixToggle.js";
import { MenuDialog } from "../dialogs/MenuDialog.js";
import { FilesTab } from "../dialogs/FilesTab.js";
import { SessionsTab } from "../dialogs/SessionsTab.js";
import { AccountTab } from "../dialogs/AccountTab.js";
import "../dialogs/LandingBanner.js";
import "../components/FileDrawer.js";
import "../components/FileDrawerToggle.js";
import "../components/FilePreviewModal.js";
import type { FileDrawer } from "../components/FileDrawer.js";
import type { FilePreviewModal } from "../components/FilePreviewModal.js";

@customElement("chat-page")
export class ChatPage extends LitElement {
  @property({ attribute: false }) auth!: LoginResponse;
  @property({ attribute: false }) sessionId!: string;
  @property({ attribute: false }) sessionToken!: string;
  @state() private _ready = false;
  @state() private _error = "";
  @state() private currentTitle = "";
  @state() private isEditingTitle = false;
  @state() private showLanding = true;
  @state() private sessionTodo = "";
  @state() private tokenBalance = 0;
  @state() private fileDrawerOpen = false;
  @state() private previewModalOpen = false;

  @state() private messages: BackendMessage[] = [];
  @state() private isStreaming = false;
  @state() private streamingMessage: BackendAssistantMessage | null = null;

  private chatPanel?: ChatPanel;
  private lastLoadedThreadId: string | null = null;
  private fileDrawer?: FileDrawer;
  private previewModal?: FilePreviewModal;
  private currentPreviewFile?: { node: any; isSubject: boolean; subjectId?: string };
  private wsStreamFn?: (input: string, callbacks: StreamCallbacks) => void;
  private activeModelId = "grok-4-1-fast-reasoning";
  private activeModelDisplayName = "grok-4-1-fast-reasoning";

  private isAuthError(err: any): boolean {
    if (err?.status === 401 || err?.status === 403) return true;
    if (err?.message?.includes("Unauthorized") || err?.message?.includes("unauthorized")) return true;
    if (err?.response?.status === 401 || err?.response?.status === 403) return true;
    return false;
  }

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
      this.loadBalance();
      await this.updateComplete;
      await this.chatPanel!.updateComplete;

      const ai = this.chatPanel!.agentInterface;
      if (ai) {
        ai.messages = this.messages;
        ai.currentModel = {
          id: this.activeModelId,
          name: this.activeModelDisplayName,
          provider: "unknown",
          reasoning: true,
        };
        ai.thinkingLevel = "off";
        ai.sessionTodo = this.sessionTodo;
        ai.requestUpdate();
      }

      const wsManager = WsManager.getExistingInstance(
        this.sessionId,
        this.sessionToken,
      );
      if (wsManager) {
        console.log("[chat-page] Waiting for WebSocket connection...");
        const connected = await wsManager.waitForConnection(10000);
        if (connected) {
          console.log("[chat-page] WebSocket connected - loading recent session");
          this.loadMostRecentSession();
        } else {
          console.error(
            "[chat-page] WebSocket connection timeout - cannot load session",
          );
        }
      }
    } catch (err) {
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
    this.activeModelId = "grok-4-1-fast-reasoning";
    this.activeModelDisplayName = "grok-4-1-fast-reasoning";
    try {
      const sessionModels = await eduApi.getSessionModels(
        this.sessionId,
        this.auth.token,
      );
      const activeId = sessionModels.active || this.activeModelId;
      this.activeModelId = activeId;
      const activeModel = sessionModels.models.find((m) => m.name === activeId);
      this.activeModelDisplayName = activeModel?.display_name || activeId;
    } catch (err) {
      if (this.isAuthError(err)) throw err;
      console.error("Failed to fetch session models:", err);
    }

    console.log("[chat-page] Creating persistent WsManager connection");
    WsManager.getInstance({
      sessionId: this.sessionId,
      token: this.sessionToken,
      onReconnected: () => {
        console.log("[chat-page] WebSocket reconnected - reloading session");
        this.handleReconnection();
      },
      onError: (error) => {
        console.error("[chat-page] WsManager error:", error.message);
        if (error.message.includes("JWT token expired")) {
          // JWT expired - user needs to re-login
          console.warn("[chat-page] JWT expired - dispatching session-expired (will force login)");
          this.dispatchSessionExpired();
        } else if (error.message.includes("Session expired")) {
          // Session expired but JWT may still be valid - try to refresh
          console.warn("[chat-page] Session expired - attempting session refresh");
          this.handleSessionRefresh();
        } else if (
          error.message.includes("Session expired") ||
          error.message.includes("authentication failed")
        ) {
          console.warn("[chat-page] Session/auth expired - dispatching event");
          this.dispatchSessionExpired();
        }
      },
      onMessage: () => {},
    });

    this.wsStreamFn = createWsStreamFn({
      sessionId: this.sessionId,
      authToken: this.sessionToken,
      onStreamStart: () => {
        if (this.showLanding) {
          this.showLanding = false;
          this.requestUpdate();
        }
      },
    });

    this.chatPanel = document.createElement("pi-chat-panel") as ChatPanel;
    this.chatPanel.init({
      onSend: (text: string) => this.handleSend(text),
      onCancel: () => this.handleCancel(),
      onModelSelect: async () => {
        const { ModelSelector } = await import("../dialogs/ModelSelector.js");
        ModelSelector.open(this.activeModelId, async (newModelId, newModelName) => {
          this.activeModelId = newModelId;
          this.activeModelDisplayName = newModelName;
          if (this.chatPanel?.agentInterface) {
            this.chatPanel.agentInterface.currentModel = {
              id: this.activeModelId,
              name: this.activeModelDisplayName,
              provider: "unknown",
              reasoning: true,
            };
            this.chatPanel.agentInterface.requestUpdate();
          }
          try {
            await eduApi.setSessionModel(
              this.sessionId,
              this.auth.token,
              newModelId,
            );
          } catch (err) {
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

  private handleReconnection() {
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

  /** Handle session expiry - try to create a new session without re-login */
  private async handleSessionRefresh() {
    console.log("[chat-page] Attempting to refresh session...");
    try {
      const session = await eduApi.createSession(
        this.auth.student_id,
        this.auth.token,
      );
      console.log(
        `[chat-page] Session refreshed: ${session.session_id}`,
      );
      
      // Update stored session
      SessionManager.saveSession(session.session_id, session.token);
      
      // Dispatch event to update the view with new session
      this.dispatchEvent(
        new CustomEvent("new-session", {
          bubbles: true,
          composed: true,
          detail: {
            sessionId: session.session_id,
            sessionToken: session.token,
          },
        }),
      );
    } catch (err) {
      console.error("[chat-page] Session refresh failed:", err);
      // If refresh fails, JWT may also be expired - force re-login
      this.dispatchSessionExpired();
    }
  }

  private async handleSend(text: string) {
    if (!this.wsStreamFn || this.isStreaming) return;

    const userMsg: BackendUserMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    this.messages = [...this.messages, userMsg];
    this.isStreaming = true;
    this.showLanding = false;
    this.streamingMessage = null;

    if (!this.currentTitle) {
      this.currentTitle = this.generateTitleFromText(text);
    }

    const callbacks: StreamCallbacks = {
      onTextStart: () => {
        this.streamingMessage = {
          role: "assistant",
          content: [],
          timestamp: Date.now(),
        };
        this.updateStreaming();
      },
      onTextDelta: (delta: string) => {
        if (!this.streamingMessage) return;
        const lastBlock = this.streamingMessage.content[this.streamingMessage.content.length - 1];
        if (lastBlock && lastBlock.type === "text") {
          (lastBlock as any).text += delta;
        } else {
          this.streamingMessage.content.push({ type: "text", text: delta });
        }
        this.updateStreaming();
      },
      onTextEnd: () => {
        this.updateStreaming();
      },
      onThinkingStart: () => {
        if (!this.streamingMessage) return;
        this.streamingMessage.content.push({
          type: "thinking",
          thinking: "",
        } as any);
        this.updateStreaming();
      },
      onThinkingDelta: (delta: string) => {
        if (!this.streamingMessage) return;
        const lastBlock = this.streamingMessage.content[this.streamingMessage.content.length - 1];
        if (lastBlock && lastBlock.type === "thinking") {
          (lastBlock as any).thinking += delta;
        }
        this.updateStreaming();
      },
      onThinkingEnd: () => {
        this.updateStreaming();
      },
      onToolCallStart: (toolCall: BackendToolCallBlock) => {
        if (!this.streamingMessage) return;
        this.streamingMessage.content.push(toolCall);
        this.updateStreaming();
      },
      onToolCallEnd: (toolCall: BackendToolCallBlock) => {
        this.updateStreaming();
      },
      onDone: (msg: BackendAssistantMessage) => {
        this.messages = [...this.messages, msg];
        this.isStreaming = false;
        this.streamingMessage = null;
        this.updateUI();
      },
      onError: (error: Error) => {
        console.error("[chat-page] Stream error:", error);
        this.isStreaming = false;
        this.streamingMessage = null;
        this.updateUI();
      },
    };

    this.wsStreamFn(text, callbacks);
    this.updateUI();
  }

  private handleCancel() {
    const wsManager = WsManager.getExistingInstance(
      this.sessionId,
      this.sessionToken,
    );
    if (wsManager) {
      wsManager.send({ type: "cancel" });
    }
    this.isStreaming = false;
    this.streamingMessage = null;
    this.updateUI();
  }

  private updateStreaming() {
    if (this.chatPanel?.agentInterface) {
      this.chatPanel.agentInterface.isStreaming = this.isStreaming;
      this.chatPanel.agentInterface.setStreamingMessage(this.streamingMessage);
      this.chatPanel.agentInterface.requestUpdate();
    }
    this.requestUpdate();
  }

  private updateUI() {
    this.sessionTodo = this.extractSessionTodo(this.messages);
    if (this.chatPanel?.agentInterface) {
      this.chatPanel.agentInterface.messages = this.messages;
      this.chatPanel.agentInterface.isStreaming = this.isStreaming;
      this.chatPanel.agentInterface.setStreamingMessage(null, true);
      this.chatPanel.agentInterface.sessionTodo = this.sessionTodo;
      this.chatPanel.agentInterface.requestUpdate();
    }
    this.requestUpdate();
  }

  private extractSessionTodo(messages: BackendMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (let j = msg.content.length - 1; j >= 0; j--) {
          const block = msg.content[j] as any;
          if (block.type === "toolCall" && block.name === "todo__todo_write") {
            const args = block.arguments as Record<string, unknown> | undefined;
            if (args?.content && typeof args.content === "string") {
              return args.content;
            }
          }
        }
      }
    }
    return "";
  }

  private async loadSessionById(threadId: string) {
    const wsManager = WsManager.getExistingInstance(
      this.sessionId,
      this.sessionToken,
    );
    if (!wsManager) {
      console.error("[replay] WsManager not found - cannot load session");
      return;
    }

    console.log(`[replay] Loading session ${threadId} via persistent WsManager`);

    const replayedMessages: BackendMessage[] = [];
    let currentAssistant: BackendAssistantMessage | null = null;
    let currentText = "";
    let currentThinking = "";
    let pendingToolCallId: string | null = null;
    let replayComplete = false;

    const originalOnMessage = (wsManager as any).onMessage;

    (wsManager as any).onMessage = (frame: any) => {
      if (replayComplete) {
        if (originalOnMessage) originalOnMessage(frame);
        return;
      }

      try {
        switch (frame.type) {
          case "user_text": {
            if (currentAssistant) {
              if (currentText) {
                currentAssistant.content.push({ type: "text", text: currentText });
                currentText = "";
              }
              if (currentThinking) {
                (currentAssistant.content as any[]).push({ type: "thinking", thinking: currentThinking });
                currentThinking = "";
              }
              replayedMessages.push(currentAssistant);
              currentAssistant = null;
            }

            replayedMessages.push({
              role: "user",
              content: (frame.text as string) || "",
              timestamp: Date.now(),
            });
            break;
          }

          case "assistant_text": {
            if (!currentAssistant) {
              currentAssistant = {
                role: "assistant",
                content: [],
                timestamp: Date.now(),
              };
            }
            if (currentThinking) {
              (currentAssistant.content as any[]).push({
                type: "thinking",
                thinking: currentThinking,
              });
              currentThinking = "";
            }
            currentText += (frame.text as string) || "";
            break;
          }

          case "thinking": {
            if (!currentAssistant) {
              currentAssistant = {
                role: "assistant",
                content: [],
                timestamp: Date.now(),
              };
            }
            if (currentText) {
              currentAssistant.content.push({ type: "text", text: currentText });
              currentText = "";
            }
            currentThinking += (frame.thinking as string) || "";
            break;
          }

          case "tool_start": {
            if (!currentAssistant) {
              currentAssistant = {
                role: "assistant",
                content: [],
                timestamp: Date.now(),
              };
            }
            if (currentText) {
              currentAssistant.content.push({ type: "text", text: currentText });
              currentText = "";
            }
            if (currentThinking) {
              (currentAssistant.content as any[]).push({ type: "thinking", thinking: currentThinking });
              currentThinking = "";
            }

            const name = (frame.name as string) || "unknown";
            const argsStr = (frame.input as string) || "{}";
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(argsStr);
            } catch {
              args = { input: argsStr };
            }

            const toolCall: BackendToolCallBlock = {
              type: "toolCall",
              id: crypto.randomUUID(),
              name,
              arguments: args,
            };

            currentAssistant.content.push(toolCall);
            pendingToolCallId = toolCall.id;
            break;
          }

          case "tool_end": {
            if (pendingToolCallId) {
              const toolCall = currentAssistant?.content.find(
                (c) => c.type === "toolCall" && c.id === pendingToolCallId,
              ) as BackendToolCallBlock | undefined;
              if (toolCall) {
                toolCall.resultStatus = frame.status;
                toolCall.resultExitCode = frame.exit_code;
                toolCall.resultStdout = frame.stdout;
                toolCall.resultStderr = frame.stderr;
              }
              pendingToolCallId = null;
            }
            break;
          }

          case "load_session_complete": {
            if (currentAssistant) {
              if (currentText) {
                currentAssistant.content.push({ type: "text", text: currentText });
              }
              if (currentThinking) {
                (currentAssistant.content as any[]).push({ type: "thinking", thinking: currentThinking });
              }
              replayedMessages.push(currentAssistant);
              currentAssistant = null;
            }

            const loadedThreadId = (frame.thread_id as string) || "";
            if (loadedThreadId) {
              this.lastLoadedThreadId = loadedThreadId;
              SessionManager.saveLastThreadId(loadedThreadId, this.sessionId);
            }

            console.log(
              `[replay] Session replay complete — ${replayedMessages.length} messages restored`,
            );

            this.messages = replayedMessages;
            this.showLanding = false;

            if (replayedMessages.length > 0 && !this.currentTitle) {
              const firstUser = replayedMessages.find((m) => m.role === "user");
              if (firstUser) {
                this.currentTitle = this.generateTitleFromText(
                  typeof firstUser.content === "string" ? firstUser.content : "",
                );
              }
            }

            this.updateUI();

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
              // Check if it's a JWT expiry or session expiry
              const auth = SessionManager.loadAuth();
              if (auth && SessionManager.isTokenValid(auth.token)) {
                // JWT is valid, session expired - try to refresh
                this.handleSessionRefresh();
              } else {
                // JWT expired - force re-login
                this.dispatchSessionExpired();
              }
            }
            replayComplete = true;
            (wsManager as any).onMessage = originalOnMessage;
            break;
          }

          default:
            if (originalOnMessage) originalOnMessage(frame);
            break;
        }
      } catch (err) {
        console.error("[replay] Error processing frame:", err);
      }
    };

    const sent = wsManager.send({
      type: "load_session",
      thread_id: threadId,
    });

    if (!sent) {
      console.error("[replay] Failed to send load_session - WS not open");
      (wsManager as any).onMessage = originalOnMessage;
      return;
    }

    setTimeout(() => {
      if (!replayComplete) {
        console.warn("[replay] Load timeout - restoring original handler");
        if (currentAssistant) {
          if (currentText) currentAssistant.content.push({ type: "text", text: currentText });
          if (currentThinking) (currentAssistant.content as any[]).push({ type: "thinking", thinking: currentThinking });
          replayedMessages.push(currentAssistant);
        }
        this.messages = replayedMessages;
        this.showLanding = false;
        this.updateUI();
        replayComplete = true;
        (wsManager as any).onMessage = originalOnMessage;
      }
    }, 15000);
  }

  private async loadMostRecentSession() {
    if (!this.sessionId) return;

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

  private generateTitleFromText(text: string): string {
    text = text.trim();
    if (!text) return "";

    const sentenceEnd = text.search(/[.!?]/);
    if (sentenceEnd > 0 && sentenceEnd <= 50) {
      return text.substring(0, sentenceEnd + 1);
    }
    return text.length <= 50 ? text : `${text.substring(0, 47)}...`;
  }

  private async openMenu() {
    console.log("[chat-page] Opening menu dialog");

    const filesTab = new FilesTab();
    filesTab.sessionId = this.sessionId;
    filesTab.sessionToken = this.sessionToken;
    filesTab.studentToken = this.auth.token;
    filesTab.subjectIds = this.auth.subject_ids;
    filesTab.onPreviewFile = (node: any, isSubject: boolean, subjectId?: string) => {
      this.handleFilePreview(node, isSubject, subjectId);
    };

    const sessionsTab = new SessionsTab();
    sessionsTab.sessionId = this.sessionId;
    sessionsTab.sessionToken = this.sessionToken;
    sessionsTab.onLoadSession = (sessionId: string) => this.loadSessionById(sessionId);
    sessionsTab.onNewSession = () => this.newSession();

    const accountTab = new AccountTab();
    accountTab.sessionId = this.sessionId;
    accountTab.sessionToken = this.sessionToken;
    accountTab.studentToken = this.auth.token;
    accountTab.auth = this.auth;
    accountTab.onLogout = () => this.handleLogout();
    accountTab.onProfileUpdate = (updatedAuth: LoginResponse) => {
      this.auth = updatedAuth;
      SessionManager.saveAuth(updatedAuth);
    };

    MenuDialog.open([filesTab, sessionsTab, accountTab], undefined, 0, this.tokenBalance);
  }

  private openMenuWithAccount() {
    const filesTab = new FilesTab();
    filesTab.sessionId = this.sessionId;
    filesTab.sessionToken = this.sessionToken;
    filesTab.studentToken = this.auth.token;
    filesTab.subjectIds = this.auth.subject_ids;
    filesTab.onPreviewFile = (node: any, isSubject: boolean, subjectId?: string) => {
      this.handleFilePreview(node, isSubject, subjectId);
    };

    const sessionsTab = new SessionsTab();
    sessionsTab.sessionId = this.sessionId;
    sessionsTab.sessionToken = this.sessionToken;
    sessionsTab.onLoadSession = (sessionId: string) => this.loadSessionById(sessionId);
    sessionsTab.onNewSession = () => this.newSession();

    const accountTab = new AccountTab();
    accountTab.sessionId = this.sessionId;
    accountTab.sessionToken = this.sessionToken;
    accountTab.studentToken = this.auth.token;
    accountTab.auth = this.auth;
    accountTab.onLogout = () => this.handleLogout();
    accountTab.onProfileUpdate = (updatedAuth: LoginResponse) => {
      this.auth = updatedAuth;
      SessionManager.saveAuth(updatedAuth);
    };

    MenuDialog.open([filesTab, sessionsTab, accountTab], undefined, 2, this.tokenBalance);
  }

  private async loadBalance() {
    try {
      const profile = await eduApi.getMe(this.auth.token);
      this.tokenBalance = profile.token_balance;
    } catch {
      // non-fatal
    }
  }

  private async newSession() {
    try {
      const { thread_id } = await eduApi.createThread(this.sessionId, this.sessionToken);
      console.log("[chat-page] New thread created:", thread_id);

      this.messages = [];
      this.currentTitle = "";
      this.lastLoadedThreadId = thread_id;
      this.showLanding = false;
      this.isStreaming = false;
      this.streamingMessage = null;

      this.updateUI();
      this.requestUpdate();
    } catch (err) {
      console.error("[chat-page] Failed to create new thread:", err);
    }
  }

  private handleLogout() {
    SessionManager.clearAuth();
    this.dispatchEvent(
      new CustomEvent("logout", { bubbles: true, composed: true }),
    );
  }

  private handleFilePreview(node: any, isSubject: boolean, subjectId?: string) {
    console.log("[chat-page] Preview file:", node.name);
    this.currentPreviewFile = { node, isSubject, subjectId };
    this.previewModalOpen = true;
    this.requestUpdate();
  }

  private handleFileAttach(node: any, isSubject: boolean, subjectId?: string) {
    console.log("[chat-page] Attach file:", node.name, "isSubject:", isSubject);

    let filePathTag: string;
    if (isSubject && subjectId) {
      filePathTag = `[Subject: ${subjectId}/${node.path}]`;
    } else {
      filePathTag = `[Workspace: ${node.path}]`;
    }

    if (this.chatPanel?.agentInterface) {
      const messageEditor = (this.chatPanel.agentInterface as any)._messageEditor;
      if (messageEditor) {
        const currentValue = messageEditor.value || '';
        const newValue = currentValue ? `${currentValue}\n${filePathTag}` : filePathTag;
        messageEditor.value = newValue;

        requestAnimationFrame(() => {
          const textarea = messageEditor.shadowRoot?.querySelector('textarea') ||
                          messageEditor.querySelector('textarea');
          if (textarea) {
            textarea.focus();
          }
        });

        console.log("[chat-page] File path added to input:", filePathTag);
      }
    }
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
                          }
                          this.isEditingTitle = false;
                          this.requestUpdate();
                        },
                        onKeyDown: async (e: KeyboardEvent) => {
                          if (e.key === "Enter") {
                            const newTitle = (e.target as HTMLInputElement).value.trim();
                            if (newTitle && newTitle !== this.currentTitle) {
                              this.currentTitle = newTitle;
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
            <matrix-toggle></matrix-toggle>
            <theme-toggle></theme-toggle>
          </div>
        </div>

        <!-- Chat Area -->
        <div class="flex-1 flex flex-col min-h-0 relative">
          ${this.showLanding && this._ready
            ? html`<landing-banner
                .onNewChat=${() => this.newSession()}
                .onContinueRecent=${() => this.loadMostRecentSession()}
                .onCheckBalance=${() => this.openMenuWithAccount()}
              ></landing-banner>`
            : ''}
          <div class="flex-1 min-h-0 chat-container" style="${this.showLanding && this._ready ? 'display:none' : ''}"></div>

          ${!this.showLanding && this._ready
            ? html`
              <file-drawer-toggle
                .drawerOpen=${this.fileDrawerOpen}
                .onClick=${() => {
                  this.fileDrawerOpen = !this.fileDrawerOpen;
                  this.requestUpdate();
                }}
              ></file-drawer-toggle>
            `
            : ''}

          <file-drawer
            .open=${this.fileDrawerOpen}
            .sessionId=${this.sessionId}
            .sessionToken=${this.sessionToken}
            .studentToken=${this.auth.token}
            .subjectIds=${this.auth.subject_ids || []}
            .onClose=${() => {
              this.fileDrawerOpen = false;
              this.requestUpdate();
            }}
            .onPreviewFile=${(node: any, isSubject: boolean, subjectId?: string) =>
              this.handleFilePreview(node, isSubject, subjectId)}
            .onAttachFile=${(node: any, isSubject: boolean, subjectId?: string) =>
              this.handleFileAttach(node, isSubject, subjectId)}
          ></file-drawer>

          <file-preview-modal
            .open=${this.previewModalOpen}
            .fileNode=${this.currentPreviewFile?.node}
            .isSubject=${this.currentPreviewFile?.isSubject || false}
            .subjectId=${this.currentPreviewFile?.subjectId}
            .sessionId=${this.sessionId}
            .sessionToken=${this.sessionToken}
            .studentToken=${this.auth.token}
            .onClose=${() => {
              this.previewModalOpen = false;
              this.requestUpdate();
            }}
            .onAttach=${(node: any, isSubject: boolean, subjectId?: string) => {
              this.handleFileAttach(node, isSubject, subjectId);
              this.previewModalOpen = false;
              this.requestUpdate();
            }}
          ></file-preview-modal>
        </div>
      </div>
    `;
  }
}
