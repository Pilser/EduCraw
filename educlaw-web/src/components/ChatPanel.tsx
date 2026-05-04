import { useEffect, useRef, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Send, Square, Zap, AlertCircle, Bot } from 'lucide-react'
import type { ChatMessage, MessageSegment, TokenUsage } from '../api/types'
import ToolCallCard from './ToolCallCard'
import ChatFilePreview from './ChatFilePreview'
import FileInputAttachment, { type AttachedFile, type FileInputAttachmentHandle } from './FileInputAttachment'
import UserMessageBubble from './UserMessageBubble'

interface Props {
  messages: ChatMessage[]
  inputValue: string
  onInputChange: (v: string) => void
  onSend: (text: string) => void
  onSendWithImage?: (text: string, imageDataUrl?: string, mimeType?: string) => void
  onFilesForUpload?: (files: AttachedFile[]) => void
  onCancel?: () => void
  disabled: boolean
  // model selector
  availableModels?: string[]
  activeModel?: string
  onModelChange?: (model: string) => void
  // token usage
  tokenUsage?: TokenUsage | null
  // block state
  tokenBlocked?: boolean
  tokenBannerText?: string
  // file system
  sessionId?: string
  token?: string
  onFileSelect?: (path: string, name: string, isSubject?: boolean, subjectId?: string) => void
}

// Shared code-block renderer for ReactMarkdown.
const mdCode = ({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'>) => {
  const match = /language-(\w+)/.exec(className ?? '')
  if (match) {
    return (
      <SyntaxHighlighter
        style={oneDark}
        language={match[1]}
        PreTag="div"
        customStyle={{ borderRadius: '0.5rem', fontSize: '0.78rem', margin: '0.5rem 0' }}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    )
  }
  return <code className={className} {...props}>{children}</code>
}

// Custom image renderer that detects files in the system
function createMdImage(sessionId?: string, token?: string, onFileSelect?: (path: string, name: string) => void) {
  return function MdImage({ src, alt }: React.ComponentPropsWithoutRef<'img'>) {
    // Extract filename from src (handles paths like "./file.png", "file.png", etc.)
    const fileName = src?.split('/').pop() || ''
    
    if (!sessionId || !token || !onFileSelect) {
      return <img src={src} alt={alt} className="rounded-wp-md border border-wp-border-mid max-w-full h-auto" />
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
    )
  }
}

// Renders one segment: tool card or markdown text.
interface SegmentViewProps {
  seg: MessageSegment
  sessionId?: string
  token?: string
  onFileSelect?: (path: string, name: string, isSubject?: boolean, subjectId?: string) => void
}

function SegmentView({ seg, sessionId, token, onFileSelect }: SegmentViewProps) {
  if (seg.kind === 'tool') return <ToolCallCard seg={seg} />
  if (seg.kind === 'image') {
    return (
      <img 
        src={seg.dataUrl} 
        alt="Attached image" 
        className="rounded-wp-md border border-wp-border-mid max-w-full h-auto my-2 shadow-sm" 
      />
    )
  }
  
  return (
    <div className="markdown-body">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]} 
        components={{ 
          code: mdCode,
          img: createMdImage(sessionId, token, onFileSelect ? (path, name) => onFileSelect(path, name, false) : undefined)
        }}
      >
        {seg.content}
      </ReactMarkdown>
    </div>
  )
}

// A single message bubble.
interface MessageBubbleProps {
  msg: ChatMessage
  sessionId?: string
  token?: string
  onFileSelect?: (path: string, name: string, isSubject?: boolean, subjectId?: string) => void
}

