var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createWsStreamFn } from "../core/ws-stream-fn.js";
import { eduApi } from "../core/edu-api.js";
import { SessionManager } from "../core/session-manager.js";
import { WsManager } from "../core/ws-manager.js";
import "../ChatPanel.js";
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
let ChatPage = class ChatPage extends LitElement {
    constructor() {
        super(...arguments);
        this._ready = false;
        this._error = "";
        this.currentTitle = "";
        this.isEditingTitle = false;
        this.showLanding = true;
        this.tokenBalance = 0;
        this.fileDrawerOpen = false;
        this.previewModalOpen = false;
        this.messages = [];
        this.isStreaming = false;
        this.streamingMessage = null;
        this.lastLoadedThreadId = null;
        this.activeModelName = "grok-4-1-fast-reasoning";
    }
    isAuthError(err) {
        if (err?.status === 401 || err?.status === 403)
            return true;
        if (err?.message?.includes("Unauthorized") || err?.message?.includes("unauthorized"))
            return true;
        if (err?.response?.status === 401 || err?.response?.status === 403)
            return true;
        return false;
    }
    dispatchSessionExpired() {
        console.log("Session expired - dispatching session-expired event");
        this.dispatchEvent(new CustomEvent("session-expired", {
            bubbles: true,
            composed: true,
        }));
    }
    createRenderRoot() {
        return this;
    }
    async firstUpdated() {
        try {
            await this.initChat();
            this._ready = true;
            this.loadBalance();
            await this.updateComplete;
            this.appendChatPanel();
            if (this.chatPanel?.agentInterface) {
                this.chatPanel.agentInterface.messages = this.messages;
                this.chatPanel.agentInterface.currentModel = {
                    id: this.activeModelName,
                    name: this.activeModelName,
                    provider: "unknown",
                    reasoning: true,
                };
                this.chatPanel.agentInterface.thinkingLevel = "off";
                this.chatPanel.agentInterface.requestUpdate();
            }
            const wsManager = WsManager.getExistingInstance(this.sessionId, this.sessionToken);
            if (wsManager) {
                console.log("[chat-page] Waiting for WebSocket connection...");
                const connected = await wsManager.waitForConnection(10000);
                if (connected) {
                    console.log("[chat-page] WebSocket connected - loading recent session");
                    this.loadMostRecentSession();
                }
                else {
                    console.error("[chat-page] WebSocket connection timeout - cannot load session");
                }
            }
        }
        catch (err) {
            if (this.isAuthError(err)) {
                console.warn("Authentication error detected during initialization", err);
                this.dispatchSessionExpired();
                return;
            }
            this._error =
                err instanceof Error ? err.message : "Failed to initialize chat";
        }
    }
    updated(changedProperties) {
        if (changedProperties.has("_ready") &&
            this._ready &&
            this.chatPanel?.parentElement === null) {
            this.appendChatPanel();
        }
    }
    appendChatPanel() {
        const container = this.querySelector(".chat-container");
        if (container && this.chatPanel && this.chatPanel.parentElement === null) {
            container.appendChild(this.chatPanel);
        }
    }
    async initChat() {
        this.activeModelName = "grok-4-1-fast-reasoning";
        try {
            const sessionModels = await eduApi.getSessionModels(this.sessionId, this.auth.token);
            this.activeModelName = sessionModels.active || this.activeModelName;
        }
        catch (err) {
            if (this.isAuthError(err))
                throw err;
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
                if (error.message.includes("Session expired") ||
                    error.message.includes("authentication failed")) {
                    console.warn("[chat-page] Session/auth expired - dispatching event");
                    this.dispatchSessionExpired();
                }
            },
            onMessage: () => { },
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
        this.chatPanel = document.createElement("pi-chat-panel");
        this.chatPanel.init({
            onSend: (text) => this.handleSend(text),
            onCancel: () => this.handleCancel(),
            onModelSelect: async () => {
                const { ModelSelector } = await import("../dialogs/ModelSelector.js");
                ModelSelector.open(this.activeModelName, async (newModelId) => {
                    try {
                        await eduApi.setSessionModel(this.sessionId, this.auth.token, newModelId);
                    }
                    catch (err) {
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
    handleReconnection() {
        const lastThreadId = SessionManager.loadLastThreadId(this.sessionId);
        if (lastThreadId) {
            console.log(`[chat-page] Reloading last session ${lastThreadId} after reconnection`);
            this.loadSessionById(lastThreadId);
        }
        else {
            console.log("[chat-page] No previous session to reload - starting fresh after reconnection");
        }
    }
    async handleSend(text) {
        if (!this.wsStreamFn || this.isStreaming)
            return;
        const userMsg = {
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
        const callbacks = {
            onTextStart: () => {
                this.streamingMessage = {
                    role: "assistant",
                    content: [],
                    timestamp: Date.now(),
                };
                this.updateStreaming();
            },
            onTextDelta: (delta) => {
                if (!this.streamingMessage)
                    return;
                const lastBlock = this.streamingMessage.content[this.streamingMessage.content.length - 1];
                if (lastBlock && lastBlock.type === "text") {
                    lastBlock.text += delta;
                }
                else {
                    this.streamingMessage.content.push({ type: "text", text: delta });
                }
                this.updateStreaming();
            },
            onTextEnd: () => {
                this.updateStreaming();
            },
            onThinkingStart: () => {
                if (!this.streamingMessage)
                    return;
                this.streamingMessage.content.push({
                    type: "thinking",
                    thinking: "",
                });
                this.updateStreaming();
            },
            onThinkingDelta: (delta) => {
                if (!this.streamingMessage)
                    return;
                const lastBlock = this.streamingMessage.content[this.streamingMessage.content.length - 1];
                if (lastBlock && lastBlock.type === "thinking") {
                    lastBlock.thinking += delta;
                }
                this.updateStreaming();
            },
            onThinkingEnd: () => {
                this.updateStreaming();
            },
            onToolCallStart: (toolCall) => {
                if (!this.streamingMessage)
                    return;
                this.streamingMessage.content.push(toolCall);
                this.updateStreaming();
            },
            onToolCallEnd: (toolCall) => {
                this.updateStreaming();
            },
            onDone: (msg) => {
                this.messages = [...this.messages, msg];
                this.isStreaming = false;
                this.streamingMessage = null;
                this.updateUI();
            },
            onError: (error) => {
                console.error("[chat-page] Stream error:", error);
                this.isStreaming = false;
                this.streamingMessage = null;
                this.updateUI();
            },
        };
        this.wsStreamFn(text, callbacks);
        this.updateUI();
    }
    handleCancel() {
        const wsManager = WsManager.getExistingInstance(this.sessionId, this.sessionToken);
        if (wsManager) {
            wsManager.send({ type: "cancel" });
        }
        this.isStreaming = false;
        this.streamingMessage = null;
        this.updateUI();
    }
    updateStreaming() {
        if (this.chatPanel?.agentInterface) {
            this.chatPanel.agentInterface.isStreaming = this.isStreaming;
            this.chatPanel.agentInterface.setStreamingMessage(this.streamingMessage);
            this.chatPanel.agentInterface.requestUpdate();
        }
        this.requestUpdate();
    }
    updateUI() {
        if (this.chatPanel?.agentInterface) {
            this.chatPanel.agentInterface.messages = this.messages;
            this.chatPanel.agentInterface.isStreaming = this.isStreaming;
            this.chatPanel.agentInterface.setStreamingMessage(null, true);
            this.chatPanel.agentInterface.requestUpdate();
        }
        this.requestUpdate();
    }
    async loadSessionById(threadId) {
        const wsManager = WsManager.getExistingInstance(this.sessionId, this.sessionToken);
        if (!wsManager) {
            console.error("[replay] WsManager not found - cannot load session");
            return;
        }
        console.log(`[replay] Loading session ${threadId} via persistent WsManager`);
        const replayedMessages = [];
        let currentAssistant = null;
        let currentText = "";
        let currentThinking = "";
        let pendingToolCallId = null;
        let replayComplete = false;
        const originalOnMessage = wsManager.onMessage;
        wsManager.onMessage = (frame) => {
            if (replayComplete) {
                if (originalOnMessage)
                    originalOnMessage(frame);
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
                                currentAssistant.content.push({ type: "thinking", thinking: currentThinking });
                                currentThinking = "";
                            }
                            replayedMessages.push(currentAssistant);
                            currentAssistant = null;
                        }
                        replayedMessages.push({
                            role: "user",
                            content: frame.text || "",
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
                        currentText += frame.text || "";
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
                        currentThinking += frame.thinking || "";
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
                            currentAssistant.content.push({ type: "thinking", thinking: currentThinking });
                            currentThinking = "";
                        }
                        const name = frame.name || "unknown";
                        const argsStr = frame.input || "{}";
                        let args = {};
                        try {
                            args = JSON.parse(argsStr);
                        }
                        catch {
                            args = { input: argsStr };
                        }
                        const toolCall = {
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
                            const toolCall = currentAssistant?.content.find((c) => c.type === "toolCall" && c.id === pendingToolCallId);
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
                                currentAssistant.content.push({ type: "thinking", thinking: currentThinking });
                            }
                            replayedMessages.push(currentAssistant);
                            currentAssistant = null;
                        }
                        const loadedThreadId = frame.thread_id || "";
                        if (loadedThreadId) {
                            this.lastLoadedThreadId = loadedThreadId;
                            SessionManager.saveLastThreadId(loadedThreadId, this.sessionId);
                        }
                        console.log(`[replay] Session replay complete — ${replayedMessages.length} messages restored`);
                        this.messages = replayedMessages;
                        this.showLanding = false;
                        if (replayedMessages.length > 0 && !this.currentTitle) {
                            const firstUser = replayedMessages.find((m) => m.role === "user");
                            if (firstUser) {
                                this.currentTitle = this.generateTitleFromText(typeof firstUser.content === "string" ? firstUser.content : "");
                            }
                        }
                        this.updateUI();
                        replayComplete = true;
                        wsManager.onMessage = originalOnMessage;
                        console.log("[replay] Restored original WsManager onMessage handler");
                        break;
                    }
                    case "error": {
                        const errorMsg = frame.message || "Unknown error";
                        console.error("[replay] Session replay error:", errorMsg);
                        if (errorMsg.includes("Unauthorized") ||
                            errorMsg.includes("unauthorized") ||
                            errorMsg.includes("401") ||
                            errorMsg.includes("403")) {
                            this.dispatchSessionExpired();
                        }
                        replayComplete = true;
                        wsManager.onMessage = originalOnMessage;
                        break;
                    }
                    default:
                        if (originalOnMessage)
                            originalOnMessage(frame);
                        break;
                }
            }
            catch (err) {
                console.error("[replay] Error processing frame:", err);
            }
        };
        const sent = wsManager.send({
            type: "load_session",
            thread_id: threadId,
        });
        if (!sent) {
            console.error("[replay] Failed to send load_session - WS not open");
            wsManager.onMessage = originalOnMessage;
            return;
        }
        setTimeout(() => {
            if (!replayComplete) {
                console.warn("[replay] Load timeout - restoring original handler");
                if (currentAssistant) {
                    if (currentText)
                        currentAssistant.content.push({ type: "text", text: currentText });
                    if (currentThinking)
                        currentAssistant.content.push({ type: "thinking", thinking: currentThinking });
                    replayedMessages.push(currentAssistant);
                }
                this.messages = replayedMessages;
                this.showLanding = false;
                this.updateUI();
                replayComplete = true;
                wsManager.onMessage = originalOnMessage;
            }
        }, 15000);
    }
    async loadMostRecentSession() {
        if (!this.sessionId)
            return;
        console.log("[replay] Listing threads via REST");
        try {
            const sessions = await eduApi.listThreads(this.sessionId, this.sessionToken);
            const withMessages = sessions.filter((s) => {
                const count = s.metadata?.messageCount ?? 0;
                return count > 0;
            });
            if (withMessages.length > 0) {
                const latest = withMessages[0];
                console.log(`[replay] Loading most recent session: ${latest.id} (${latest.metadata?.messageCount ?? "?"} messages)`);
                this.loadSessionById(latest.id);
            }
            else {
                console.log("[replay] No existing sessions with messages — starting fresh");
            }
        }
        catch (err) {
            console.error("[replay] Failed to list threads:", err);
        }
    }
    generateTitleFromText(text) {
        text = text.trim();
        if (!text)
            return "";
        const sentenceEnd = text.search(/[.!?]/);
        if (sentenceEnd > 0 && sentenceEnd <= 50) {
            return text.substring(0, sentenceEnd + 1);
        }
        return text.length <= 50 ? text : `${text.substring(0, 47)}...`;
    }
    async openMenu() {
        console.log("[chat-page] Opening menu dialog");
        const filesTab = new FilesTab();
        filesTab.sessionId = this.sessionId;
        filesTab.sessionToken = this.sessionToken;
        filesTab.studentToken = this.auth.token;
        filesTab.subjectIds = this.auth.subject_ids;
        filesTab.onPreviewFile = (node, isSubject, subjectId) => {
            this.handleFilePreview(node, isSubject, subjectId);
        };
        const sessionsTab = new SessionsTab();
        sessionsTab.sessionId = this.sessionId;
        sessionsTab.sessionToken = this.sessionToken;
        sessionsTab.onLoadSession = (sessionId) => this.loadSessionById(sessionId);
        sessionsTab.onNewSession = () => this.newSession();
        const accountTab = new AccountTab();
        accountTab.sessionId = this.sessionId;
        accountTab.sessionToken = this.sessionToken;
        accountTab.studentToken = this.auth.token;
        accountTab.auth = this.auth;
        accountTab.onLogout = () => this.handleLogout();
        accountTab.onProfileUpdate = (updatedAuth) => {
            this.auth = updatedAuth;
            SessionManager.saveAuth(updatedAuth);
        };
        MenuDialog.open([filesTab, sessionsTab, accountTab], undefined, 0, this.tokenBalance);
    }
    openMenuWithAccount() {
        const filesTab = new FilesTab();
        filesTab.sessionId = this.sessionId;
        filesTab.sessionToken = this.sessionToken;
        filesTab.studentToken = this.auth.token;
        filesTab.subjectIds = this.auth.subject_ids;
        filesTab.onPreviewFile = (node, isSubject, subjectId) => {
            this.handleFilePreview(node, isSubject, subjectId);
        };
        const sessionsTab = new SessionsTab();
        sessionsTab.sessionId = this.sessionId;
        sessionsTab.sessionToken = this.sessionToken;
        sessionsTab.onLoadSession = (sessionId) => this.loadSessionById(sessionId);
        sessionsTab.onNewSession = () => this.newSession();
        const accountTab = new AccountTab();
        accountTab.sessionId = this.sessionId;
        accountTab.sessionToken = this.sessionToken;
        accountTab.studentToken = this.auth.token;
        accountTab.auth = this.auth;
        accountTab.onLogout = () => this.handleLogout();
        accountTab.onProfileUpdate = (updatedAuth) => {
            this.auth = updatedAuth;
            SessionManager.saveAuth(updatedAuth);
        };
        MenuDialog.open([filesTab, sessionsTab, accountTab], undefined, 2, this.tokenBalance);
    }
    async loadBalance() {
        try {
            const profile = await eduApi.getMe(this.auth.token);
            this.tokenBalance = profile.token_balance;
        }
        catch {
            // non-fatal
        }
    }
    async newSession() {
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
        }
        catch (err) {
            console.error("[chat-page] Failed to create new thread:", err);
        }
    }
    handleLogout() {
        SessionManager.clearAuth();
        this.dispatchEvent(new CustomEvent("logout", { bubbles: true, composed: true }));
    }
    handleFilePreview(node, isSubject, subjectId) {
        console.log("[chat-page] Preview file:", node.name);
        this.currentPreviewFile = { node, isSubject, subjectId };
        this.previewModalOpen = true;
        this.requestUpdate();
    }
    handleFileAttach(node, isSubject, subjectId) {
        console.log("[chat-page] Attach file:", node.name, "isSubject:", isSubject);
        let filePathTag;
        if (isSubject && subjectId) {
            filePathTag = `[Subject: ${subjectId}/${node.path}]`;
        }
        else {
            filePathTag = `[Workspace: ${node.path}]`;
        }
        if (this.chatPanel?.agentInterface) {
            const messageEditor = this.chatPanel.agentInterface._messageEditor;
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
            return html `
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
        return html `
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

            ${this.currentTitle
            ? this.isEditingTitle
                ? html `<div class="flex items-center gap-2">
                      ${Input({
                    type: "text",
                    value: this.currentTitle,
                    className: "text-sm w-64",
                    onChange: async (e) => {
                        const newTitle = e.target.value.trim();
                        if (newTitle && newTitle !== this.currentTitle) {
                            this.currentTitle = newTitle;
                        }
                        this.isEditingTitle = false;
                        this.requestUpdate();
                    },
                    onKeyDown: async (e) => {
                        if (e.key === "Enter") {
                            const newTitle = e.target.value.trim();
                            if (newTitle && newTitle !== this.currentTitle) {
                                this.currentTitle = newTitle;
                            }
                            this.isEditingTitle = false;
                            this.requestUpdate();
                        }
                        else if (e.key === "Escape") {
                            this.isEditingTitle = false;
                            this.requestUpdate();
                        }
                    },
                })}
                    </div>`
                : html `<button
                      class="px-2 py-1 text-sm text-foreground hover:bg-secondary rounded transition-colors"
                      @click=${() => {
                    this.isEditingTitle = true;
                    this.requestUpdate();
                    requestAnimationFrame(() => {
                        const input = this.querySelector('input[type="text"]');
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
            : html `<span class="text-base font-semibold text-foreground">EduCraw Chat</span>`}
          </div>
          <div class="flex items-center gap-1 px-2">
            <matrix-toggle></matrix-toggle>
            <theme-toggle></theme-toggle>
          </div>
        </div>

        <!-- Chat Area -->
        <div class="flex-1 flex flex-col min-h-0 relative">
          ${this.showLanding && this._ready
            ? html `<landing-banner
                .onNewChat=${() => this.newSession()}
                .onContinueRecent=${() => this.loadMostRecentSession()}
                .onCheckBalance=${() => this.openMenuWithAccount()}
              ></landing-banner>`
            : ''}
          <div class="flex-1 min-h-0 chat-container" style="${this.showLanding && this._ready ? 'display:none' : ''}"></div>

          ${!this.showLanding && this._ready
            ? html `
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
            .onPreviewFile=${(node, isSubject, subjectId) => this.handleFilePreview(node, isSubject, subjectId)}
            .onAttachFile=${(node, isSubject, subjectId) => this.handleFileAttach(node, isSubject, subjectId)}
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
            .onAttach=${(node, isSubject, subjectId) => {
            this.handleFileAttach(node, isSubject, subjectId);
            this.previewModalOpen = false;
            this.requestUpdate();
        }}
          ></file-preview-modal>
        </div>
      </div>
    `;
    }
};
__decorate([
    property({ attribute: false })
], ChatPage.prototype, "auth", void 0);
__decorate([
    property({ attribute: false })
], ChatPage.prototype, "sessionId", void 0);
__decorate([
    property({ attribute: false })
], ChatPage.prototype, "sessionToken", void 0);
__decorate([
    state()
], ChatPage.prototype, "_ready", void 0);
__decorate([
    state()
], ChatPage.prototype, "_error", void 0);
__decorate([
    state()
], ChatPage.prototype, "currentTitle", void 0);
__decorate([
    state()
], ChatPage.prototype, "isEditingTitle", void 0);
__decorate([
    state()
], ChatPage.prototype, "showLanding", void 0);
__decorate([
    state()
], ChatPage.prototype, "tokenBalance", void 0);
__decorate([
    state()
], ChatPage.prototype, "fileDrawerOpen", void 0);
__decorate([
    state()
], ChatPage.prototype, "previewModalOpen", void 0);
__decorate([
    state()
], ChatPage.prototype, "messages", void 0);
__decorate([
    state()
], ChatPage.prototype, "isStreaming", void 0);
__decorate([
    state()
], ChatPage.prototype, "streamingMessage", void 0);
ChatPage = __decorate([
    customElement("chat-page")
], ChatPage);
export { ChatPage };
