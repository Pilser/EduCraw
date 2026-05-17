var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Agent } from "@earendil-works/pi-agent-core";
import { createWsStreamFn } from "../core/ws-stream-fn";
import { eduModelToPiModel } from "../core/edu-model-provider";
import { eduApi } from "../core/edu-api";
import { SessionManager } from "../core/session-manager";
import { WsManager } from "../core/ws-manager";
import { defaultConvertToLlm } from "../components/Messages.js";
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
        this.lastLoadedThreadId = null; // Track loaded session
    }
    /**
     * Helper: Detect if an error is auth-related (401/403)
     */
    isAuthError(err) {
        // Check for HTTP error status codes
        if (err?.status === 401 || err?.status === 403) {
            return true;
        }
        // Check for "Unauthorized" in error message
        if (err?.message?.includes("Unauthorized") ||
            err?.message?.includes("unauthorized")) {
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
            // Wait for re-render so .chat-container exists in DOM, then append
            await this.updateComplete;
            this.appendChatPanel();
            // IMPORTANT: Wait for WsManager to connect before loading session
            const wsManager = WsManager.getExistingInstance(this.sessionId, this.sessionToken);
            if (wsManager) {
                console.log("[chat-page] Waiting for WebSocket connection...");
                const connected = await wsManager.waitForConnection(10000);
                if (connected) {
                    console.log("[chat-page] WebSocket connected - loading recent session");
                    // After chat is visible and WS is connected, try to load the most recent session
                    this.loadMostRecentSession();
                }
                else {
                    console.error("[chat-page] WebSocket connection timeout - cannot load session");
                }
            }
        }
        catch (err) {
            // Check if this is an authentication error (session expired)
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
        // Fetch models to get the active model
        let model;
        try {
            const sessionModels = await eduApi.getSessionModels(this.sessionId, this.auth.token);
            // Backend returns 'active' as the model NAME (not id)
            // Priority: student.last_model → session.model → "grok-4-1-fast-reasoning"
            const activeModel = sessionModels.models.find((m) => m.name === sessionModels.active);
            if (activeModel) {
                model = eduModelToPiModel(activeModel);
            }
            else if (sessionModels.models.length > 0) {
                // Fallback to first available model if active not found
                console.warn("[chat-page] Active model not found in list, using first available");
                model = eduModelToPiModel(sessionModels.models[0]);
            }
        }
        catch (err) {
            // Check if this is an authentication error (session expired)
            if (this.isAuthError(err)) {
                console.warn("Authentication error while fetching session models", err);
                throw err; // Re-throw to be caught by firstUpdated
            }
            // Will use default model for other errors
            console.error("Failed to fetch session models:", err);
        }
        // Ensure we always have a model (fallback to default)
        if (!model) {
            console.warn("No model found, using default grok-4-1-fast-reasoning");
            model = {
                id: "grok-4-1-fast-reasoning",
                name: "Grok 4.1 Fast Reasoning",
                api: "unknown",
                provider: "xai",
                baseUrl: "",
                reasoning: true,
                input: ["text"],
                contextWindow: 200000,
                maxTokens: 8192,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            };
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
                if (error.message.includes("Session expired") ||
                    error.message.includes("authentication failed")) {
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
                model: model,
                thinkingLevel: "off",
            },
            streamFn: createWsStreamFn({
                sessionId: this.sessionId,
                authToken: this.sessionToken,
                onStreamStart: () => {
                    if (this.showLanding) {
                        this.showLanding = false;
                        this.requestUpdate();
                    }
                },
            }),
            convertToLlm: defaultConvertToLlm,
            // EduCraw: tools are executed server-side. The agent loop must not
            // try to execute them locally — it would fail (no tools registered)
            // and then re-prompt, causing an infinite re-send loop.
            skipToolExecution: true,
        });
        // Create ChatPanel and set the agent
        this.chatPanel = document.createElement("pi-chat-panel");
        await this.chatPanel.setAgent(this.agent, {
            onModelSelect: async () => {
                const { ModelSelector } = await import("../dialogs/ModelSelector.js");
                ModelSelector.open(this.agent.state.model, async (newModel) => {
                    this.agent.state.model = newModel;
                    // Force UI update to show new model immediately
                    if (this.chatPanel?.agentInterface) {
                        this.chatPanel.agentInterface.requestUpdate();
                    }
                    try {
                        await eduApi.setSessionModel(this.sessionId, this.auth.token, newModel.id);
                    }
                    catch (err) {
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
    handleReconnection() {
        // Try to reload the last loaded session if we have one
        const lastThreadId = SessionManager.loadLastThreadId(this.sessionId);
        if (lastThreadId) {
            console.log(`[chat-page] Reloading last session ${lastThreadId} after reconnection`);
            this.loadSessionById(lastThreadId);
        }
        else {
            console.log("[chat-page] No previous session to reload - starting fresh after reconnection");
        }
    }
    /** Helper: finalize current assistant message and push to array */
    flushAssistant(msgs, assistant) {
        if (assistant && assistant.content.length > 0) {
            msgs.push(assistant);
        }
        return null;
    }
    /** Helper: create a fresh assistant message shell */
    makeAssistantMsg() {
        const m = this.agent.state.model;
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
    async loadSessionById(threadId) {
        if (!this.agent)
            return;
        // Get the persistent WsManager instance (already created by Agent)
        const wsManager = WsManager.getExistingInstance(this.sessionId, this.sessionToken);
        if (!wsManager) {
            console.error("[replay] WsManager not found - cannot load session");
            return;
        }
        console.log(`[replay] Loading session ${threadId} via persistent WsManager`);
        // Replay state
        const replayedMessages = [];
        let currentAssistant = null;
        let currentTextContent = null;
        let currentThinkingContent = null;
        let pendingToolCallId = null;
        let replayComplete = false;
        // Save the original onMessage handler from ws-stream-fn
        const originalOnMessage = wsManager.onMessage;
        // Temporarily override onMessage to intercept replay frames
        wsManager.onMessage = (frame) => {
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
                            currentAssistant = this.flushAssistant(replayedMessages, currentAssistant);
                            currentTextContent = null;
                            currentThinkingContent = null;
                        }
                        const text = frame.text || "";
                        replayedMessages.push({
                            role: "user",
                            content: text,
                            timestamp: Date.now(),
                        });
                        break;
                    }
                    case "assistant_text": {
                        currentThinkingContent = null;
                        const delta = frame.text || "";
                        if (!currentAssistant) {
                            currentAssistant = this.makeAssistantMsg();
                        }
                        if (!currentTextContent) {
                            currentTextContent = { type: "text", text: delta };
                            currentAssistant.content = [
                                ...currentAssistant.content,
                                currentTextContent,
                            ];
                        }
                        else {
                            currentTextContent.text += delta;
                        }
                        break;
                    }
                    case "thinking": {
                        if (!currentAssistant) {
                            currentAssistant = this.makeAssistantMsg();
                        }
                        const thinkText = frame.thinking || "";
                        if (currentThinkingContent === null) {
                            currentThinkingContent = {
                                type: "thinking",
                                thinking: thinkText,
                            };
                            currentAssistant.content = [
                                ...currentAssistant.content,
                                currentThinkingContent,
                            ];
                        }
                        else {
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
                        currentAssistant.content = [...currentAssistant.content, toolCall];
                        pendingToolCallId = toolCall.id;
                        break;
                    }
                    case "tool_end": {
                        if (pendingToolCallId && currentAssistant) {
                            const exitCode = frame.exit_code ?? 0;
                            const stdout = frame.stdout || "";
                            const stderr = frame.stderr || "";
                            const status = frame.status;
                            const resultText = stdout + (stderr ? "\n[stderr]\n" + stderr : "");
                            const toolResult = {
                                role: "toolResult",
                                toolCallId: pendingToolCallId,
                                toolName: "",
                                content: resultText ? [{ type: "text", text: resultText }] : [],
                                isError: status === "failed" || exitCode !== 0,
                                timestamp: Date.now(),
                            };
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
                        const loadedThreadId = frame.thread_id || "";
                        if (loadedThreadId) {
                            this.lastLoadedThreadId = loadedThreadId;
                            SessionManager.saveLastThreadId(loadedThreadId, this.sessionId);
                            console.log(`[replay] Saved thread ID ${loadedThreadId} for reconnection`);
                        }
                        console.log(`[replay] Session replay complete — ${replayedMessages.length} messages restored`);
                        if (this.agent) {
                            this.agent.state.messages = replayedMessages;
                            this.showLanding = false;
                            if (replayedMessages.length > 0 && !this.currentTitle) {
                                this.currentTitle = this.generateTitle(replayedMessages);
                            }
                            const agentInterface = this.querySelector("agent-interface");
                            if (agentInterface) {
                                agentInterface.requestUpdate();
                            }
                            this.chatPanel?.requestUpdate();
                        }
                        // Mark replay as complete and restore original handler
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
                            console.warn("[replay] Authentication error detected in session replay");
                            this.dispatchSessionExpired();
                        }
                        // Restore original handler on error
                        replayComplete = true;
                        wsManager.onMessage = originalOnMessage;
                        break;
                    }
                    default:
                        // Forward other frames to original handler (like binary, chat frames during replay)
                        if (originalOnMessage) {
                            originalOnMessage(frame);
                        }
                        break;
                }
            }
            catch (err) {
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
            wsManager.onMessage = originalOnMessage;
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
                    this.showLanding = false;
                    const agentInterface = this.querySelector("agent-interface");
                    if (agentInterface) {
                        agentInterface.requestUpdate();
                    }
                    this.chatPanel?.requestUpdate();
                }
                replayComplete = true;
                wsManager.onMessage = originalOnMessage;
            }
        }, 15000);
    }
    /**
     * Opens a temporary WebSocket to list sessions, find the most recent
     * one with messages, and load it.
     */
    async loadMostRecentSession() {
        if (!this.agent || !this.sessionId)
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
    // ── Title Generation ──
    generateTitle(messages) {
        const firstUserMsg = messages.find((m) => m.role === "user");
        if (!firstUserMsg)
            return "";
        let text = "";
        const content = firstUserMsg.content;
        if (typeof content === "string") {
            text = content;
        }
        else {
            const textBlocks = content.filter((c) => c.type === "text");
            text = textBlocks.map((c) => c.text || "").join(" ");
        }
        text = text.trim();
        if (!text)
            return "";
        const sentenceEnd = text.search(/[.!?]/);
        if (sentenceEnd > 0 && sentenceEnd <= 50) {
            return text.substring(0, sentenceEnd + 1);
        }
        return text.length <= 50 ? text : `${text.substring(0, 47)}...`;
    }
    shouldSaveSession(messages) {
        const hasUserMsg = messages.some((m) => m.role === "user");
        const hasAssistantMsg = messages.some((m) => m.role === "assistant");
        return hasUserMsg && hasAssistantMsg;
    }
    // ── Session Management UI ──
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
            if (this.agent) {
                this.agent.state.messages = [];
                this.currentTitle = "";
                this.lastLoadedThreadId = thread_id;
                this.showLanding = false;
                const agentInterface = this.querySelector("agent-interface");
                if (agentInterface) {
                    agentInterface.requestUpdate();
                }
                this.chatPanel?.requestUpdate();
                this.requestUpdate();
            }
        }
        catch (err) {
            console.error("[chat-page] Failed to create new thread:", err);
        }
    }
    // ── Logout ──
    handleLogout() {
        SessionManager.clearAuth();
        this.dispatchEvent(new CustomEvent("logout", { bubbles: true, composed: true }));
    }
    // ── File Drawer Handlers ──
    handleFilePreview(node, isSubject, subjectId) {
        console.log("[chat-page] Preview file:", node.name);
        this.currentPreviewFile = { node, isSubject, subjectId };
        this.previewModalOpen = true;
        this.requestUpdate();
    }
    handleFileAttach(node, isSubject, subjectId) {
        console.log("[chat-page] Attach file:", node.name, "isSubject:", isSubject);
        // Build file path tag based on location
        let filePathTag;
        if (isSubject && subjectId) {
            // Subject file: include subject folder in path
            filePathTag = `[Subject: ${subjectId}/${node.path}]`;
        }
        else {
            // Workspace file: user's workspace path
            filePathTag = `[Workspace: ${node.path}]`;
        }
        // Add file reference to the chat input via AgentInterface's MessageEditor
        if (this.chatPanel?.agentInterface) {
            const messageEditor = this.chatPanel.agentInterface._messageEditor;
            if (messageEditor) {
                const currentValue = messageEditor.value || '';
                const newValue = currentValue ? `${currentValue}\n${filePathTag}` : filePathTag;
                messageEditor.value = newValue;
                // Focus the input
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
    formatBytes(bytes) {
        if (bytes < 1024)
            return `${bytes} B`;
        if (bytes < 1024 * 1024)
            return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
                            // TODO: Wire to backend API to update session title
                        }
                        this.isEditingTitle = false;
                        this.requestUpdate();
                    },
                    onKeyDown: async (e) => {
                        if (e.key === "Enter") {
                            const newTitle = e.target.value.trim();
                            if (newTitle && newTitle !== this.currentTitle) {
                                this.currentTitle = newTitle;
                                // TODO: Wire to backend API to update session title
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

          <!-- File Drawer Toggle Button -->
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

          <!-- File Drawer -->
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

          <!-- File Preview Modal -->
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
ChatPage = __decorate([
    customElement("chat-page")
], ChatPage);
export { ChatPage };
