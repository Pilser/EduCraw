import { WsManager } from "./ws-manager";
/**
 * Creates a function that sends user input via WebSocket and streams
 * backend frames through callbacks. No pi-ai dependencies.
 */
export function createWsStreamFn(options) {
    const { sessionId, authToken, onReconnected, onStreamStart } = options;
    return (input, callbacks) => {
        const pendingTools = [];
        let streamEnded = false;
        const assistantMsg = {
            role: "assistant",
            content: [],
            timestamp: Date.now(),
        };
        let currentTextBlock = null;
        let currentThinkingBlock = null;
        const wsManager = WsManager.getInstance({
            sessionId,
            token: authToken,
            onReconnected,
            onMessage: (frame) => {
                if (streamEnded)
                    return;
                if (frame.type === "binary")
                    return;
                if (frame.type !== "token_usage") {
                    console.log("[ws-stream] frame received:", frame.type, frame.type === "assistant_text"
                        ? `"${frame.text.slice(0, 40)}..."`
                        : "");
                }
                switch (frame.type) {
                    case "chat_start":
                        onStreamStart?.();
                        break;
                    case "chat_end": {
                        currentThinkingBlock = null;
                        if (currentTextBlock) {
                            callbacks.onTextEnd?.();
                        }
                        assistantMsg.stopReason = "stop";
                        callbacks.onDone?.(assistantMsg);
                        streamEnded = true;
                        break;
                    }
                    case "assistant_text": {
                        currentThinkingBlock = null;
                        const delta = frame.text;
                        if (!currentTextBlock) {
                            currentTextBlock = { type: "text", text: delta };
                            assistantMsg.content = [...assistantMsg.content, currentTextBlock];
                            callbacks.onTextStart?.();
                        }
                        else {
                            currentTextBlock.text += delta;
                            callbacks.onTextDelta?.(delta);
                        }
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
                            callbacks.onThinkingStart?.();
                        }
                        else {
                            currentThinkingBlock.thinking += thinkText;
                            callbacks.onThinkingDelta?.(thinkText);
                        }
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
                        callbacks.onToolCallStart?.(toolCall);
                        break;
                    }
                    case "tool_end": {
                        const pending = pendingTools.shift();
                        if (!pending)
                            break;
                        const status = frame.status || "unknown";
                        const exitCode = frame.exit_code ?? 0;
                        const stdout = frame.stdout || "";
                        const stderr = frame.stderr || "";
                        console.log(`[ws-stream] tool_end: ${pending.name} status=${status} exit=${exitCode}`);
                        const tc = assistantMsg.content.find((c) => c.type === "toolCall" && c.id === pending.id);
                        if (tc) {
                            tc.resultStatus = status;
                            tc.resultStdout = stdout;
                            tc.resultStderr = stderr;
                            tc.resultExitCode = exitCode;
                        }
                        callbacks.onToolCallEnd?.(tc || {
                            type: "toolCall",
                            id: pending.id,
                            name: pending.name,
                            arguments: {},
                        });
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
                    default:
                        break;
                }
            },
            onError: (err) => {
                if (!streamEnded) {
                    console.error("[ws-stream] WsManager error:", err);
                    assistantMsg.stopReason = "error";
                    assistantMsg.errorMessage = err.message;
                    callbacks.onError?.(err);
                    callbacks.onDone?.(assistantMsg);
                    streamEnded = true;
                }
            },
        });
        wsManager.send({ type: "input", data: input });
    };
}
