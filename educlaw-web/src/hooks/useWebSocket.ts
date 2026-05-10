import { useEffect, useRef, useState, useCallback } from "react";
import type {
  WsEnvelope,
  ShowImagePayload,
  TurnTokenUsage,
  TokenUsageUpdate,
} from "../api/types";

export type WsStatus = "connecting" | "connected" | "disconnected" | "error";

interface Options {
  sessionId: string;
  token: string;
  onPtyData: (data: Uint8Array) => void;
  onImage: (p: ShowImagePayload) => void;
  onChatStart?: () => void;
  onUserText?: (text: string) => void;
  onToolStart?: (tool: string, command: string) => void;
  onToolEnd?: (exitCode: number, stdout: string, stderr: string) => void;
  onAssistantText?: (text: string) => void;
  onChatEnd?: () => void;
  onTokenUsage?: (usage: TurnTokenUsage) => void;
  onTokenUsageUpdate?: (update: TokenUsageUpdate) => void;
  onTokenLimitReached?: (banner: string) => void;
  onModelChanged?: (model: string) => void;
  onModelsReceived?: (models: string[], active: string) => void;
  onSessionsListReceived?: (sessions: any[]) => void;
  onForkSessionComplete?: (newSessionId: string) => void;
  onLoadSessionComplete?: (threadId: string) => void;
  onExportSessionResult?: (data: string) => void;
  onImportSessionResult?: (result: {
    session_id: string;
    title?: string;
    updated_at?: string;
    message_count: number;
  }) => void;
  onSessionCreated?: (sessionId: string) => void;
}

