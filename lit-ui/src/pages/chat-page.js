var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { eduApi } from "../core/edu-api.js";
import { SessionManager } from "../core/session-manager.js";
import { handleError, classifyError, isSessionFatal, classifySseFrame, ErrorCode } from "../core/error-handler.js";
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
import { RecipesTab } from "../dialogs/RecipesTab.js";
let ChatPage = class ChatPage extends LitElement {
    constructor() {
        super(...arguments);
        this._ready = false;
        this._error = "";
        this.currentTitle = "";
        this.isEditingTitle = false;
        this.showLanding = true;
        this.sessionTodo = "";
        this.tokenBalance = 0;
        this.fileDrawerOpen = false;
        this.previewModalOpen = false;
        this.recipeBanner = null;
        this.activityPromptPin = null;
        this.messages = [];
        this.isStreaming = false;
        this.streamingMessage = null;
        this.lastLoadedThreadId = null;
        this.lastAppliedRecipePath = null;
        this.lastAppliedActivityGroup = null;
        this.lastAppliedActivityLabel = null;
        this.currentAbort = null;
        this.activeModelId = "grok-4-1-fast-reasoning";
        this.activeModelDisplayName = "grok-4-1-fast-reasoning";
        this._isRefreshing = false;
        this._currentRequestId = null;
        this._onSessionDeadBound = (e) => this.onSessionDead(e);
    }
    createRenderRoot() {
        return this;
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener("session-dead", this._onSessionDeadBound);
    }
    async firstUpdated() {
        window.addEventListener("session-dead", this._onSessionDeadBound);
        await this.ensureValidSession();
        try {
            await this.initChat();
            this._ready = true;
            this.loadBalance();
            await this.updateComplete;
            await this.chatPanel.updateComplete;
            const ai = this.chatPanel.agentInterface;
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
        }
        catch (err) {
            const e = handleError(err);
            if (isSessionFatal(err))
                return;
            this._error = e.message || "Failed to initialize chat";
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
    async ensureValidSession() {
        if (this._isRefreshing)
            return;
        try {
            await eduApi.getSessionModels(this.sessionId, this.auth.token);
        }
        catch (err) {
            const e = classifyError(err);
            if (isSessionFatal(err))
                throw err;
            if (e.code === ErrorCode.SESSION_NOT_FOUND || e.code === ErrorCode.SESSION_NOT_ACTIVE || e.code === ErrorCode.GOOSE_DEAD) {
                if (this._isRefreshing)
                    return;
                console.warn("[chat-page] Session dead during validation, refreshing...");
                const refreshed = await this.handleSessionRefresh();
                if (!refreshed) {
                    throw new Error("Session expired and could not be refreshed");
                }
                return;
            }
            console.warn("[chat-page] Session validation warning:", e.message);
        }
    }
    async initChat() {
        this.activeModelId = "grok-4-1-fast-reasoning";
        this.activeModelDisplayName = "grok-4-1-fast-reasoning";
        // Restore activity context from recipe list (goose persists these on session)
        try {
            const recipes = await eduApi.listRecipes(this.sessionId, this.sessionToken);
            console.log("[chat-page] Recipes loaded on init:", recipes.map(r => ({ title: r.title, applied: r.appliedToCurrentSession, group: r.appliedActivityGroup, pin: r.activityPromptPin })));
            const applied = recipes.find(r => r.appliedToCurrentSession);
            if (applied) {
                if (applied.activityPromptPin) {
                    this.activityPromptPin = applied.activityPromptPin;
                }
                if (applied.appliedActivityGroup) {
                    this.lastAppliedActivityGroup = applied.appliedActivityGroup;
                }
                if (applied.appliedActivityLabel) {
                    this.lastAppliedActivityLabel = applied.appliedActivityLabel;
                }
                if (applied.path) {
                    this.lastAppliedRecipePath = applied.path;
                }
            }
        }
        catch (err) {
            if (isSessionFatal(err))
                throw err;
            // non-fatal — pin just won't show on refresh
        }
        try {
            const sessionModels = await eduApi.getSessionModels(this.sessionId, this.auth.token);
            const activeId = sessionModels.active || this.activeModelId;
            this.activeModelId = activeId;
            const activeModel = sessionModels.models.find((m) => m.name === activeId);
            this.activeModelDisplayName = activeModel?.display_name || activeId;
        }
        catch (err) {
            if (isSessionFatal(err))
                throw err;
            console.error("Failed to fetch session models:", err);
        }
        this.chatPanel = document.createElement("pi-chat-panel");
        this.chatPanel.init({
            onSend: (text) => this.handleSend(text),
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
                        await eduApi.setSessionModel(this.sessionId, this.auth.token, newModelId);
                    }
                    catch (err) {
                        handleError(err);
                        if (isSessionFatal(err))
                            return;
                        console.error("Failed to switch model on server:", err);
                    }
                });
            },
        });
    }
    /** Centralised handler: any API call that detects a dead session fires this. */
    async onSessionDead(e) {
        if (this._isRefreshing)
            return;
        const detail = e.detail;
        console.warn("[chat-page] session-dead event received:", detail?.error);
        this._isRefreshing = true;
        try {
            const refreshed = await this.handleSessionRefresh();
            if (refreshed) {
                console.log("[chat-page] Session recovered via global watcher");
            }
        }
        finally {
            this._isRefreshing = false;
        }
    }
    /** Handle session expiry — create new session IN-PLACE, return it for retry. */
    async handleSessionRefresh() {
        console.log("[chat-page] Attempting to refresh session...");
        try {
            const newSessionId = crypto.randomUUID();
            const session = await eduApi.createSession(this.auth.student_id, this.auth.token, undefined, newSessionId);
            console.log(`[chat-page] Session refreshed: ${session.session_id}`);
            // Update in-place — no @new-session event (avoids losing messages)
            this.sessionId = session.session_id;
            this.sessionToken = session.token;
            this.lastLoadedThreadId = null;
            // Persist (clearSession removes stale thread ref + old session before saving new)
            SessionManager.clearSession();
            SessionManager.saveSession(session.session_id, session.token);
            // Auto-resume the most recent thread from HelixDB
            try {
                const spawnResp = await eduApi.spawnSession(this.sessionId, this.sessionToken, "recent");
                if (spawnResp.thread_id) {
                    console.log("[chat-page] Auto-resuming recent thread after refresh:", spawnResp.thread_id);
                    await this.loadSessionById(spawnResp.thread_id);
                }
                else {
                    console.log("[chat-page] No recent thread to resume — user will see landing page");
                }
            }
            catch (spawnErr) {
                console.warn("[chat-page] Failed to auto-resume recent thread (non-fatal):", spawnErr);
            }
            return { sessionId: session.session_id, sessionToken: session.token };
        }
        catch (err) {
            console.error("[chat-page] Session refresh failed:", err);
            // If refresh fails, JWT may also be expired - force re-login
            handleError(err);
            return null;
        }
    }
    /**
     * Public entry point for main.ts to call after @session-expired creates
     * a new session. Tries to resume the most recent thread from HelixDB.
     * No-op if no recent thread exists.
     */
    async tryResumeRecentThread() {
        try {
            const resp = await eduApi.spawnSession(this.sessionId, this.sessionToken, "recent");
            if (resp.thread_id) {
                console.log("[chat-page] Auto-resuming recent thread after session refresh:", resp.thread_id);
                await this.loadSessionById(resp.thread_id);
            }
        }
        catch (err) {
            console.warn("[chat-page] Failed to auto-resume recent thread (non-fatal):", err);
        }
    }
    async handleSend(text, reuseRequestId) {
        if (this.isStreaming)
            return;
        // Generate request_id once per user send, reuse on retry
        const requestId = reuseRequestId || crypto.randomUUID();
        this._currentRequestId = requestId;
        const MAX_IN_FLIGHT_RETRIES = 15;
        let inFlightRetries = 0;
        const userMsg = {
            role: "user",
            content: text,
            timestamp: Date.now(),
        };
        this.messages = [...this.messages, userMsg];
        this.isStreaming = true;
        this.showLanding = false;
        this.streamingMessage = null;
        // Sync agent-interface immediately — pi-chat-panel is manually appended
        // (not in Lit template), so property changes on chat-page don't propagate.
        if (this.chatPanel?.agentInterface) {
            const ai = this.chatPanel.agentInterface;
            ai.messages = this.messages;
            ai.isStreaming = true;
            ai.setStreamingMessage(null);
            ai.requestUpdate();
        }
        this.requestUpdate();
        if (!this.currentTitle) {
            this.currentTitle = this.generateTitleFromText(text);
        }
        const assistantMsg = {
            role: "assistant",
            content: [],
            timestamp: Date.now(),
        };
        let currentTextBlock = null;
        let currentThinkingBlock = null;
        const pendingTools = [];
        let streamEnded = false;
        let needsRetry = false;
        let receivedAnyFrame = false;
        let retrySameRequest = false;
        let bufferDrained = false;
        const receivedFrameIds = new Set();
        const { events, abort } = eduApi.sendInput(this.sessionId, this.sessionToken, text, undefined, // image
        undefined, // mimeType
        requestId);
        this.currentAbort = abort;
        const processEvent = (ev) => {
            if (streamEnded)
                return;
            const frame = ev.data;
            const frameType = ev.event;
            receivedAnyFrame = true;
            const frameId = typeof frame?.id === "number" ? frame.id : undefined;
            if (frameId !== undefined) {
                if (receivedFrameIds.has(frameId)) {
                    console.log(`[sse-stream] Skipping duplicate frame id=${frameId}`);
                    return;
                }
                receivedFrameIds.add(frameId);
            }
            if (frameType !== "token_usage") {
                console.log("[sse-stream] frame:", frameType, frameType === "assistant_text"
                    ? `"${frame.text.slice(0, 40)}..."`
                    : "");
            }
            switch (frameType) {
                case "chat_start":
                    if (this.showLanding) {
                        this.showLanding = false;
                        this.requestUpdate();
                    }
                    break;
                case "session_terminated": {
                    const e = classifySseFrame("session_terminated", frame);
                    if (e)
                        handleError(e);
                    streamEnded = true;
                    needsRetry = true;
                    console.log("[sse-stream] Session terminated — will retry after stream ends");
                    break;
                }
                case "chat_end": {
                    if (streamEnded)
                        break;
                    currentThinkingBlock = null;
                    if (currentTextBlock) {
                        // Flush current text block if needed
                    }
                    assistantMsg.stopReason = "stop";
                    this.isStreaming = false;
                    this.streamingMessage = null;
                    this.messages = [...this.messages, assistantMsg];
                    this.updateUI();
                    streamEnded = true;
                    break;
                }
                case "assistant_text": {
                    currentThinkingBlock = null;
                    const delta = frame.text;
                    if (!currentTextBlock) {
                        currentTextBlock = { type: "text", text: delta };
                        assistantMsg.content = [...assistantMsg.content, currentTextBlock];
                        if (!this.streamingMessage) {
                            this.streamingMessage = {
                                role: "assistant",
                                content: [],
                                timestamp: Date.now(),
                            };
                        }
                        this.streamingMessage.content = [...assistantMsg.content];
                    }
                    else {
                        currentTextBlock.text += delta;
                        this.streamingMessage.content = [...assistantMsg.content];
                    }
                    this.updateStreaming();
                    break;
                }
                case "thinking": {
                    const thinkText = frame.thinking || "";
                    if (currentThinkingBlock === null) {
                        currentThinkingBlock = {
                            type: "thinking",
                            thinking: thinkText,
                        };
                        assistantMsg.content = [...assistantMsg.content, currentThinkingBlock];
                        if (!this.streamingMessage) {
                            this.streamingMessage = {
                                role: "assistant",
                                content: [],
                                timestamp: Date.now(),
                            };
                        }
                        this.streamingMessage.content = [...assistantMsg.content];
                    }
                    else {
                        currentThinkingBlock.thinking += thinkText;
                        this.streamingMessage.content = [...assistantMsg.content];
                    }
                    this.updateStreaming();
                    break;
                }
                case "tool_start": {
                    currentTextBlock = null;
                    currentThinkingBlock = null;
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
                    assistantMsg.content = [...assistantMsg.content, toolCall];
                    pendingTools.push({ id: toolCall.id, name: toolCall.name });
                    if (!this.streamingMessage) {
                        this.streamingMessage = {
                            role: "assistant",
                            content: [],
                            timestamp: Date.now(),
                        };
                    }
                    this.streamingMessage.content = [...assistantMsg.content];
                    this.updateStreaming();
                    break;
                }
                case "tool_end": {
                    const pending = pendingTools.shift();
                    if (!pending)
                        break;
                    console.log("[sse-stream] tool_end RAW frame:", JSON.stringify(frame));
                    const status = frame.status || frame.Status || "unknown";
                    const exitCode = frame.exit_code ?? frame.exitCode ?? 0;
                    const stdout = frame.stdout || frame.output || frame.stdout || "";
                    const stderr = frame.stderr || frame.error || frame.stderr || "";
                    console.log("[sse-stream] tool_end extracted:", { status, exitCode, stdoutLen: stdout.length, stderrLen: stderr.length, pendingId: pending.id, toolName: pending.name });
                    const tc = assistantMsg.content.find((c) => c.type === "toolCall" && c.id === pending.id);
                    if (tc) {
                        tc.resultStatus = status;
                        tc.resultStdout = stdout;
                        tc.resultStderr = stderr;
                        tc.resultExitCode = exitCode;
                        console.log("[sse-stream] tool_end stored on toolCall:", {
                            id: tc.id,
                            name: tc.name,
                            resultStatus: tc.resultStatus,
                            stdoutLen: tc.resultStdout?.length,
                            stderrLen: tc.resultStderr?.length,
                        });
                    }
                    else {
                        console.warn("[sse-stream] tool_end could not find toolCall with id:", pending.id);
                    }
                    if (this.streamingMessage) {
                        this.streamingMessage.content = [...assistantMsg.content];
                    }
                    this.updateStreaming();
                    break;
                }
                case "token_usage": {
                    if (frame.used) {
                        const used = frame.used;
                        assistantMsg.usage = {
                            input: used,
                            output: 0,
                            cacheRead: frame.cache_read_tokens || 0,
                            cacheWrite: frame.cache_write_tokens || 0,
                            totalTokens: used,
                            cost: {
                                input: frame.cost ? frame.cost.amount || 0 : 0,
                                output: 0,
                                cacheRead: 0,
                                cacheWrite: 0,
                                total: frame.cost ? frame.cost.amount || 0 : 0,
                            },
                        };
                    }
                    break;
                }
                case "chat_error": {
                    if (streamEnded)
                        break;
                    const e = classifySseFrame("chat_error", frame);
                    if (e)
                        handleError(e);
                    console.error("[sse-stream] Chat error:", frame.error);
                    assistantMsg.stopReason = "error";
                    assistantMsg.errorMessage = frame.error;
                    this.isStreaming = false;
                    this.streamingMessage = null;
                    this.messages = [...this.messages, assistantMsg];
                    this.updateUI();
                    streamEnded = true;
                    break;
                }
                case "restriction": {
                    if (streamEnded)
                        break;
                    const e = classifySseFrame("restriction", frame);
                    if (e)
                        handleError(e);
                    assistantMsg.stopReason = "restriction";
                    assistantMsg.errorMessage = frame.message || "Access restricted";
                    this.isStreaming = false;
                    this.streamingMessage = null;
                    this.messages = [...this.messages, assistantMsg];
                    this.updateUI();
                    streamEnded = true;
                    break;
                }
                case "buffer_drained": {
                    const e = classifySseFrame("buffer_drained", frame);
                    if (e)
                        handleError(e);
                    console.log("[sse-stream] Buffer timed out on backend; reloading thread state");
                    bufferDrained = true;
                    this.isStreaming = false;
                    this.streamingMessage = null;
                    streamEnded = true;
                    break;
                }
                case "model_changed":
                case "session_created":
                case "session_info_update":
                case "config_update":
                case "available_commands":
                case "mode_update":
                case "plan_update":
                case "user_text":
                    break;
                default:
                    break;
            }
        };
        try {
            for await (const ev of events) {
                processEvent(ev);
                if (streamEnded && !needsRetry)
                    break;
                if (needsRetry)
                    break;
            }
            // If the stream produced no frames at all, the session is dead
            if (!receivedAnyFrame && !streamEnded) {
                console.warn("[sse-stream] No frames received — session likely dead");
                needsRetry = true;
            }
        }
        catch (err) {
            console.error("[sse-stream] Stream error:", err);
            const e = classifyError(err);
            if (e.code === ErrorCode.REQUEST_IN_FLIGHT && inFlightRetries < MAX_IN_FLIGHT_RETRIES) {
                // Backend is still processing — retry with backoff
                inFlightRetries++;
                console.log(`[sse-stream] Request in-flight, retrying in 2s... (${inFlightRetries}/${MAX_IN_FLIGHT_RETRIES})`);
                this.isStreaming = false;
                this.streamingMessage = null;
                this.updateUI();
                await new Promise(r => setTimeout(r, 2000));
                this.handleSend(text, requestId);
                return;
            }
            if (e.code === ErrorCode.REQUEST_IN_FLIGHT || e.code === ErrorCode.REQUEST_FAILED) {
                // Max retries exhausted or hard failure — generate new requestId
                console.log("[sse-stream] Request idempotency exhausted/failed, retrying with new requestId");
                this._currentRequestId = null;
                this.isStreaming = false;
                this.streamingMessage = null;
                this.updateUI();
                this.handleSend(text); // generates new requestId
                return;
            }
            if (!receivedAnyFrame && (e.code === ErrorCode.SESSION_NOT_FOUND || e.code === ErrorCode.SESSION_NOT_ACTIVE || e.code === ErrorCode.GOOSE_DEAD)) {
                needsRetry = true;
                streamEnded = true;
            }
            else if (receivedAnyFrame && e.retryable) {
                console.log("[sse-stream] Retryable mid-stream error; retrying same request");
                needsRetry = true;
                retrySameRequest = true;
                streamEnded = true;
            }
            else if (!streamEnded) {
                assistantMsg.stopReason = "error";
                assistantMsg.errorMessage = e.message || "Stream error";
                this.isStreaming = false;
                this.streamingMessage = null;
                this.messages = [...this.messages, assistantMsg];
                this.updateUI();
            }
        }
        finally {
            this.currentAbort = null;
            if (!streamEnded) {
                this.isStreaming = false;
                this.streamingMessage = null;
                this.updateUI();
            }
        }
        // — Handle session termination retry AFTER the event stream closes —
        if (needsRetry) {
            this.messages = this.messages.filter((m) => m.role !== "assistant" || m.content?.length);
            this.isStreaming = false;
            this.streamingMessage = null;
            if (retrySameRequest) {
                console.log("[sse-stream] Retrying same request in same session");
                this.handleSend(text, requestId);
                return;
            }
            console.log("[sse-stream] Refreshing session for retry...");
            const refreshed = await this.handleSessionRefresh();
            if (refreshed) {
                console.log("[sse-stream] Retrying message with new session:", refreshed.sessionId);
                this.handleSend(text); // new requestId for new session
            }
            return;
        }
        if (bufferDrained) {
            const recentThreadId = this.lastLoadedThreadId || SessionManager.loadLastThreadId(this.sessionId);
            if (recentThreadId) {
                await this.loadSessionById(recentThreadId);
            }
        }
    }
    handleCancel() {
        if (this.currentAbort) {
            this.currentAbort();
            this.currentAbort = null;
        }
        // Also notify backend to cancel the prompt
        eduApi.cancelInput(this.sessionId, this.sessionToken).catch((err) => {
            handleError(err);
        });
        this._currentRequestId = null; // Never retry a cancelled request
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
    extractSessionTodo(messages) {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "assistant" && Array.isArray(msg.content)) {
                for (let j = msg.content.length - 1; j >= 0; j--) {
                    const block = msg.content[j];
                    if (block.type === "toolCall" && block.name === "todo__todo_write") {
                        const args = block.arguments;
                        if (args?.content && typeof args.content === "string") {
                            return args.content;
                        }
                    }
                }
            }
        }
        return "";
    }
    async loadSessionById(threadId) {
        console.log(`[replay] Loading session ${threadId} via SSE`);
        const replayedMessages = [];
        let currentAssistant = null;
        let currentText = "";
        let currentThinking = "";
        let pendingToolCallId = null;
        const { events, abort } = eduApi.replayThread(this.sessionId, this.sessionToken, threadId);
        const timeout = setTimeout(() => {
            console.warn("[replay] Load timeout — aborting");
            abort();
        }, 15000);
        try {
            for await (const ev of events) {
                const frame = ev.data;
                try {
                    switch (ev.event) {
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
                            if (currentThinking) {
                                currentAssistant.content.push({
                                    type: "thinking",
                                    thinking: currentThinking,
                                });
                                currentThinking = "";
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
                            if (currentText) {
                                currentAssistant.content.push({ type: "text", text: currentText });
                                currentText = "";
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
                            break;
                        }
                        case "error": {
                            const e = classifySseFrame("error", frame);
                            console.error("[replay] Session replay error:", e?.message || frame.message || "Unknown error");
                            if (e && isSessionFatal(e)) {
                                const auth = SessionManager.loadAuth();
                                if (auth && SessionManager.isTokenValid(auth.token)) {
                                    this.handleSessionRefresh();
                                }
                                else {
                                    handleError(e);
                                }
                            }
                            break;
                        }
                    }
                }
                catch (err) {
                    console.error("[replay] Error processing frame:", err);
                }
            }
        }
        catch (err) {
            console.error("[replay] SSE stream error:", err);
        }
        finally {
            clearTimeout(timeout);
        }
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
            const e = classifyError(err);
            if (e.code === ErrorCode.SESSION_NOT_FOUND || e.code === ErrorCode.SESSION_NOT_ACTIVE || e.code === ErrorCode.GOOSE_DEAD) {
                console.warn("[replay] Session dead, refreshing before retry...");
                const refreshed = await this.handleSessionRefresh();
                if (refreshed)
                    return this.loadMostRecentSession();
            }
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
        const recipesTab = this.buildRecipesTab();
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
        MenuDialog.open([filesTab, sessionsTab, recipesTab, accountTab], undefined, 0, this.tokenBalance);
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
        const recipesTab = this.buildRecipesTab();
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
        MenuDialog.open([filesTab, sessionsTab, recipesTab, accountTab], undefined, 3, this.tokenBalance);
    }
    buildRecipesTab() {
        const tab = new RecipesTab();
        tab.sessionId = this.sessionId;
        tab.sessionToken = this.sessionToken;
        tab.currentRecipeContext = {
            recipePath: this.lastAppliedRecipePath,
            activityGroup: this.lastAppliedActivityGroup,
            activityLabel: this.lastAppliedActivityLabel,
        };
        tab.onRecipeApplied = (resp) => this.handleRecipeApplied(resp);
        tab.onNewSessionRequested = async () => {
            const resp = await eduApi.spawnSession(this.sessionId, this.sessionToken, "new");
            this.messages = [];
            this.currentTitle = "";
            this.lastLoadedThreadId = resp.thread_id || null;
            this.lastAppliedRecipePath = null;
            this.lastAppliedActivityGroup = null;
            this.lastAppliedActivityLabel = null;
            this.showLanding = false;
            this.isStreaming = false;
            this.streamingMessage = null;
            SessionManager.clearSession();
            SessionManager.saveSession(this.sessionId, this.sessionToken);
            this.updateUI();
            this.requestUpdate();
        };
        tab.onActivityApplied = (recipePath, activityGroup, activityLabel) => {
            this.lastAppliedRecipePath = recipePath;
            this.lastAppliedActivityGroup = activityGroup;
            this.lastAppliedActivityLabel = activityLabel;
        };
        return tab;
    }
    handleRecipeApplied(resp) {
        console.log("[chat-page] Recipe applied:", resp.title, resp.description, "activityPin:", resp.activityPin, "appliedActivityGroup:", resp.appliedActivityGroup, "appliedActivityLabel:", resp.appliedActivityLabel);
        this.recipeBanner = { title: resp.title, description: resp.description };
        this.lastAppliedRecipePath = resp.recipePath || null;
        this.lastAppliedActivityGroup = resp.appliedActivityGroup ?? null;
        this.lastAppliedActivityLabel = resp.appliedActivityLabel ?? null;
        if (resp.activityPin) {
            this.activityPromptPin = resp.activityPin;
        }
        this.requestUpdate();
        setTimeout(() => {
            this.recipeBanner = null;
            this.requestUpdate();
        }, 8000);
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
            const resp = await eduApi.spawnSession(this.sessionId, this.sessionToken, "new");
            this.messages = [];
            this.currentTitle = "";
            this.lastLoadedThreadId = resp.thread_id || null;
            this.showLanding = false;
            this.isStreaming = false;
            this.streamingMessage = null;
            // Clear stale thread reference from localStorage
            SessionManager.clearSession();
            SessionManager.saveSession(this.sessionId, this.sessionToken);
            this.updateUI();
            this.requestUpdate();
        }
        catch (err) {
            const e = classifyError(err);
            // Session ended/expired — create new backend session and retry
            if (e.code === ErrorCode.SESSION_NOT_FOUND ||
                e.code === ErrorCode.SESSION_NOT_ACTIVE ||
                e.code === ErrorCode.GOOSE_DEAD ||
                e.code === ErrorCode.NOT_FOUND) {
                console.warn("[chat-page] Session dead on newSession, refreshing...");
                const refreshed = await this.handleSessionRefresh();
                if (refreshed) {
                    return this.newSession();
                }
                alert("Session expired. Please log in again.");
                return;
            }
            handleError(err);
            alert(e.message || "Failed to create new session. Please try again.");
        }
    }
    async handleContinueRecent() {
        try {
            const resp = await eduApi.spawnSession(this.sessionId, this.sessionToken, "recent");
            if (resp.thread_id) {
                console.log("[chat-page] Resuming recent thread:", resp.thread_id);
                this.loadSessionById(resp.thread_id);
            }
            else {
                alert("No recent session found. Start a new chat!");
            }
        }
        catch (err) {
            const e = classifyError(err);
            if (isSessionFatal(err)) {
                console.warn("[chat-page] Session dead on Continue Recent — refreshing session...");
                const refreshed = await this.handleSessionRefresh();
                if (!refreshed) {
                    alert("Session expired. Please log in again.");
                }
                // handleSessionRefresh already calls spawn("recent") + loadSessionById internally
            }
            else {
                console.error("[chat-page] Failed to resume recent session:", err);
                alert(e.message || "Failed to load recent session. Please try again.");
            }
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

        ${this.activityPromptPin
            ? html `
            <div class="flex items-center gap-2 px-4 border-b border-border shrink-0 h-7 bg-primary/[0.03]">
              <span class="text-primary shrink-0 text-xs leading-none">📌</span>
              <div class="flex-1 overflow-hidden relative h-full">
                <div class="absolute inset-0 flex items-center overflow-hidden">
                  <div class="marquee-text">
                    <span class="text-xs text-foreground/80 whitespace-nowrap">${this.activityPromptPin}&nbsp;&nbsp;•&nbsp;&nbsp;</span>
                    <span class="text-xs text-foreground/80 whitespace-nowrap">${this.activityPromptPin}&nbsp;&nbsp;•&nbsp;&nbsp;</span>
                  </div>
                </div>
              </div>
              <button
                class="shrink-0 text-muted-foreground hover:text-foreground transition-colors leading-none text-xs"
                @click=${() => { this.activityPromptPin = null; this.requestUpdate(); }}
                title="Dismiss"
              >✕</button>
            </div>
          `
            : ''}

        <!-- Chat Area -->
        <div class="flex-1 flex flex-col min-h-0 relative">
          ${this.recipeBanner
            ? html `
                <div
                  class="absolute top-2 left-1/2 -translate-x-1/2 z-30 max-w-2xl w-[calc(100%-2rem)] px-4 py-3 rounded-lg border border-primary/30 bg-primary/10 backdrop-blur-sm shadow-lg flex items-start gap-3"
                >
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-semibold text-foreground">
                      Recipe applied: ${this.recipeBanner.title}
                    </div>
                    <div class="text-xs text-muted-foreground line-clamp-2">
                      ${this.recipeBanner.description}
                    </div>
                  </div>
                  ${Button({
                variant: "ghost",
                size: "sm",
                children: "Dismiss",
                onClick: () => {
                    this.recipeBanner = null;
                    this.requestUpdate();
                },
            })}
                </div>
              `
            : ""}
          ${this.showLanding && this._ready
            ? html `<landing-banner
                .onNewChat=${() => this.newSession()}
                .onContinueRecent=${() => this.handleContinueRecent()}
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
], ChatPage.prototype, "sessionTodo", void 0);
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
], ChatPage.prototype, "recipeBanner", void 0);
__decorate([
    state()
], ChatPage.prototype, "activityPromptPin", void 0);
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
