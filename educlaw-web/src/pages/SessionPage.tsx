import { useState, useCallback, useRef, useEffect } from "react";
import {
  Files,
  BarChart3,
  GraduationCap,
  User,
  Menu,
  BookOpen,
  Folder,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import TutorTerminal from "../components/TutorTerminal";
import FileTree from "../components/FileTree";
import AssignmentPanel from "../components/AssignmentPanel";
import ChatPanel from "../components/ChatPanel";
import FilePreview from "../components/FilePreview";
import DraggableModal from "../components/DraggableModal";
import SessionSelector from "../components/SessionSelector";
import { useWebSocket, type WsStatus } from "../hooks/useWebSocket";
import { api } from "../api/client";
import type {
  LoginResponse,
  Session,
  ShowImagePayload,
  ChatMessage,
  MessageSegment,
  TokenUsage,
  TurnTokenUsage,
} from "../api/types";

export interface AttachedFileRef {
  path: string;
  name: string;
}

interface Props {
  auth: LoginResponse;
  session: Session;
  onEnd: () => void;
}

function StatusDot({ status }: { status: WsStatus }) {
  const colors: Record<WsStatus, string> = {
    connecting: "bg-wp-warning",
    connected: "bg-wp-success",
    disconnected: "bg-wp-error",
    error: "bg-wp-error",
  };
  const labels: Record<WsStatus, string> = {
    connecting: "Connecting",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Connection error",
  };
  return (
    <span className="flex items-center gap-1.5 text-xs text-wp-text-tertiary">
      <span
        className={`w-2 h-2 rounded-full ${colors[status]} ${status === "connecting" ? "animate-pulse" : ""}`}
      />
      {labels[status]}
    </span>
  );
}

let msgCounter = 0;
function nextId() {
  return `msg-${++msgCounter}`;
}

export default function SessionPage({ auth, session, onEnd }: Props) {
  // Show SessionSelector as overlay modal (not blocking chat)
  const [showSessionSelectorModal, setShowSessionSelectorModal] =
    useState(false);

  // Auto-load last session on mount
  const [autoLoadedLastSession, setAutoLoadedLastSession] = useState(false);
  const [isAutoLoadingLastSession, setIsAutoLoadingLastSession] =
    useState(false);

  // On mobile, default sidebars to closed
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<ShowImagePayload | null>(
    null,
  );

  // Track if we're loading a thread (from session selector)
  const [sourceThreadId, setSourceThreadId] = useState<string | null>(null);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const sessionsPromiseResolverRef = useRef<(sessions: any[]) => void>();

  // Handle window resize to auto-close sidebars on mobile
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      // Auto-close sidebars when resizing to mobile
      if (mobile) {
        setSidebarOpen(false);
        setRightPanelOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // File preview state
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    name: string;
    isSubject?: boolean;
    subjectId?: string;
  } | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [aiTyping, setAiTyping] = useState(false);
  const pendingMsgIdRef = useRef<string | null>(null);

  // Files attached from FileTree (dragged or clicked "Attach to Chat")
  const [attachedFileRefs, setAttachedFileRefs] = useState<AttachedFileRef[]>([]);
  // Images attached from FileTree (sent as base64 like Paperclip)
  const [attachedImageFromTree, setAttachedImageFromTree] = useState<{
    dataUrl: string;
    mimeType: string;
    name: string;
  } | null>(null);

  const handleAttachToChat = useCallback(async (path: string, name: string, isSubject?: boolean, subjectId?: string) => {
    // Check if it's an image
    const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(name);

    if (isImage) {
      // Fetch image from backend and convert to base64
      try {
        let blob: Blob;
        if (isSubject && subjectId) {
          // Subject file: use readSubjectFile API
          // Strip subject slug prefix from path to get relative path within subject
          const relativePath = path.startsWith(subjectId + '/') ? path.substring(subjectId.length + 1) : path;
          blob = await api.readSubjectFile(subjectId, relativePath, session.token);
        } else {
          // Student file: use readStudentFile API
          blob = await api.readStudentFile(session.session_id, path, session.token);
        }
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        setAttachedImageFromTree({
          dataUrl,
          mimeType: blob.type || 'image/png',
          name,
        });
      } catch (err) {
        console.error('Failed to load image for attach:', err);
        // Fallback to path reference
        setAttachedFileRefs(prev => {
          if (prev.some(f => f.path === path)) return prev;
          return [...prev, { path, name }];
        });
      }
    } else {
      // Non-image: attach as path reference
      setAttachedFileRefs(prev => {
        if (prev.some(f => f.path === path)) return prev;
        return [...prev, { path, name }];
      });
    }
  }, [session.session_id, session.token]);

  const handleRemoveAttachedFile = useCallback((path: string) => {
    setAttachedFileRefs(prev => prev.filter(f => f.path !== path));
  }, []);

  const handleRemoveAttachedImage = useCallback(() => {
    setAttachedImageFromTree(null);
  }, []);

  // Replay buffering (to avoid O(N²) re-renders during session load)
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const replayBufferRef = useRef<ChatMessage[]>([]);
  const isLoadingSessionRef = useRef(false); // Sync ref for immediate access in callbacks

  // Sessions loading state for the selector
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Model + token state (models come from backend via WebSocket)
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [activeModel, setActiveModel] = useState<string | undefined>(undefined);
  const [modelsLoadedFromBackend, setModelsLoadedFromBackend] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [sessionTokensUsed, setSessionTokensUsed] = useState(0);
  const [tokenContextSize, setTokenContextSize] = useState<number | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [tokenBlocked, setTokenBlocked] = useState(false);
  const [tokenBannerText, setTokenBannerText] = useState("");

  // Load current token usage and balance from server on mount
  // Load models and token state from backend on mount
  useEffect(() => {
    Promise.all([
      api.getSessionModels(session.session_id, session.token).then((r) => {
        setAvailableModels(r.models || []);
        setActiveModel(r.active || r.models?.[0] || undefined);
        setModelsLoadedFromBackend(true);
      }),
      api.getSessionTokenUsage(session.session_id, session.token).then((r) => {
        setTokenUsage(r);
        setSessionTokensUsed(r.total_tokens_used ?? 0);
      }),
      api.getMyTokenBalance(session.token).then((r) => {
        setTokenBalance(r.balance);
        // Block if balance is zero or negative
        if (r.balance <= 0) {
          setTokenBlocked(true);
          setTokenBannerText(
            "You have no tokens remaining. Please contact your instructor.",
          );
        }
      }),
    ]).catch(() => {});
  }, [session.session_id, session.token]);

  // Terminal write function set once xterm mounts
  const ptyWriteRef = useRef<((d: Uint8Array) => void) | null>(null);

  const handlePtyReady = useCallback(
    (
      write: (d: Uint8Array) => void,
      _resize: (cols: number, rows: number) => void,
    ) => {
      ptyWriteRef.current = write;
    },
    [],
  );

  const handlePtyData = useCallback((data: Uint8Array) => {
    ptyWriteRef.current?.(data);
  }, []);

  const handleImage = useCallback((p: ShowImagePayload) => {
    setLightboxImage(p);
  }, []);

  // ── Chat streaming callbacks ──────────────────────────────────────────────

  const handleChatStart = useCallback(() => {
    const id = nextId();
    pendingMsgIdRef.current = id;
    setAiTyping(true);

    const msg: ChatMessage = {
      id,
      role: "assistant",
      segments: [],
      pending: true,
    };

    if (isLoadingSessionRef.current) {
      // Buffer during replay
      replayBufferRef.current.push(msg);
    } else {
      // Live mode - add directly
      setMessages((prev) => [...prev, msg]);
    }
  }, []);

  const handleUserText = useCallback((text: string) => {
    // During LoadSession replay, user messages arrive here (not live input)
    const id = nextId();
    const msg: ChatMessage = {
      id,
      role: "user" as const,
      segments: [{ kind: "text" as const, content: text }],
      pending: false,
    };

    if (isLoadingSessionRef.current) {
      // Buffer during replay - O(N) instead of O(N²)
      replayBufferRef.current.push(msg);
    } else {
      // Live mode - add directly
      setMessages((prev) => [...prev, msg]);
    }
  }, []);

  const handleToolStart = useCallback((tool: string, command: string) => {
    const id = pendingMsgIdRef.current;

    if (isLoadingSessionRef.current) {
      // During replay, tools belong to the last assistant message
      const lastMsg =
        replayBufferRef.current[replayBufferRef.current.length - 1];
      if (lastMsg && lastMsg.role === "assistant" && !lastMsg.pending) {
        lastMsg.segments.push({
          kind: "tool" as const,
          tool,
          command,
          exitCode: 0,
          done: false,
          output: "",
        });
      } else {
        // No assistant message yet - create one for the tools
        const newMsg: ChatMessage = {
          id: nextId(),
          role: "assistant",
          segments: [
            {
              kind: "tool" as const,
              tool,
              command,
              exitCode: 0,
              done: false,
              output: "",
            },
          ],
          pending: false,
        };
        replayBufferRef.current.push(newMsg);
      }
      return;
    }

    // Live mode
    if (!id) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              segments: [
                ...m.segments,
                {
                  kind: "tool" as const,
                  tool,
                  command,
                  exitCode: 0,
                  done: false,
                  output: "",
                },
              ],
            }
          : m,
      ),
    );
  }, []);

  const handleToolEnd = useCallback(
    (exitCode: number, stdout: string, stderr: string) => {
      if (isLoadingSessionRef.current) {
        // During replay, update the last undone tool in the last assistant message
        const lastMsg =
          replayBufferRef.current[replayBufferRef.current.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          const lastIdx = lastMsg.segments.reduce<number>(
            (acc, seg, i) => (seg.kind === "tool" && !seg.done ? i : acc),
            -1,
          );
          if (lastIdx !== -1) {
            const seg = lastMsg.segments[lastIdx];
            if (seg.kind === "tool") {
              const output = (
                stdout + (stderr ? "\n[stderr]\n" + stderr : "")
              ).trimEnd();
              lastMsg.segments[lastIdx] = {
                kind: "tool" as const,
                tool: seg.tool,
                command: seg.command,
                exitCode,
                done: true,
                output,
              };
            }
          }
        }
        return;
      }

      // Live mode
      const id = pendingMsgIdRef.current;
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          // Update the last undone tool segment.
          const lastIdx = m.segments.reduce<number>(
            (acc, seg, i) => (seg.kind === "tool" && !seg.done ? i : acc),
            -1,
          );
          if (lastIdx === -1) return m;
          const segs = m.segments.map((seg, i) => {
            if (i === lastIdx && seg.kind === "tool") {
              const output = (
                stdout + (stderr ? "\n[stderr]\n" + stderr : "")
              ).trimEnd();
              return {
                kind: "tool" as const,
                tool: seg.tool,
                command: seg.command,
                exitCode,
                done: true,
                output,
              };
            }
            return seg;
          });
          return { ...m, segments: segs };
        }),
      );
    },
    [],
  );

  const handleAssistantText = useCallback((text: string) => {
    // During replay, Goose sends AgentMessageChunk WITHOUT chat_start
    // We need to create assistant messages on-the-fly
    if (isLoadingSessionRef.current) {
      const lastMsg =
        replayBufferRef.current[replayBufferRef.current.length - 1];

      // Check if last message is assistant and can accept more text
      if (lastMsg && lastMsg.role === "assistant" && !lastMsg.pending) {
        // Same assistant message - append text
        const lastSeg = lastMsg.segments[lastMsg.segments.length - 1];
        if (lastSeg && lastSeg.kind === "text") {
          // Replace the last segment with updated content
          lastMsg.segments[lastMsg.segments.length - 1] = {
            kind: "text",
            content: lastSeg.content + text,
          };
        } else {
          lastMsg.segments.push({ kind: "text", content: text });
        }
      } else {
        // New assistant message needed (replay doesn't send chat_start)
        const newMsg: ChatMessage = {
          id: nextId(),
          role: "assistant",
          segments: [{ kind: "text", content: text }],
          pending: false, // Replay messages are complete
        };
        replayBufferRef.current.push(newMsg);
      }
      return;
    }

    // Live mode processing below
    const id = pendingMsgIdRef.current;
    if (!id) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const segs = [...m.segments];
        const last = segs[segs.length - 1];
        if (last && last.kind === "text") {
          segs[segs.length - 1] = {
            kind: "text" as const,
            content: last.content + text,
          };
        } else {
          segs.push({ kind: "text" as const, content: text });
        }
        return { ...m, segments: segs };
      }),
    );
  }, []);

  const handleChatEnd = useCallback(() => {
    const id = pendingMsgIdRef.current;
    if (id) {
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === id ? { ...m, pending: false } : m,
        );
        return updated;
      });
      pendingMsgIdRef.current = null;
    }
    setAiTyping(false);
  }, []);

  const handleTokenUsage = useCallback((usage: TurnTokenUsage) => {
    // Legacy WS format fallback; merged total is sourced from backend `used` updates.
    setTokenUsage((prev) =>
      prev
        ? {
            total_input_tokens: prev.total_input_tokens + usage.input_tokens,
            total_output_tokens: prev.total_output_tokens + usage.output_tokens,
            total_cache_creation_tokens:
              prev.total_cache_creation_tokens +
              usage.cache_creation_input_tokens,
            total_cache_read_tokens:
              prev.total_cache_read_tokens + usage.cache_read_input_tokens,
            total_tokens_used: prev.total_tokens_used,
            turn_count: prev.turn_count + 1,
          }
        : {
            total_tokens_used: 0,
            total_input_tokens: usage.input_tokens,
            total_output_tokens: usage.output_tokens,
            total_cache_creation_tokens: usage.cache_creation_input_tokens,
            total_cache_read_tokens: usage.cache_read_input_tokens,
            turn_count: 1,
          },
    );
    // Update active model if reported
    if (usage.model) setActiveModel(usage.model);
  }, []);

  const handleTokenUsageUpdate = useCallback((update: any) => {
    // New WS format from backend/goose: cumulative used tokens.
    if (typeof update.used === "number") {
      setSessionTokensUsed(update.used);
    }
    if (typeof update.size === "number") {
      setTokenContextSize(update.size);
    }

    // Handle balance update from WebSocket
    if (update.balance !== undefined) {
      setTokenBalance(update.balance);
      // Block if balance becomes zero or negative
      if (update.balance <= 0) {
        setTokenBlocked(true);
        setTokenBannerText(
          "You have no tokens remaining. Please contact your instructor.",
        );
      }
    }
  }, []);

  const handleTokenLimitReached = useCallback((banner: string) => {
    setTokenBlocked(true);
    setTokenBannerText(banner);
  }, []);

  const handleModelChanged = useCallback((model: string) => {
    setActiveModel(model);
  }, []);

  const handleModelsReceived = useCallback(
    (models: string[], active: string) => {
      // Only update models from WebSocket if we haven't loaded them from the backend.
      // This ensures student-specific model restrictions from DB take priority over Goose defaults.
      if (!modelsLoadedFromBackend) {
        setAvailableModels(models);
        // Use backend's active model if provided; otherwise first available (or undefined if empty)
        setActiveModel(active || models[0] || undefined);
      }
    },
    [modelsLoadedFromBackend],
  );

  const handleForkSessionComplete = useCallback((newSessionId: string) => {
    // After fork completes, auto-load the forked session
    setSourceThreadId(newSessionId);
  }, []);

  const handleSessionsListReceived = useCallback((sessions: any[]) => {
    if (sessionsPromiseResolverRef.current) {
      sessionsPromiseResolverRef.current(sessions);
      sessionsPromiseResolverRef.current = undefined;
    }
    setSessionsLoading(false);
  }, []);

  const handleLoadSessionComplete = useCallback(() => {
    // Flush replay buffer - create new copies to ensure React detects changes
    if (replayBufferRef.current.length > 0) {
      const messages = replayBufferRef.current.map((msg) => ({
        ...msg,
        segments: [...msg.segments], // Create new array reference
      }));
      setMessages(messages);
    }

    replayBufferRef.current = [];
    isLoadingSessionRef.current = false;
    setIsLoadingSession(false);
  }, []);

  // Safety net: if replay takes too long, exit loading mode
  useEffect(() => {
    if (!isLoadingSession) return;

    const timeout = setTimeout(() => {
      if (replayBufferRef.current.length > 0) {
        setMessages(replayBufferRef.current);
        replayBufferRef.current = [];
      }
      isLoadingSessionRef.current = false;
      setIsLoadingSession(false);
    }, 10000); // 10 second timeout

    return () => clearTimeout(timeout);
  }, [isLoadingSession]);

  const {
    status,
    sendInput,
    sendInputWithImage,
    sendResize,
    sendCancel,
    sendGetModels,
    sendListSessions,
    sendLoadSession,
    sendForkSession,
  } = useWebSocket({
    sessionId: session.session_id,
    token: session.token,
    onPtyData: handlePtyData,
    onImage: handleImage,
    onChatStart: handleChatStart,
    onUserText: handleUserText,
    onToolStart: handleToolStart,
    onToolEnd: handleToolEnd,
    onAssistantText: handleAssistantText,
    onChatEnd: handleChatEnd,
    onTokenUsage: handleTokenUsage,
    onTokenUsageUpdate: handleTokenUsageUpdate,
    onTokenLimitReached: handleTokenLimitReached,
    onModelChanged: handleModelChanged,
    onModelsReceived: handleModelsReceived,
    onSessionsListReceived: handleSessionsListReceived,
    onForkSessionComplete: handleForkSessionComplete,
    onLoadSessionComplete: handleLoadSessionComplete,
  });

  // Auto-load the last session on first connection
  useEffect(() => {
    if (
      status !== "connected" ||
      autoLoadedLastSession ||
      isAutoLoadingLastSession
    )
      return;

    setIsAutoLoadingLastSession(true);

    // Fetch session list and load the most recent one
    const autoLoadLastSession = async () => {
      try {
        const sessions = await new Promise<any[]>((resolve) => {
          const resolver = (sessions: any[]) => {
            sessionsPromiseResolverRef.current = undefined;
            resolve(sessions);
          };
          sessionsPromiseResolverRef.current = resolver;
          sendListSessions();
        });

        if (sessions.length > 0) {
          // Skip sessions with 0 messages (likely just-created empty sessions)
          const sessionsWithMessages = sessions.filter((s: any) => {
            // Check if session has messages (message_count from Goose meta, or assume yes if not provided)
            const messageCount =
              s.message_count ?? s.metadata?.messageCount ?? 1;
            return messageCount > 0;
          });

          if (sessionsWithMessages.length > 0) {
            const lastSession = sessionsWithMessages[0]; // Most recent with messages
            setSourceThreadId(lastSession.id);
            setIsLoadingThread(true);
          }
        }
      } catch (err) {
        console.error("Failed to auto-load last session:", err);
      } finally {
        setAutoLoadedLastSession(true);
        setIsAutoLoadingLastSession(false);
      }
    };

    autoLoadLastSession();
  }, [
    status,
    autoLoadedLastSession,
    isAutoLoadingLastSession,
    sendListSessions,
  ]);

  // Trigger load when we have a thread to load (from session selector or auto-load)
  useEffect(() => {
    if (status !== "connected" || !isLoadingThread || !sourceThreadId) return;

    setMessages([]); // Clear messages before loading session history
    replayBufferRef.current = []; // Clear replay buffer
    isLoadingSessionRef.current = true; // Set ref FIRST for immediate effect
    setIsLoadingSession(true); // Then set state for UI

    const sent = sendLoadSession(sourceThreadId);
    if (!sent) {
      isLoadingSessionRef.current = false;
      setIsLoadingSession(false); // Exit replay mode on failure
    }
    setIsLoadingThread(false);
  }, [status, isLoadingThread, sourceThreadId, sendLoadSession]);

  // Request available models from goose once connected
  useEffect(() => {
    if (status === "connected") {
      sendGetModels();
    }
  }, [status, sendGetModels]);

  // Patch handleSend to use the real sendInput (avoid closure ordering issue)
  const handleSendWithWs = useCallback(
    (text: string) => {
      const msg: ChatMessage = {
        id: nextId(),
        role: "user" as const,
        segments: [{ kind: "text" as const, content: text }],
        pending: false,
      };
      setMessages((prev) => [...prev, msg]);
      sendInput(text + "\n");

      // Refetch token balance after sending (will update once response is processed)
      setTimeout(() => {
        api
          .getMyTokenBalance(session.token)
          .then((r) => {
            setTokenBalance(r.balance);
            // Unblock if balance is positive again
            if (r.balance > 0) {
              setTokenBlocked(false);
              setTokenBannerText("");
            }
          })
          .catch(() => {});
      }, 1000);
    },
    [sendInput, session.token],
  );

  // Handle sending with image attachment
  const handleSendWithImage = useCallback(
    (text: string, imageDataUrl?: string, mimeType?: string) => {
      const segments: MessageSegment[] = [];
      if (text) {
        segments.push({ kind: "text" as const, content: text });
      }
      if (imageDataUrl) {
        segments.push({
          kind: "image" as const,
          dataUrl: imageDataUrl,
          mimeType: mimeType || "image/png",
        });
      }
      const msg: ChatMessage = {
        id: nextId(),
        role: "user" as const,
        segments,
        pending: false,
      };
      setMessages((prev) => [...prev, msg]);
      if (imageDataUrl) {
        sendInputWithImage(text + "\n", imageDataUrl, mimeType);
      } else {
        sendInput(text + "\n");
      }
    },
    [sendInput, sendInputWithImage],
  );

  // Handle file uploads to student workspace
  const handleFilesForUpload = useCallback(
    async (files: any[]) => {
      for (const file of files) {
        if (file.fileType !== "other") continue;

        try {
          // Read file as text - backend will handle both text and binary content
          const fileContent = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsText(file.file, "latin1");
          });

          // Upload to workspace under /uploads directory
          const relativePath = `uploads/${file.file.name}`;
          await api.uploadStudentFile(
            session.session_id,
            relativePath,
            fileContent,
            session.token,
          );
        } catch (err) {}
      }
    },
    [session.session_id, session.token],
  );

  // Switch model: call API (writes pending_model.txt) + update local UI immediately
  const handleModelChange = useCallback(
    async (model: string) => {
      setActiveModel(model);
      try {
        await api.setSessionModel(session.session_id, session.token, model);
      } catch {
        // Non-critical — the /model inject will be retried on next reconnect
      }
    },
    [session.session_id, session.token],
  );

  // ── SessionSelector Handlers (modal overlay) ────────────────────────────

  const handleSessionSelectorListSessions = async (): Promise<any[]> => {
    return new Promise((resolve) => {
      sessionsPromiseResolverRef.current = resolve;
      setSessionsLoading(true);
      sendListSessions();
    });
  };

  const handleSessionSelectorNewSession = () => {
    setShowSessionSelectorModal(false);
    // Chat area keeps running, nothing to load
  };

  const handleSessionSelectorLoadSession = (threadId: string) => {
    setShowSessionSelectorModal(false);
    setSourceThreadId(threadId);
    setIsLoadingThread(true);
    // useEffect will send LoadSession when connected
  };

  const handleSessionSelectorForkSession = (threadId: string) => {
    setShowSessionSelectorModal(false);
    // Direct fork - don't use sourceThreadId, send fork directly
    if (status === "connected") {
      sendForkSession(threadId);
    } else {
      // If not connected yet, queue fork via sourceThreadId
      setSourceThreadId(threadId);
      setIsLoadingThread(true);
      // Special flag to indicate this should fork, not load
    }
  };

  async function handleEndSession() {
    if (!confirm("End this session? Your progress is saved.")) return;
    await api.endSession(session.session_id, session.token).catch(() => {});
    onEnd();
  }

  return (
    <div className="flex flex-col h-screen bg-wp-page">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="shrink-0 h-12 md:h-14 bg-wp-surface border-b border-wp-border-mid flex items-center px-2 md:px-4 gap-2 md:gap-4 shadow-sm">
        <div className="flex items-center gap-1 md:gap-2 mr-1 md:mr-2">
          <GraduationCap className="w-4 h-4 md:w-5 md:h-5 text-wp-accent" />
          <span className="hidden sm:inline font-bold text-wp-text-primary text-xs md:text-sm">
            EduClaw
          </span>
        </div>

        <span className="hidden sm:inline px-2 md:px-2.5 py-0.5 rounded-full bg-wp-accent-subtle text-wp-accent text-xs font-medium">
          {auth.cohort_id || "no cohort"}
        </span>

        <StatusDot status={status} />

        {/* Hamburger menu for files on mobile */}
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          title={sidebarOpen ? "Close files menu" : "Open files menu"}
          className={`md:hidden flex items-center gap-2 px-3 py-1.5 rounded-wp-md font-semibold transition-all duration-200
            ${
              sidebarOpen
                ? "bg-wp-accent text-white shadow-md"
                : "bg-wp-surface text-wp-accent hover:bg-wp-accent-subtle"
            }`}
        >
          <Menu className="w-5 h-5" />
          <span className="text-xs">Files</span>
        </button>

        <div className="flex-1" />

        <div className="hidden md:flex items-center gap-2 text-sm text-wp-text-secondary">
          <User className="w-4 h-4" />
          <span>{auth.display_name}</span>
        </div>

        {/* Toggle file browser — desktop/tablet only */}
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          title={sidebarOpen ? "Hide files" : "Show files"}
          className={`hidden sm:flex items-center gap-1 md:gap-2 px-2 md:px-2.5 py-1.5 md:py-2 rounded-wp-md text-sm font-semibold transition-all duration-200
            ${
              sidebarOpen
                ? "bg-wp-accent text-white shadow-md"
                : "bg-wp-surface hover:bg-wp-accent-subtle text-wp-accent hover:text-wp-accent-hover"
            }`}
        >
          <Files className="w-5 h-5 md:w-5 md:h-5" />
          <span className="text-xs md:text-sm">Files</span>
        </button>

        {/* Toggle assignment progress — desktop only */}
        <button
          onClick={() => setRightPanelOpen((o) => !o)}
          title={rightPanelOpen ? "Hide progress" : "Show progress"}
          className={`hidden md:flex items-center gap-2 px-2.5 py-2 rounded-wp-md text-sm font-semibold transition-all duration-200
            ${
              rightPanelOpen
                ? "bg-wp-accent text-white shadow-md"
                : "bg-wp-surface hover:bg-wp-accent-subtle text-wp-accent hover:text-wp-accent-hover"
            }`}
        >
          <BarChart3 className="w-5 h-5" />
          <span className="text-sm">Progress</span>
        </button>

        {/* Browse sessions */}
        <button
          onClick={() => setShowSessionSelectorModal(true)}
          title="Browse and switch sessions"
          className="hidden sm:flex items-center gap-1 md:gap-2 px-2 md:px-2.5 py-1.5 md:py-2 rounded-wp-md text-sm font-semibold transition-all duration-200 bg-wp-accent hover:bg-wp-accent-hover text-wp-text-on-accent shadow-sm hover:shadow-md"
        >
          <BookOpen className="w-5 h-5 md:w-5 md:h-5" />
          <span className="text-xs md:text-sm">Sessions</span>
        </button>

        {/* End session */}
        <button
          onClick={handleEndSession}
          className="px-2 md:px-3 py-1.5 md:py-2 rounded-wp-md bg-wp-error hover:bg-wp-error/80 active:bg-wp-error/70 text-wp-text-on-accent text-xs md:text-sm font-semibold transition-all"
        >
          <span className="hidden sm:inline">End session</span>
          <span className="sm:hidden">End</span>
        </button>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — file browser */}
        {sidebarOpen && (
          <aside className="w-56 sm:w-60 md:w-72 shrink-0 bg-wp-surface-alt border-r border-wp-border-mid flex flex-col overflow-hidden">
            <div className="px-3 md:px-4 pt-2 md:pt-3 pb-1.5 text-xs font-semibold text-wp-text-secondary uppercase tracking-wider flex items-center gap-1">
              <Folder className="w-3 h-3" /> Files
            </div>
            <div className="flex-1 overflow-hidden">
              <FileTree
                token={session.token}
                sessionId={session.session_id}
                subjectIds={auth.subject_ids}
                onFileSelect={(path, name, tab, subjectId) => {
                  setSelectedFile({
                    path,
                    name,
                    isSubject: tab === "subject",
                    subjectId,
                  });
                }}
                onAttachToChat={handleAttachToChat}
              />
            </div>
          </aside>
        )}

        {/* Centre — Chat + collapsible terminal */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Chat panel — primary, fills available space */}
          <div className="flex-1 overflow-hidden bg-wp-page">
              <ChatPanel
                messages={messages}
                inputValue={chatInput}
                onInputChange={setChatInput}
                onSend={handleSendWithWs}
                onSendWithImage={handleSendWithImage}
                onFilesForUpload={handleFilesForUpload}
                onCancel={sendCancel}
                disabled={status !== "connected" || aiTyping}
                availableModels={availableModels}
                activeModel={activeModel}
                onModelChange={handleModelChange}
                tokenUsage={tokenUsage}
                sessionTokensUsed={sessionTokensUsed}
                tokenContextSize={tokenContextSize}
                tokenBalance={tokenBalance}
                tokenBlocked={tokenBlocked}
                tokenBannerText={tokenBannerText}
                sessionId={session.session_id}
                token={session.token}
                onFileSelect={(path, name) =>
                  setSelectedFile({ path, name, isSubject: false })
                }
                attachedFileRefs={attachedFileRefs}
                onRemoveAttachedFile={handleRemoveAttachedFile}
                attachedImageFromTree={attachedImageFromTree}
                onRemoveAttachedImage={handleRemoveAttachedImage}
                onAttachToChat={handleAttachToChat}
              />
          </div>

          {/* Terminal — collapsed by default, toggled open */}
          <div className="shrink-0 border-t border-wp-border-mid bg-wp-inset">
            {/* Toggle bar */}
            <button
              className="w-full flex items-center justify-between px-4 py-2 text-xs text-wp-text-tertiary hover:text-wp-text-secondary hover:bg-wp-surface-alt transition-colors"
              onClick={() => setTerminalOpen((o) => !o)}
            >
              <span className="flex items-center gap-2">
                <span className="font-mono">
                  {terminalOpen ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </span>
                <span className="font-mono">Terminal</span>
                <span className="text-wp-text-secondary">
                  — shell & code execution
                </span>
              </span>
              <span className="text-wp-text-secondary text-[10px]">
                {terminalOpen ? "Click to collapse" : "Click to expand"}
              </span>
            </button>

            {/* xterm.js — always mounted, just hidden when closed so PTY stream is preserved */}
            <div
              className={`overflow-hidden transition-all duration-200 ${terminalOpen ? "h-40 md:h-64" : "h-0"}`}
            >
              <TutorTerminal
                onPtyReady={handlePtyReady}
                onInput={sendInput}
                onResize={sendResize}
              />
            </div>
          </div>
        </main>

        {/* Right panel — assignment progress */}
        {rightPanelOpen && (
          <aside className="w-56 sm:w-60 md:w-72 shrink-0 bg-wp-surface-alt border-l border-wp-border-mid flex flex-col overflow-hidden">
            <div className="px-3 md:px-4 pt-2 md:pt-3 pb-1.5 text-xs font-semibold text-wp-text-secondary uppercase tracking-wider">
              📊 Progress
            </div>
            <div className="flex-1 overflow-y-auto">
              <AssignmentPanel
                sessionId={session.session_id}
                token={session.token}
              />
            </div>
          </aside>
        )}
      </div>

      {/* ── Session Selector Modal Overlay ──────────────────────────────── */}
      {showSessionSelectorModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-wp-bgSurface rounded-lg shadow-xl w-full max-w-sm max-h-[70vh] flex flex-col border border-wp-borderMid">
            <div className="flex items-center justify-between px-6 py-4 border-b border-wp-borderMid">
              <h2 className="text-lg font-bold text-wp-textPrimary">
                Sessions
              </h2>
              <button
                onClick={() => setShowSessionSelectorModal(false)}
                className="text-wp-textSecondary hover:text-wp-textPrimary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <SessionSelector
                onNewSession={handleSessionSelectorNewSession}
                onLoadSession={handleSessionSelectorLoadSession}
                onForkSession={handleSessionSelectorForkSession}
                onListSessions={handleSessionSelectorListSessions}
                isLoading={sessionsLoading}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Image lightbox ───────────────────────────────────────────────── */}
      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="bg-wp-surface rounded-wp-xl max-w-3xl max-h-[85vh] overflow-hidden border border-wp-border-mid"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-wp-border-mid">
              <span className="text-sm font-medium text-wp-text-primary truncate">
                {lightboxImage.path.split("/").pop()}
              </span>
              <button
                onClick={() => setLightboxImage(null)}
                className="text-wp-text-tertiary hover:text-wp-text-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-auto p-4">
              <img
                src={lightboxImage.data_url}
                alt="Figure"
                className="max-w-full h-auto rounded"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── File preview modal ───────────────────────────────────────────── */}
      <DraggableModal
        isOpen={!!selectedFile}
        onClose={() => setSelectedFile(null)}
        title={selectedFile?.name || "File Preview"}
      >
        {selectedFile && (
          <FilePreview
            fileName={selectedFile.name}
            filePath={selectedFile.path}
            sessionId={session.session_id}
            token={session.token}
            isSubjectFile={selectedFile.isSubject}
            subjectId={selectedFile.subjectId}
            onClose={() => setSelectedFile(null)}
          />
        )}
      </DraggableModal>
    </div>
  );
}
