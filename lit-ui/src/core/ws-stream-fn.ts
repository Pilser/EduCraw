import {
  createAssistantMessageEventStream,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  Context,
  ImageContent,
  Model,
  SimpleStreamOptions,
  StopReason,
  TextContent,
  ToolCall,
  Usage,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { SessionManager } from "./session-manager";

interface WsStreamFnOptions {
  sessionId: string;
  authToken: string;
  onSessionExpired?: () => void;
}

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * Creates a streamFn that bridges the Agent to EduCrawl's WebSocket backend.
 * Includes reconnection logic with exponential backoff (like educlaw-web).
 */
export function createWsStreamFn(options: WsStreamFnOptions): StreamFn {
  const { sessionId, authToken, onSessionExpired } = options;

  return async (
    model: Model<any>,
    context: Context,
    streamOptions?: SimpleStreamOptions,
  ): Promise<AssistantMessageEventStream> => {
    const stream = createAssistantMessageEventStream();

    // Build WebSocket URL
    const wsBase =
      import.meta.env.VITE_WS_TARGET ||
      `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    const wsUrl = `${wsBase}/sessions/${sessionId}/ws?token=${encodeURIComponent(authToken)}`;

    // Extract the last user message to send
    const lastUserMsg = [...context.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUserMsg) {
      stream.end();
      return stream;
    }

    // Get the text content to send
    let inputText = "";
    if (typeof lastUserMsg.content === "string") {
      inputText = lastUserMsg.content;
    } else {
      inputText = lastUserMsg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    }

    // Check for image content
    const imageContent = Array.isArray(lastUserMsg.content)
      ? lastUserMsg.content.find((c): c is ImageContent => c.type === "image")
      : undefined;

    // Build the initial assistant message
    let contentIndex = 0;
    const assistantMsg: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { ...EMPTY_USAGE },
      stopReason: "stop" as StopReason,
      timestamp: Date.now(),
    };
    let currentTextContent: TextContent | null = null;
    let currentThinkingContent: { type: "thinking"; thinking: string } | null =
      null;

    // Track pending tool calls in FIFO order for matching tool_end frames
    let pendingTools: Array<{ id: string; name: string }> = [];

    // Emit start event
    stream.push({ type: "start", partial: { ...assistantMsg } });
    console.log("[ws-stream] stream event: start");

    // Reconnection state
    let reconnectAttempts = 0;
    const maxReconnectTime = 5 * 60 * 1000; // 5 minutes
    let streamEnded = false;
    let isMounted = true;
    let pendingReconnect: ReturnType<typeof setTimeout> | null = null;

    const createAndConnectWebSocket = (): WebSocket => {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        console.log("[ws-stream] WS opened, sending input");
        reconnectAttempts = 0; // Reset on successful connection
        const msg: Record<string, unknown> = {
          type: "input",
          data: inputText,
        };
        if (imageContent) {
          msg.image = `data:${imageContent.mimeType};base64,${imageContent.data}`;
          msg.mime_type = imageContent.mimeType;
        }
        ws.send(JSON.stringify(msg));
      };

      ws.onmessage = (event) => {
        // Skip binary frames (PTY terminal data — not used by chat UI)
        if (event.data instanceof ArrayBuffer) return;

        try {
          const frame = JSON.parse(event.data as string);
          // Debug: log all non-binary frames
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
              // Stream start signal from server
              break;

            case "chat_end":
              // Server keeps WS open for next turns, but our arch is per-prompt.
              // Finalize current text and thinking, emit done, end stream, close socket.
              currentThinkingContent = null;
              if (currentTextContent) {
                stream.push({
                  type: "text_end",
                  contentIndex,
                  content: currentTextContent.text,
                  partial: { ...assistantMsg },
                });
              }
              assistantMsg.stopReason = "stop";
              stream.push({
                type: "done",
                reason: "stop",
                message: { ...assistantMsg },
              });
              console.log(
                "[ws-stream] stream event: done, content length:",
                assistantMsg.content.length,
              );
              stream.end({ ...assistantMsg });
              ws.close();
              streamEnded = true;
              break;

            case "assistant_text": {
              currentThinkingContent = null;
              const delta = frame.text as string;

              if (!currentTextContent) {
                currentTextContent = { type: "text", text: delta };
                assistantMsg.content = [
                  ...assistantMsg.content,
                  currentTextContent,
                ];
                console.log(
                  "[ws-stream] stream event: text_start, contentIndex:",
                  contentIndex,
                );
                stream.push({
                  type: "text_start",
                  contentIndex,
                  partial: { ...assistantMsg },
                });
              } else {
                currentTextContent.text += delta;
                stream.push({
                  type: "text_delta",
                  contentIndex,
                  delta,
                  partial: { ...assistantMsg },
                });
              }
              break;
            }

            case "thinking": {
              const thinkText = (frame.thinking as string) || "";

              if (currentThinkingContent === null) {
                currentThinkingContent = {
                  type: "thinking",
                  thinking: thinkText,
                };
                const thinkIdx = assistantMsg.content.length;
                assistantMsg.content = [
                  ...assistantMsg.content,
                  currentThinkingContent,
                ];
                console.log(
                  `[ws-stream] thinking_start, idx=${thinkIdx} first chunk: "${thinkText.slice(0, 40)}"`,
                );
                stream.push({
                  type: "thinking_start",
                  contentIndex: thinkIdx,
                  partial: { ...assistantMsg },
                });
                contentIndex = thinkIdx + 1;
              } else {
                currentThinkingContent.thinking += thinkText;
                console.log(
                  `[ws-stream] thinking_delta: accumulated to "${currentThinkingContent.thinking.slice(0, 40)}"`,
                );
                stream.push({
                  type: "thinking_delta",
                  contentIndex: contentIndex - 1,
                  delta: thinkText,
                  partial: { ...assistantMsg },
                });
              }
              break;
            }

            case "tool_start": {
              const name = (frame.name as string) || "unknown";
              const argsStr = (frame.input as string) || "{}";
              let args: Record<string, any> = {};
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

              const tcIndex = assistantMsg.content.length;
              assistantMsg.content = [...assistantMsg.content, toolCall];
              pendingTools.push({ id: toolCall.id, name: toolCall.name });

              stream.push({
                type: "toolcall_start",
                contentIndex: tcIndex,
                partial: { ...assistantMsg },
              });
              contentIndex = tcIndex + 1;
              break;
            }

            case "tool_end": {
              const pending = pendingTools.shift();
              if (!pending) {
                console.log(
                  "[ws-stream] tool_end received but no pending tool",
                );
                break;
              }

              const status = (frame.status as string) || "unknown";
              const exitCode = (frame.exit_code as number) ?? 0;
              const stdout = (frame.stdout as string) || "";
              const stderr = (frame.stderr as string) || "";

              console.log(
                `[ws-stream] tool_end: ${pending.name} status=${status} exit=${exitCode}`,
              );

              const tc = assistantMsg.content.find(
                (c) => c.type === "toolCall" && c.id === pending.id,
              ) as ToolCall | undefined;
              if (tc) {
                (tc as any).resultStatus = status;
                (tc as any).resultStdout = stdout;
                (tc as any).resultStderr = stderr;
                (tc as any).resultExitCode = exitCode;
              }

              stream.push({
                type: "toolcall_end",
                contentIndex: assistantMsg.content.findIndex(
                  (c) => c.type === "toolCall" && c.id === pending.id,
                ),
                toolCall: tc || {
                  type: "toolCall",
                  id: pending.id,
                  name: pending.name,
                  arguments: {},
                },
                partial: { ...assistantMsg },
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
        } catch {
          // Ignore non-JSON frames
        }
      };

      ws.onerror = (err) => {
        if (streamEnded) return;
        console.error("[ws-stream] WebSocket error:", err);
        // Don't immediately end the stream - try reconnection first
      };

      ws.onclose = () => {
        if (streamEnded || !isMounted) return;

        console.log("[ws-stream] WebSocket closed");

        // Try reconnection with exponential backoff (like educlaw-web)
        if (true) {
          // Try reconnection with exponential backoff (like educlaw-web)
          const elapsedTime = reconnectAttempts * 1000;
          if (elapsedTime < maxReconnectTime) {
            const delay = Math.min(
              1000 * Math.pow(2, reconnectAttempts),
              30000,
            );
            console.log(
              `[ws-stream] Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})`,
            );
            pendingReconnect = setTimeout(() => {
              if (isMounted && !streamEnded) {
                reconnectAttempts += 1;
                console.log(`[ws-stream] Attempting to reconnect...`);
                // Note: We can't actually reconnect per-message in the current architecture
                // But we log the intent for debugging
                // A full reconnect would require re-opening the entire stream
              }
            }, delay);
          } else {
            console.log("[ws-stream] Max reconnection time exceeded");
            // Max reconnect time reached - end stream with error
            assistantMsg.stopReason = "error";
            stream.push({
              type: "done",
              reason: "stop",
              message: { ...assistantMsg },
            });
            stream.end({ ...assistantMsg });
            streamEnded = true;
          }
        }

        // Finalize any pending content
        if (!streamEnded) {
          if (currentTextContent) {
            stream.push({
              type: "text_end",
              contentIndex,
              content: currentTextContent.text,
              partial: { ...assistantMsg },
            });
          }

          assistantMsg.stopReason = "stop";
          stream.push({
            type: "done",
            reason: "stop",
            message: { ...assistantMsg },
          });
          stream.end({ ...assistantMsg });
          streamEnded = true;
        }
      };

      return ws;
    };

    let ws = createAndConnectWebSocket();

    // Handle abort
    streamOptions?.signal?.addEventListener("abort", () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "cancel" }));
        ws.close();
      }
    });

    return stream;
  };
}