function MessageBubble({ msg, sessionId, token, onFileSelect }: MessageBubbleProps) {
  const isUser = msg.role === 'user'

  // Use dedicated UserMessageBubble component for user messages
  if (isUser) {
    return <UserMessageBubble msg={msg} />
  }

  // AI message rendering
  return (
    <div className="flex gap-3 flex-row items-start">
      {/* Avatar - animate when AI is responding */}
      <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shadow-sm transition-all
        bg-gradient-to-br from-violet-500 to-indigo-600 text-white ${msg.pending ? 'animate-pulse scale-110' : ''}`}>
        <Bot className={`w-5 h-5 ${msg.pending ? 'animate-spin' : ''}`} />
      </div>

      {/* Bubble */}
      <div className={`max-w-xs sm:max-w-sm md:max-w-xl lg:max-w-2xl rounded-2xl px-5 py-4 shadow-sm leading-relaxed transition-all
        bg-wp-surface border border-wp-border-mid text-wp-text-primary rounded-tl-sm text-base ${msg.pending ? 'ring-2 ring-violet-300 ring-opacity-50' : ''}`}>
        <div className="prose max-w-none
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
          prose-a:text-wp-accent prose-a:underline prose-a:decoration-wp-accent prose-a:hover:text-wp-accent-hover
          prose-table:my-4 prose-table:border-collapse prose-table:text-base
          prose-thead:bg-wp-accent-subtle
          prose-th:border prose-th:border-wp-border-mid prose-th:px-3 prose-th:py-2 prose-th:font-semibold prose-th:text-left prose-th:text-base
          prose-td:border prose-td:border-wp-border-soft prose-td:px-3 prose-td:py-2 prose-td:text-base
          prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:my-3 prose-pre:p-4 prose-pre:text-sm
          prose-hr:border-wp-border-mid prose-hr:my-4
          prose-code:font-mono prose-code:text-wp-accent prose-code:bg-wp-accent-subtle prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm">
          {msg.segments.length === 0 && msg.pending && (
            <span className="inline-block w-1.5 h-4 bg-wp-accent animate-pulse rounded-sm align-middle" />
          )}
          {msg.segments.map((seg, i) => <SegmentView key={i} seg={seg} sessionId={sessionId} token={token} onFileSelect={onFileSelect} />)}
          {msg.pending && (
            <span className="inline-block w-1.5 h-4 bg-wp-accent animate-pulse ml-0.5 rounded-sm align-middle" />
          )}
        </div>
      </div>
    </div>
  )
}

export default function ChatPanel({
  messages, inputValue, onInputChange, onSend, onSendWithImage, onFilesForUpload, onCancel, disabled,
  availableModels, activeModel, onModelChange,
  tokenUsage, tokenBlocked, tokenBannerText,
  sessionId, token, onFileSelect,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputAttachmentRef = useRef<FileInputAttachmentHandle>(null)
  const [attachedImage, setAttachedImage] = useState<AttachedFile | null>(null)
  const [filesToUpload, setFilesToUpload] = useState<AttachedFile[]>([])
  const [uploadStatus, setUploadStatus] = useState<string>('')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleImageSelected = useCallback((file: AttachedFile | null) => {
    setAttachedImage(file)
  }, [])

  const handleFilesReadyForUpload = useCallback((files: AttachedFile[]) => {
    setFilesToUpload(files)
  }, [])

  const handleStatusChange = useCallback((status: string) => {
    setUploadStatus(status)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSend()
    }
  }

  function doSend() {
    const text = inputValue.trim()
    if (!text && !attachedImage && filesToUpload.length === 0) return
    if (disabled || tokenBlocked) return

    // If there's an attached image and onSendWithImage is provided, use it
    if (attachedImage && onSendWithImage) {
      onSendWithImage(text, attachedImage.dataUrl, attachedImage.mimeType)
    } else {
      // Otherwise use regular send
      onSend(text)
    }

    // Upload files if present
    if (filesToUpload.length > 0 && onFilesForUpload) {
      onFilesForUpload(filesToUpload)
    }

    onInputChange('')
    setAttachedImage(null)
    setFilesToUpload([])
    setUploadStatus('')
    fileInputAttachmentRef.current?.clearAll()
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const totalTokens = tokenUsage
    ? tokenUsage.total_input_tokens + tokenUsage.total_output_tokens
    : 0

  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar: model selector + token usage ─────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-wp-surface border-b border-wp-border-mid flex-wrap">
        {/* Model selector */}
        {availableModels && availableModels.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-wp-text-secondary uppercase tracking-wide">Model</span>
            <select
              value={activeModel ?? availableModels[0]}
              onChange={e => onModelChange?.(e.target.value)}
              disabled={disabled}
              className="text-sm font-semibold text-wp-accent bg-wp-accent-subtle border border-wp-border-mid
                rounded-wp-md px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-wp-accent
                disabled:opacity-60 cursor-pointer transition-all"
            >
              {availableModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-wp-text-secondary uppercase tracking-wide">Model</span>
            <span className="text-xs text-wp-text-tertiary italic">Loading models...</span>
          </div>
        )}

        <div className="flex-1" />

        {/* Token usage — bold, prominent */}
        {tokenUsage && (
          <div className="flex items-center gap-2 text-sm font-bold">
            <Zap className="w-4 h-4 text-wp-accent" />
            <span className={`font-bold tabular-nums ${tokenBlocked ? 'text-wp-error' : 'text-wp-text-primary'}`}>
              {totalTokens.toLocaleString()}
            </span>
            <span className="text-wp-text-tertiary font-normal text-xs">
              ({tokenUsage.total_input_tokens.toLocaleString()} in · {tokenUsage.total_output_tokens.toLocaleString()} out)
            </span>
          </div>
        )}
      </div>

      {/* ── Token limit banner ─────────────────────────────────────────────── */}
      {tokenBlocked && tokenBannerText && (
        <div className="shrink-0 px-4 py-3 bg-wp-error-bg border-b border-wp-error flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-wp-error shrink-0" />
          <p className="text-wp-error font-bold text-sm flex-1">{tokenBannerText}</p>
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 md:px-4 py-3 md:py-4 space-y-3 md:space-y-4 bg-wp-page">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 md:py-16 text-wp-text-tertiary select-none">
            <Bot className="w-12 h-12 md:w-16 md:h-16 mb-3 md:mb-4 opacity-30 text-wp-accent" />
            <p className="text-sm md:text-base font-medium text-wp-text-secondary">EduClaw AI Tutor</p>
            <p className="text-xs md:text-sm mt-2 text-wp-text-tertiary">Ask a question to get started.</p>
            <p className="text-[11px] md:text-xs mt-4 text-wp-text-tertiary">Shift+Enter for new line · Enter to send</p>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} sessionId={sessionId} token={token} onFileSelect={onFileSelect} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t-2 border-wp-border-mid bg-wp-surface px-3 md:px-5 py-3 md:py-4">
        {tokenBlocked ? (
          <p className="text-center text-sm md:text-base text-wp-error font-bold py-2 md:py-3 bg-wp-error-bg px-3 md:px-4 rounded-wp-lg border border-wp-error">
            Messaging is disabled — token limit reached.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {/* File input attachment component */}
            <FileInputAttachment
              ref={fileInputAttachmentRef}
              onImageSelected={handleImageSelected}
              onFilesUploaded={handleFilesReadyForUpload}
              onStatusChange={handleStatusChange}
              disabled={disabled}
            />

            {/* Show attachment status */}
            {uploadStatus && (
              <div className="text-xs text-wp-text-secondary flex items-center gap-2 px-2">
                {uploadStatus}
              </div>
            )}

            {/* Input area */}
            <div className="flex gap-2 md:gap-3 items-end">
              <textarea
                ref={textareaRef}
                className="flex-1 resize-none rounded-wp-lg border-2 border-wp-border-mid px-3 md:px-4 py-2 md:py-3 text-sm md:text-base text-wp-text-primary
                  placeholder:text-wp-text-tertiary focus:outline-none focus:ring-2 focus:ring-wp-accent focus:border-wp-accent
                  bg-wp-page max-h-40 min-h-[2.5rem] md:min-h-[3rem] font-sans transition-all shadow-sm"
                placeholder="Ask EduClaw anything… (Enter to send, Shift+Enter for new line)"
                rows={1}
                value={inputValue}
                onChange={e => {
                  onInputChange(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
                }}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
              {disabled && onCancel && (
                <button
                  onClick={onCancel}
                  className="shrink-0 px-3 md:px-4 py-2 md:py-3 rounded-wp-lg bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold flex items-center justify-center gap-1 md:gap-2 transition-all shadow-lg hover:shadow-xl text-xs md:text-sm border border-red-700"
                  title="Stop generating"
                >
                  <Square className="w-4 h-4" />
                  <span className="hidden sm:inline">Stop</span>
                </button>
              )}
              <button
                onClick={doSend}
                disabled={disabled || (!inputValue.trim() && !attachedImage && filesToUpload.length === 0)}
                className="shrink-0 px-3 md:px-5 py-2 md:py-3 rounded-wp-lg bg-wp-accent hover:bg-wp-accent-hover active:bg-wp-accent disabled:bg-wp-border-soft
                  disabled:cursor-not-allowed text-wp-on-accent font-bold flex items-center justify-center gap-1 md:gap-2 transition-all shadow-lg hover:shadow-xl disabled:shadow text-xs md:text-sm border border-wp-accent-hover disabled:border-wp-border-soft whitespace-nowrap"
                title="Send (Enter)"
              >
                {disabled
                  ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-wp-on-accent/40 border-t-wp-on-accent rounded-full animate-spin" />
                      <span>Sending…</span>
                    </>
                  )
                  : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Send</span>
                    </>
                  )
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
