import { WsManager } from "./ws-manager";
import type {
  BackendAssistantMessage,
  BackendContentBlock,
  BackendToolCallBlock,
} from "./edu-types";

interface WsStreamFnOptions {
  sessionId: string;
  authToken: string;
  onReconnected?: () => void;
  onStreamStart?: () => void;
}

export interface StreamCallbacks {
  onTextStart?: () => void;
  onTextDelta?: (text: string) => void;
  onTextEnd?: () => void;
  onThinkingStart?: () => void;
  onThinkingDelta?: (text: string) => void;
  onThinkingEnd?: () => void;
  onToolCallStart?: (toolCall: BackendToolCallBlock) => void;
  onToolCallEnd?: (toolCall: BackendToolCallBlock) => void;
  onDone?: (message: BackendAssistantMessage) => void;
  onError?: (error: Error) => void;
}

interface PendingToolCall {
  id: string;
  name: string;
}

/**
 * Creates a function that sends user input via WebSocket and streams
 * backend frames through callbacks. No pi-ai dependencies.
 */
export function createWsStreamFn(options: WsStreamFnOptions): (
  input: string,
  callbacks: StreamCallbacks,
) => void {
  const { sessionId, authToken, onReconnected, onStreamStart } = options;

  return (input: string, callbacks: StreamCallbacks): void => {
    const pendingTools: PendingToolCall[] = [];
    let streamEnded = false;

    const assistantMsg: BackendAssistantMessage = {
      role: "assistant",
      content: [],
      timestamp: Date.now(),
    };

    let currentTextBlock: BackendContentBlock | null = null;
    let currentThinkingBlock: BackendContentBlock | null = null;

    const wsManager = WsManager.getInstance({
      sessionId,
      token: authToken,
      onReconnected,
      onMessage: (frame) => {
        if (streamEnded) return;

        if (frame.type === "binary") return;

        if (frame.type !== "token_usage") {
          console.log(
            "[ws-stream] frame received:",
            frame.type,
            frame.type === "assistant_text"
              ? `"${(frame.text as string).slice(0, 40)}..."`
              : "",
          );
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
            const delta = frame.text as string;

            if (!currentTextBlock) {
              currentTextBlock = { type: "text", text: delta };
              assistantMsg.content = [...assistantMsg.content, currentTextBlock];
              callbacks.onTextStart?.();
            } else {
              (currentTextBlock as any).text += delta;
              callbacks.onTextDelta?.(delta);
            }
            break;
          }

          case "thinking": {
            const thinkText = (frame.thinking as string) || "";

            if (currentThinkingBlock === null) {
              currentThinkingBlock = {
                type: "thinking",
                thinking: thinkText,
              };
              assistantMsg.content = [...assistantMsg.content, currentThinkingBlock];
              callbacks.onThinkingStart?.();
            } else {
              (currentThinkingBlock as any).thinking += thinkText;
              callbacks.onThinkingDelta?.(thinkText);
            }
            break;
          }

          case "tool_start": {
            currentTextBlock = null;
            currentThinkingBlock = null;

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

            assistantMsg.content = [...assistantMsg.content, toolCall];
            pendingTools.push({ id: toolCall.id, name: toolCall.name });
            callbacks.onToolCallStart?.(toolCall);
            break;
          }

          case "tool_end": {
            const pending = pendingTools.shift();
            if (!pending) break;

            const status = (frame.status as string) || "unknown";
            const exitCode = (frame.exit_code as number) ?? 0;
            const stdout = (frame.stdout as string) || "";
            const stderr = (frame.stderr as string) || "";

            console.log(
              `[ws-stream] tool_end: ${pending.name} status=${status} exit=${exitCode}`,
            );

            const tc = assistantMsg.content.find(
              (c) => c.type === "toolCall" && c.id === pending.id,
            ) as BackendToolCallBlock | undefined;
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
              const used = frame.used as number;
              assistantMsg.usage = {
                input: used,
                output: 0,
                cacheRead: (frame.cache_read_tokens as number) || 0,
                cacheWrite: (frame.cache_write_tokens as number) || 0,
                totalTokens: used,
                cost: {
                  input: frame.cost ? (frame.cost as any).amount || 0 : 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: frame.cost ? (frame.cost as any).amount || 0 : 0,
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