export function useWebSocket({
  sessionId,
  token,
  onPtyData,
  onImage,
  onChatStart,
  onUserText,
  onToolStart,
  onToolEnd,
  onAssistantText,
  onChatEnd,
  onTokenUsage,
  onTokenUsageUpdate,
  onTokenLimitReached,
  onModelChanged,
  onModelsReceived,
  onSessionsListReceived,
  onForkSessionComplete,
  onLoadSessionComplete,
  onExportSessionResult,
  onImportSessionResult,
  onSessionCreated,
}: Options) {
  const [status, setStatus] = useState<WsStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  // Reconnection state
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxReconnectTime = 5 * 60 * 1000; // 5 minutes
  const isMountedRef = useRef(true);
  // Trigger to force effect re-run on reconnect
  const [reconnectKey, setReconnectKey] = useState(0);

  const send = useCallback((msg: object) => {
    wsRef.current?.readyState === WebSocket.OPEN &&
      wsRef.current.send(JSON.stringify(msg));
  }, []);

  const sendInput = useCallback(
    (data: string) => {
      send({ type: "input", data });
    },
    [send],
  );

  const sendInputWithImage = useCallback(
    (data: string, imageDataUrl?: string, mimeType?: string) => {
      const msg: any = { type: "input", data };
      if (imageDataUrl) {
        msg.image = imageDataUrl;
        msg.mime_type = mimeType || "image/png";
      }
      send(msg);
    },
    [send],
  );

  const sendResize = useCallback(
    (cols: number, rows: number) => {
      send({ type: "resize", cols, rows });
    },
    [send],
  );

  const sendCancel = useCallback(() => {
    send({ type: "cancel" });
  }, [send]);

  const sendGetModels = useCallback(() => {
    send({ type: "getmodels" });
  }, [send]);

  const sendLoadSession = useCallback(
    (threadId: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.error("WebSocket not open");
        return false;
      }
      send({ type: "load_session", thread_id: threadId });
      return true;
    },
    [send],
  );

  const sendForkSession = useCallback(
    (threadId: string) => {
      send({ type: "fork_session", thread_id: threadId });
    },
    [send],
  );

  const sendListSessions = useCallback(() => {
    send({ type: "list_sessions" });
  }, [send]);

  const sendExportSession = useCallback(
    (sessionId: string) => {
      send({ type: "export_session", session_id: sessionId });
    },
    [send],
  );

  const sendImportSession = useCallback(
    (data: string) => {
      send({ type: "import_session", data });
    },
    [send],
  );

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/sessions/${sessionId}/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    // Store callbacks in refs to avoid reconnecting when they change
    const callbacksRef = {
      onPtyData,
      onImage,
      onChatStart,
      onUserText,
      onToolStart,
      onToolEnd,
      onAssistantText,
      onChatEnd,
      onTokenUsage,
      onTokenUsageUpdate,
      onTokenLimitReached,
      onModelChanged,
      onModelsReceived,
      onSessionsListReceived,
      onForkSessionComplete,
      onLoadSessionComplete,
      onExportSessionResult,
      onImportSessionResult,
      onSessionCreated,
    };

    ws.onopen = () => {
      setStatus("connected");
      reconnectAttemptsRef.current = 0; // Reset on successful connection
      console.log("WebSocket connected");
    };

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const raw = new Uint8Array(e.data);
        const text = new TextDecoder().decode(raw);
        const oscMatch = text.match(/\x1b\]99;(.+?)\x07/);
        if (oscMatch) {
          const clean = text.replace(/\x1b\]99;.+?\x07/g, "");
          if (clean.length > 0)
            callbacksRef.onPtyData(new TextEncoder().encode(clean));
          try {
            const envelope: WsEnvelope = JSON.parse(oscMatch[1]);
            if (envelope.type === "show_image")
              callbacksRef.onImage(envelope.payload as ShowImagePayload);
          } catch {
            /* malformed envelope — ignore */
          }
        } else {
          callbacksRef.onPtyData(raw);
        }
      } else {
        try {
          const frame = JSON.parse(e.data as string) as {
            type: string;
            text?: string;
            tool?: string;
            name?: string;
            command?: string;
            input?: string;
            exit_code?: number;
            status?: string;
            stdout?: string;
            stderr?: string;
            payload?: unknown;
            model?: string;
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
            banner?: string;
            thread_id?: string;
            new_session_id?: string;
            sessions?: any[];
          };
          switch (frame.type) {
            case "show_image":
              callbacksRef.onImage(frame.payload as ShowImagePayload);
              break;
            case "chat_start":
              callbacksRef.onChatStart?.();
              break;
            case "user_text":
              if (frame.text) callbacksRef.onUserText?.(frame.text);
              break;
            case "tool_start":
              callbacksRef.onToolStart?.(
                frame.name ?? frame.tool ?? "",
                frame.input ?? frame.command ?? "",
              );
              break;
            case "tool_end": {
              const code =
                typeof frame.exit_code === "number" ? frame.exit_code : 0;
              const stdout = (frame as any).stdout ?? "";
              const stderr = (frame as any).stderr ?? "";
              callbacksRef.onToolEnd?.(code, stdout, stderr);
              break;
            }
            case "assistant_text":
              if (frame.text) callbacksRef.onAssistantText?.(frame.text);
              break;
            case "chat_end":
              callbacksRef.onChatEnd?.();
              break;
            case "token_usage":
              // Try new format first (used, size, cost)
              if ("used" in frame) {
                const tokenFrame = frame as any;
                callbacksRef.onTokenUsageUpdate?.({
                  used: tokenFrame.used ?? 0,
                  size: tokenFrame.size ?? undefined,
                  cost: tokenFrame.cost ?? null,
                });
              } else {
                // Fallback to old format (input_tokens, output_tokens, etc.)
                callbacksRef.onTokenUsage?.({
                  model: frame.model ?? "",
                  input_tokens: frame.input_tokens ?? 0,
                  output_tokens: frame.output_tokens ?? 0,
                  cache_creation_input_tokens:
                    frame.cache_creation_input_tokens ?? 0,
                  cache_read_input_tokens: frame.cache_read_input_tokens ?? 0,
                });
              }
              break;
            case "token_limit_reached":
              callbacksRef.onTokenLimitReached?.(
                frame.banner ??
                  "Token limit reached. Please contact your administrator.",
              );
              break;
            case "model_changed":
              if (frame.model) callbacksRef.onModelChanged?.(frame.model);
              break;
            case "models": {
              const models = (frame as any).models ?? [];
              const active = (frame as any).active ?? "";
              callbacksRef.onModelsReceived?.(models, active);
              break;
            }
            case "sessions_list": {
              const sessions = (frame as any).sessions ?? [];
              callbacksRef.onSessionsListReceived?.(sessions);
              break;
            }
            case "forked_session": {
              const newSessionId = (frame as any).new_session_id;
              if (newSessionId) {
                callbacksRef.onForkSessionComplete?.(newSessionId);
              }
              break;
            }
            case "load_session_complete": {
              const threadId = (frame as any).thread_id;
              if (threadId) {
                callbacksRef.onLoadSessionComplete?.(threadId);
              }
              break;
            }
            case "export_session_result":
              callbacksRef.onExportSessionResult?.((frame as any).data);
              break;
            case "import_session_result":
              callbacksRef.onImportSessionResult?.({
                session_id: (frame as any).session_id,
                title: (frame as any).title,
                updated_at: (frame as any).updated_at,
                message_count: (frame as any).message_count,
              });
              break;
            case "session_created":
              callbacksRef.onSessionCreated?.((frame as any).session_id);
              break;
            default:
              break;
          }
        } catch {
          /* ignore */
        }
      }
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;

      setStatus("disconnected");
      console.log("WebSocket disconnected");

      // Attempt reconnection with exponential backoff
      const elapsed = reconnectAttemptsRef.current * 1000;
      if (elapsed < maxReconnectTime) {
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttemptsRef.current),
          30000,
        );
        console.log(
          `Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1})`,
        );
        reconnectTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            reconnectAttemptsRef.current += 1;
            // Force effect re-run by updating reconnectKey
            setReconnectKey((prev) => prev + 1);
          }
        }, delay);
      } else {
        console.log("Max reconnection time exceeded");
        setStatus("error");
      }
    };

    ws.onerror = (e) => {
      console.error("WebSocket error:", e);
      // Don't set status to error here - onclose will be called after
    };

    return () => {
      isMountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      ws.close();
    };
  }, [sessionId, token, reconnectKey]); // reconnectKey triggers re-run for reconnection

  // Reset reconnect attempts when sessionId or token changes
  useEffect(() => {
    reconnectAttemptsRef.current = 0;
  }, [sessionId, token]);

  return {
    status,
    sendInput,
    sendInputWithImage,
    sendResize,
    sendCancel,
    sendGetModels,
    sendListSessions,
    sendLoadSession,
    sendForkSession,
    sendExportSession,
    sendImportSession,
  };
}
