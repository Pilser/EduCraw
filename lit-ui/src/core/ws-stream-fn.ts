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
import { WsManager } from "./ws-manager";

interface WsStreamFnOptions {
  sessionId: string;
  authToken: string;
  onReconnected?: () => void;
  onStreamStart?: () => void;
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
 * Creates a streamFn that uses a persistent WsManager connection
 * (like educlaw-web - keeps connection alive across messages)
 */
export function createWsStreamFn(options: WsStreamFnOptions): StreamFn {
  const { sessionId, authToken, onReconnected, onStreamStart } = options;

  return async (
    model: Model<any>,
    context: Context,
    streamOptions?: SimpleStreamOptions,
  ): Promise<AssistantMessageEventStream> => {
    const stream = createAssistantMessageEventStream();

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
    let pendingTools: Array<{ id: string; name: string }> = [];
    let streamEnded = false;

    // Emit start event
    stream.push({ type: "start", partial: { ...assistantMsg } });
    console.log("[ws-stream] stream event: start");

    // Get or create persistent WebSocket manager for this session
    const wsManager = WsManager.getInstance({
      sessionId,
      token: authToken,
      onReconnected, // Pass through reconnection handler
      onMessage: (frame) => {
        if (streamEnded) return;

        // Handle binary frames (PTY data) - skip for chat UI
        if (frame.type === "binary") {
          return;
        }

        // Debug logging
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

          case "chat_end":
            // Finalize and close stream
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
            stream.end({ ...assistantMsg });
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
              stream.push({
                type: "thinking_start",
                contentIndex: thinkIdx,
                partial: { ...assistantMsg },
              });
              contentIndex = thinkIdx + 1;
            } else {
              currentThinkingContent.thinking += thinkText;
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
            if (!pending) break;

            const status = (frame.status as string) || "unknown";
            const exitCode = (frame.exit_code as number) ?? 0;
            const stdout = (frame.stdout as string) || "";
            const stderr = (frame.stderr as string) || "";

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
      },
      onError: (err) => {
        if (!streamEnded) {
          console.error("[ws-stream] WsManager error:", err);
          assistantMsg.stopReason = "error";
          stream.push({
            type: "done",
            reason: "stop",
            message: { ...assistantMsg },
          });
          stream.end({ ...assistantMsg });
          streamEnded = true;
        }
      },
    });

    // Send the input message
    const msg: any = {
      type: "input",
      data: inputText,
    };
    if (imageContent) {
      msg.image = `data:${imageContent.mimeType};base64,${imageContent.data}`;
      msg.mime_type = imageContent.mimeType;
    }
    wsManager.send(msg);

    // Handle abort
    streamOptions?.signal?.addEventListener("abort", () => {
      wsManager.send({ type: "cancel" });
    });

    return stream;
  };
}
