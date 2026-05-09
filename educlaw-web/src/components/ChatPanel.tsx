import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Send,
  Square,
  Zap,
  AlertCircle,
  Bot,
  Paperclip,
  X,
  Brain,
  Eye,
} from "lucide-react";
import type {
  ChatMessage,
  MessageSegment,
  TokenUsage,
  Model,
} from "../api/types";
import type { AttachedFileRef } from "../pages/SessionPage";
import ToolCallCard from "./ToolCallCard";
import ChatFilePreview from "./ChatFilePreview";
import FileInputAttachment, {
  type AttachedFile,
  type FileInputAttachmentHandle,
} from "./FileInputAttachment";
import UserMessageBubble from "./UserMessageBubble";

interface Props {
  messages: ChatMessage[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onSend: (text: string) => void;
  onSendWithImage?: (
    text: string,
    imageDataUrl?: string,
    mimeType?: string,
  ) => void;
  onFilesForUpload?: (files: AttachedFile[]) => void;
  onCancel?: () => void;
  disabled: boolean;
  // model selector
  availableModels?: Model[];
  activeModel?: string;
  onModelChange?: (model: string) => void;
  // token usage
  tokenUsage?: TokenUsage | null;
  tokenBalance?: number | null;
  sessionTokensUsed?: number;
  tokenContextSize?: number | null;
  // block state
  tokenBlocked?: boolean;
  tokenBannerText?: string;
  // file system
  sessionId?: string;
  token?: string;
  onFileSelect?: (
    path: string,
    name: string,
    isSubject?: boolean,
    subjectId?: string,
  ) => void;
  // Files attached from FileTree (non-image)
  attachedFileRefs?: AttachedFileRef[];
  onRemoveAttachedFile?: (path: string) => void;
  // Image attached from FileTree (sent as base64)
  attachedImageFromTree?: {
    dataUrl: string;
    mimeType: string;
    name: string;
  } | null;
  onRemoveAttachedImage?: () => void;
  // Callback to attach file from drop (SessionPage handles image vs non-image)
  onAttachToChat?: (
    path: string,
    name: string,
    isSubject?: boolean,
    subjectId?: string,
  ) => void;
}

// Shared code-block renderer for ReactMarkdown.
const mdCode = ({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"code">) => {
  const match = /language-(\w+)/.exec(className ?? "");
  if (match) {
    return (
      <SyntaxHighlighter
        style={oneDark}
        language={match[1]}
        PreTag="div"
        customStyle={{
          borderRadius: "0.5rem",
          fontSize: "0.78rem",
          margin: "0.5rem 0",
        }}
      >
        {String(children).replace(/\n$/, "")}
      </SyntaxHighlighter>
    );
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
};

// Custom image renderer that detects files in the system
function createMdImage(
  sessionId?: string,
  token?: string,
  onFileSelect?: (path: string, name: string) => void,
) {
  return function MdImage({ src, alt }: React.ComponentPropsWithoutRef<"img">) {
    // Extract filename from src (handles paths like "./file.png", "file.png", etc.)
    const fileName = src?.split("/").pop() || "";

    if (!sessionId || !token || !onFileSelect) {
      return (
        <img
          src={src}
          alt={alt}
          className="rounded-wp-md border border-wp-border-mid max-w-full h-auto"
        />
      );
    }

    // Show file preview instead of image
    return (
      <div className="my-3">
        <ChatFilePreview
          fileName={fileName}
          sessionId={sessionId}
          token={token}
          onOpenFile={(path, name) => onFileSelect(path, name)}
        />
      </div>
    );
  };
}

// Renders one segment: tool card or markdown text.
interface SegmentViewProps {
  seg: MessageSegment;
  sessionId?: string;
  token?: string;
  onFileSelect?: (
    path: string,
    name: string,
    isSubject?: boolean,
    subjectId?: string,
  ) => void;
}

function SegmentView({
  seg,
  sessionId,
  token,
  onFileSelect,
}: SegmentViewProps) {
  if (seg.kind === "tool") return <ToolCallCard seg={seg} />;
  if (seg.kind === "image") {
    return (
      <img
        src={seg.dataUrl}
        alt="Attached image"
        className="rounded-wp-md border border-wp-border-mid max-w-full h-auto my-2 shadow-sm"
      />
    );
  }

  // Text segment
  return (
    <div className="markdown-body mt-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: mdCode,
          img: createMdImage(
            sessionId,
            token,
            onFileSelect
              ? (path, name) => onFileSelect(path, name, false)
              : undefined,
          ),
        }}
      >
        {seg.content}
      </ReactMarkdown>
    </div>
  );
}

// A single message bubble.
interface MessageBubbleProps {
  msg: ChatMessage;
  sessionId?: string;
  token?: string;
  onFileSelect?: (
    path: string,
    name: string,
    isSubject?: boolean,
    subjectId?: string,
  ) => void;
}

function MessageBubble({
  msg,
  sessionId,
  token,
  onFileSelect,
}: MessageBubbleProps) {
  const isUser = msg.role === "user";

  // Use dedicated UserMessageBubble component for user messages
  if (isUser) {
    return <UserMessageBubble msg={msg} />;
  }

  // AI message rendering
  return (
    <div className="flex gap-3 flex-row items-start">
      {/* Avatar - animate when AI is responding */}
      <div
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all
        bg-wp-accent text-wp-text-on-accent ${msg.pending ? "animate-pulse scale-110" : ""}`}
      >
        <Bot className={`w-5 h-5 ${msg.pending ? "animate-spin" : ""}`} />
      </div>

      {/* Bubble */}
      <div
        className={`max-w-xs sm:max-w-sm md:max-w-xl lg:max-w-2xl rounded-wp-xl px-5 py-4 leading-relaxed transition-all
        bg-wp-surface border border-wp-border-mid text-wp-text-primary rounded-tl-wp-sm text-base ${msg.pending ? "ring-2 ring-wp-accent ring-opacity-50" : ""}`}
      >
        <div
          className="prose max-w-none
          prose-headings:font-bold prose-headings:text-wp-text-primary
          prose-h1:text-lg prose-h2:text-base prose-h3:text-[15px]
          prose-p:text-wp-text-primary prose-p:my-2 prose-p:leading-relaxed prose-p:text-base
          prose-ul:my-2 prose-ul:text-wp-text-primary prose-ul:text-base
          prose-ol:my-2 prose-ol:text-wp-text-primary prose-ol:text-base
          prose-li:my-1 prose-li:text-base
          prose-strong:font-bold prose-strong:text-wp-text-primary
          prose-em:text-wp-text-secondary
          prose-blockquote:border-l-4 prose-blockquote:border-wp-accent
          prose-blockquote:bg-wp-accent-subtle prose-blockquote:pl-4
          prose-blockquote:py-2 prose-blockquote:my-3 prose-blockquote:rounded-r
          prose-blockquote:text-wp-text-primary prose-blockquote:text-base
          prose-a:text-wp-accent prose-a:underline prose-a:hover:text-wp-accent-hover
          prose-table:my-4 prose-table:border-collapse prose-table:text-base
          prose-thead:bg-wp-accent-subtle
          prose-th:border prose-th:border-wp-border-mid prose-th:px-3 prose-th:py-2 prose-th:font-semibold prose-th:text-left prose-th:text-base
          prose-td:border prose-td:border-wp-border-soft prose-td:px-3 prose-td:py-2 prose-td:text-base
           prose-pre:bg-wp-inset prose-pre:text-wp-text-primary prose-pre:overflow-x-auto prose-pre:rounded-wp-lg prose-pre:my-3 prose-pre:p-4 prose-pre:text-sm
          prose-hr:border-wp-border-mid prose-hr:my-4
          prose-code:font-mono prose-code:text-wp-accent prose-code:bg-wp-accent-subtle prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm"
        >
          {msg.segments.length === 0 && msg.pending && (
            <span className="inline-block w-1.5 h-4 bg-wp-accent animate-pulse rounded-sm align-middle" />
          )}
          {msg.segments.map((seg, i) => (
            <SegmentView
              key={`${msg.id}-seg-${i}-${seg.kind}`}
              seg={seg}
              sessionId={sessionId}
              token={token}
              onFileSelect={onFileSelect}
            />
          ))}
          {msg.pending && (
            <span className="inline-block w-1.5 h-4 bg-wp-accent animate-pulse ml-0.5 rounded-sm align-middle" />
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatPanel({
  messages,
  inputValue,
  onInputChange,
  onSend,
  onSendWithImage,
  onFilesForUpload,
  onCancel,
  disabled,
  availableModels,
  activeModel,
  onModelChange,
  tokenUsage,
  tokenBalance,
  sessionTokensUsed,
  tokenContextSize,
  tokenBlocked,
  tokenBannerText,
  sessionId,
  token,
  onFileSelect,
  attachedFileRefs,
  onRemoveAttachedFile,
  attachedImageFromTree,
  onRemoveAttachedImage,
  onAttachToChat,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputAttachmentRef = useRef<FileInputAttachmentHandle>(null);

  const derivedUsedTokens = sessionTokensUsed ?? 0;
  const [attachedImage, setAttachedImage] = useState<AttachedFile | null>(null);
  const [filesToUpload, setFilesToUpload] = useState<AttachedFile[]>([]);

  // Drag-over state for attaching files from FileTree
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Drag-over handlers for files from FileTree
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only set false if leaving the container, not entering a child
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const fileData = e.dataTransfer.getData("application/educlaw-file");
      if (fileData) {
        try {
          const { path, name, isSubject, subjectId } = JSON.parse(fileData);
          // Use onAttachToChat to properly handle image vs non-image
          onAttachToChat?.(path, name, isSubject, subjectId);
        } catch (err) {
          console.error("Failed to parse dropped file data:", err);
        }
      }
    },
    [onAttachToChat],
  );

  const handleImageSelected = useCallback((file: AttachedFile | null) => {
    setAttachedImage(file);
  }, []);

  const handleFilesReadyForUpload = useCallback((files: AttachedFile[]) => {
    setFilesToUpload(files);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  }

  function doSend() {
    let text = inputValue.trim();

    // Include attached file references from FileTree in the message
    if (attachedFileRefs && attachedFileRefs.length > 0) {
      const fileRefsText = attachedFileRefs
        .map((f) => `\`${f.path}\``)
        .join(", ");
      text = text
        ? `${text}\n\nFile Attached: ${fileRefsText}`
        : `File Attached: ${fileRefsText}`;
    }

    // Handle image from FileTree (sent as base64)
    if (attachedImageFromTree && onSendWithImage) {
      onSendWithImage(
        text,
        attachedImageFromTree.dataUrl,
        attachedImageFromTree.mimeType,
      );
      onInputChange("");
      setAttachedImage(null);
      setFilesToUpload([]);
      fileInputAttachmentRef.current?.clearAll();
      onRemoveAttachedImage?.();
      // Clear attached file refs after sending
      if (attachedFileRefs && attachedFileRefs.length > 0) {
        attachedFileRefs.forEach((f) => onRemoveAttachedFile?.(f.path));
      }
      setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }

    if (!text && !attachedImage && filesToUpload.length === 0) return;
    if (
      disabled ||
      tokenBlocked ||
      (tokenBalance !== undefined && tokenBalance !== null && tokenBalance <= 0)
    )
      return;

    // If there's an attached image (Paperclip) and onSendWithImage is provided, use it
    if (attachedImage && onSendWithImage) {
      onSendWithImage(text, attachedImage.dataUrl, attachedImage.mimeType);
    } else {
      // Otherwise use regular send
      onSend(text);
    }

    // Upload files if present
    if (filesToUpload.length > 0 && onFilesForUpload) {
      onFilesForUpload(filesToUpload);
    }

    onInputChange("");
    setAttachedImage(null);
    setFilesToUpload([]);
    fileInputAttachmentRef.current?.clearAll();
    // Clear attached file refs after sending
    if (attachedFileRefs && attachedFileRefs.length > 0) {
      attachedFileRefs.forEach((f) => onRemoveAttachedFile?.(f.path));
    }
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Top bar: compact token info ─────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 md:gap-4 px-3 md:px-4 py-1.5 md:py-2 bg-wp-surface border-b border-wp-border-mid flex-wrap">
        {/* Model selector */}
        {availableModels && availableModels.length > 0 ? (
          <div className="flex items-center gap-1.5 md:gap-2">
            <span className="text-[10px] md:text-xs font-semibold text-wp-text-secondary uppercase tracking-wide">
              Model
            </span>
            <div className="flex items-center gap-1">
              <select
                value={activeModel ?? availableModels[0].name}
                onChange={(e) => onModelChange?.(e.target.value)}
                disabled={disabled}
                className="text-[10px] md:text-xs font-semibold text-wp-accent bg-wp-accent-subtle border border-wp-border-mid
                  rounded-wp-md px-2 py-0.5 md:py-1 focus:outline-none focus:ring-2 focus:ring-wp-accent
                  disabled:opacity-60 cursor-pointer transition-all"
              >
                {availableModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.display_name}
                  </option>
                ))}
              </select>
              {/* Show capability icons for active model */}
              {availableModels.find(
                (m) => m.name === (activeModel ?? availableModels[0].name),
              )?.think_mode === 1 && (
                <Brain className="w-3 h-3 md:w-3.5 md:h-3.5 text-wp-info shrink-0" />
              )}
              {availableModels.find(
                (m) => m.name === (activeModel ?? availableModels[0].name),
              )?.visual_support === 1 && (
                <Eye className="w-3 h-3 md:w-3.5 md:h-3.5 text-wp-accent shrink-0" />
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-wp-text-secondary uppercase tracking-wide">
              Model
            </span>
            <span className="text-xs text-wp-text-tertiary italic">
              Loading...
            </span>
          </div>
        )}

        {/* Compact token info: Balance:34556tkn 67979/2,000,000tkn */}
        {((sessionTokensUsed ?? 0) > 0 ||
          !!tokenUsage ||
          (tokenBalance !== undefined && tokenBalance !== null) ||
          (tokenContextSize !== undefined && tokenContextSize !== null)) && (
          <div className="flex items-center gap-1.5 md:gap-3 text-[10px] md:text-xs font-bold tabular-nums">
            <Zap className="w-3 h-3 md:w-3.5 md:h-3.5 text-wp-accent shrink-0" />
            <span className="text-wp-text-primary">
              Balance:
              <span
                className={
                  tokenBalance !== undefined &&
                  tokenBalance !== null &&
                  tokenBalance < 0
                    ? "text-wp-error"
                    : "text-wp-success"
                }
              >
                {(tokenBalance ?? 0).toLocaleString()}tkn
              </span>
              {derivedUsedTokens > 0 &&
                tokenContextSize !== undefined &&
                tokenContextSize !== null && (
                  <span>
                    {derivedUsedTokens.toLocaleString()}/
                    {tokenContextSize.toLocaleString()}tkn
                  </span>
                )}
            </span>
          </div>
        )}
      </div>

      {/* ── Token limit banner ─────────────────────────────────────────────── */}
      {tokenBlocked && tokenBannerText && (
        <div className="shrink-0 px-4 py-3 bg-wp-error-bg border-b border-wp-error flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-wp-error shrink-0" />
          <p className="text-wp-error font-bold text-sm flex-1">
            {tokenBannerText}
          </p>
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 md:px-4 py-3 md:py-4 space-y-3 md:space-y-4 bg-wp-page">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 md:py-16 text-wp-text-tertiary select-none">
            <Bot className="w-12 h-12 md:w-16 md:h-16 mb-3 md:mb-4 opacity-30 text-wp-accent" />
            <p className="text-sm md:text-base font-medium text-wp-text-secondary">
              EduClaw AI Tutor
            </p>
            <p className="text-xs md:text-sm mt-2 text-wp-text-tertiary">
              Ask a question to get started.
            </p>
            <p className="text-[11px] md:text-xs mt-4 text-wp-text-tertiary">
              Shift+Enter for new line · Enter to send
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            sessionId={sessionId}
            token={token}
            onFileSelect={onFileSelect}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input bar: ChatGPT-style with icon buttons on far sides */}
      <div
        className={`shrink-0 border-t-2 border-wp-border-mid bg-wp-surface px-3 md:px-5 py-3 md:py-4 transition-colors ${isDragOver ? "bg-wp-accent-subtle border-wp-accent" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {tokenBlocked ? (
          <p className="text-center text-sm md:text-base text-wp-error font-bold py-2 md:py-3 bg-wp-error-bg px-3 md:px-4 rounded-wp-lg border border-wp-error">
            Messaging is disabled — token limit reached.
          </p>
        ) : (
          <div className="relative flex flex-col gap-2">
            {/* Attached image from FileTree */}
            {attachedImageFromTree && (
              <div className="flex items-center gap-2 mb-1 px-2 py-1.5 bg-wp-accent-subtle rounded-wp-md">
                <img
                  src={attachedImageFromTree.dataUrl}
                  alt={attachedImageFromTree.name}
                  className="w-8 h-8 object-cover rounded"
                />
                <span className="text-xs text-wp-accent font-medium truncate flex-1">
                  {attachedImageFromTree.name}
                </span>
                <button
                  onClick={() => {
                    onRemoveAttachedImage?.();
                  }}
                  className="hover:text-wp-error transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Attached files from FileTree (non-image) */}
            {attachedFileRefs && attachedFileRefs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1">
                <span className="text-[10px] text-wp-text-tertiary self-center">
                  Files:
                </span>
                {attachedFileRefs.map((f) => (
                  <span
                    key={f.path}
                    className="flex items-center gap-1 px-2 py-1 bg-wp-accent-subtle text-wp-accent rounded-wp-sm text-xs font-medium"
                  >
                    <Paperclip className="w-3 h-3" />
                    <span className="truncate max-w-[120px]">{f.name}</span>
                    <button
                      onClick={() => onRemoveAttachedFile?.(f.path)}
                      className="hover:text-wp-error transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="relative flex items-end gap-2 md:gap-3">
              {/* Attach icon button - far left side */}
              <div className="shrink-0 absolute left-2 md:left-3 bottom-2 md:bottom-3 z-10">
                <FileInputAttachment
                  ref={fileInputAttachmentRef}
                  onImageSelected={handleImageSelected}
                  onFilesUploaded={handleFilesReadyForUpload}
                  disabled={disabled}
                />
              </div>

              {/* Main input area - text starts after left icon, stops before right icon */}
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  className="w-full resize-none rounded-wp-xl border-2 border-wp-border-mid pl-10 md:pl-12 pr-10 md:pr-12 py-3 md:py-4 text-sm md:text-base text-wp-text-primary
                  placeholder:text-wp-text-tertiary focus:outline-none focus:ring-2 focus:ring-wp-accent focus:border-wp-accent
                  bg-wp-page max-h-48 md:max-h-56 min-h-[3rem] md:min-h-[3.5rem] font-sans transition-all shadow-sm"
                  placeholder="Ask EduClaw anything... (Enter to send, Shift+Enter for new line)"
                  rows={1}
                  value={inputValue}
                  onChange={(e) => {
                    onInputChange(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                  }}
                  onKeyDown={handleKeyDown}
                  disabled={disabled}
                />
              </div>

              {/* Stop/Send icon buttons - far right side */}
              <div className="shrink-0 absolute right-2 md:right-3 bottom-2 md:bottom-3 flex items-center gap-1.5 md:gap-2 z-10">
                {disabled && onCancel && (
                  <button
                    onClick={onCancel}
                    className="p-2 rounded-wp-md bg-wp-error hover:bg-wp-error/80 active:bg-wp-error/70 text-wp-text-on-accent font-bold flex items-center justify-center transition-all shadow-sm border border-wp-error"
                    title="Stop generating"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={doSend}
                  disabled={
                    disabled ||
                    (!inputValue.trim() &&
                      !attachedImage &&
                      filesToUpload.length === 0 &&
                      (!attachedFileRefs || attachedFileRefs.length === 0))
                  }
                  className="p-2 rounded-wp-md bg-wp-accent hover:bg-wp-accent-hover active:bg-wp-accent/70 disabled:bg-wp-border-soft
                  disabled:cursor-not-allowed text-wp-text-on-accent font-bold flex items-center justify-center transition-all shadow-sm disabled:shadow border border-wp-accent-hover disabled:border-wp-border-soft"
                  title="Send (Enter)"
                >
                  {disabled ? (
                    <div className="w-4 h-4 border-2 border-wp-text-on-accent/40 border-t-wp-text-on-accent rounded-full animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
