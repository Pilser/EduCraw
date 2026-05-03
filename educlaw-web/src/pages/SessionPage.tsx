import { useState, useCallback, useRef, useEffect } from 'react'
import { Files, BarChart3, GraduationCap, User, Menu } from 'lucide-react'
import TutorTerminal from '../components/TutorTerminal'
import FileTree from '../components/FileTree'
import AssignmentPanel from '../components/AssignmentPanel'
import ChatPanel from '../components/ChatPanel'
import FilePreview from '../components/FilePreview'
import DraggableModal from '../components/DraggableModal'
import { useWebSocket, type WsStatus } from '../hooks/useWebSocket'
import { api } from '../api/client'
import type { LoginResponse, Session, ShowImagePayload, ChatMessage, TokenUsage, TurnTokenUsage } from '../api/types'

interface Props {
  auth: LoginResponse
  session: Session
  onEnd: () => void
}

function StatusDot({ status }: { status: WsStatus }) {
  const colors: Record<WsStatus, string> = {
    connecting:   'bg-yellow-400',
    connected:    'bg-emerald-400',
    disconnected: 'bg-red-400',
    error:        'bg-red-500',
  }
  const labels: Record<WsStatus, string> = {
    connecting:   'Connecting',
    connected:    'Connected',
    disconnected: 'Disconnected',
    error:        'Connection error',
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className={`w-2 h-2 rounded-full ${colors[status]} ${status === 'connecting' ? 'animate-pulse' : ''}`} />
      {labels[status]}
    </span>
  )
}

let msgCounter = 0
function nextId() { return `msg-${++msgCounter}` }

export default function SessionPage({ auth, session, onEnd }: Props) {
  // On mobile, default sidebars to closed
  const [sidebarOpen, setSidebarOpen]           = useState(window.innerWidth >= 768)
  const [rightPanelOpen, setRightPanelOpen]     = useState(false)
  const [terminalOpen, setTerminalOpen]         = useState(false)
  const [lightboxImage, setLightboxImage]       = useState<ShowImagePayload | null>(null)
  
  // Handle window resize to auto-close sidebars on mobile
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768
      // Auto-close sidebars when resizing to mobile
      if (mobile) {
        setSidebarOpen(false)
        setRightPanelOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // File preview state
  const [selectedFile, setSelectedFile]         = useState<{ path: string; name: string; isSubject?: boolean; subjectId?: string } | null>(null)

  // Chat state
  const [messages, setMessages]   = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [aiTyping, setAiTyping]   = useState(false)
  const pendingMsgIdRef = useRef<string | null>(null)

  // Model + token state
  const [availableModels, setAvailableModels] = useState<string[]>([])
  // Use grok-3-fast (valid xAI model; grok-4-1-fast-reasoning doesn't exist)
  const [activeModel, setActiveModel]         = useState<string>('grok-3-fast')
  const [tokenUsage, setTokenUsage]           = useState<TokenUsage | null>(null)
  const [tokenBlocked, setTokenBlocked]       = useState(false)
  const [tokenBannerText, setTokenBannerText] = useState('')

  // Load allowed models + current token usage from server on mount
  useEffect(() => {
    api.getSessionModels(session.session_id, session.token)
      .then(r => { setAvailableModels(r.models); setActiveModel(r.active) })
      .catch(() => {})
    api.getSessionTokenUsage(session.session_id, session.token)
      .then(r => setTokenUsage(r))
      .catch(() => {})
  }, [session.session_id, session.token])

  // Terminal write function set once xterm mounts
  const ptyWriteRef = useRef<((d: Uint8Array) => void) | null>(null)

  const handlePtyReady = useCallback(
    (write: (d: Uint8Array) => void, _resize: (cols: number, rows: number) => void) => {
      ptyWriteRef.current = write
    },
    [],
  )

  const handlePtyData = useCallback((data: Uint8Array) => {
    ptyWriteRef.current?.(data)
  }, [])

  const handleImage = useCallback((p: ShowImagePayload) => {
    setLightboxImage(p)
  }, [])

  // ── Chat streaming callbacks ──────────────────────────────────────────────

  const handleChatStart = useCallback(() => {
    const id = nextId()
    pendingMsgIdRef.current = id
    setAiTyping(true)
    setMessages(prev => [...prev, { id, role: 'assistant', segments: [], pending: true }])
  }, [])

  const handleToolStart = useCallback((tool: string, command: string) => {
    const id = pendingMsgIdRef.current
    if (!id) return
    setMessages(prev => prev.map(m =>
      m.id === id
        ? { ...m, segments: [...m.segments, { kind: 'tool' as const, tool, command, exitCode: 0, done: false, output: '' }] }
        : m
    ))
  }, [])

  const handleToolEnd = useCallback((exitCode: number, stdout: string, stderr: string) => {
    const id = pendingMsgIdRef.current
    if (!id) return
    setMessages(prev => prev.map(m => {
      if (m.id !== id) return m
      // Update the last undone tool segment.
      const lastIdx = m.segments.reduce<number>(
        (acc, seg, i) => (seg.kind === 'tool' && !seg.done ? i : acc), -1
      )
      if (lastIdx === -1) return m
      const segs = m.segments.map((seg, i) => {
        if (i === lastIdx && seg.kind === 'tool') {
          const output = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trimEnd()
          return { kind: 'tool' as const, tool: seg.tool, command: seg.command, exitCode, done: true, output }
        }
        return seg
      })
      return { ...m, segments: segs }
    }))
  }, [])

  const handleAssistantText = useCallback((text: string) => {
    const id = pendingMsgIdRef.current
    if (!id) return
    setMessages(prev => prev.map(m => {
      if (m.id !== id) return m
      const segs = [...m.segments]
      const last = segs[segs.length - 1]
      if (last && last.kind === 'text') {
        segs[segs.length - 1] = { kind: 'text' as const, content: last.content + text }
      } else {
        segs.push({ kind: 'text' as const, content: text })
      }
      return { ...m, segments: segs }
    }))
  }, [])

  const handleChatEnd = useCallback(() => {
    const id = pendingMsgIdRef.current
    if (id) {
      setMessages(prev => prev.map(m =>
        m.id === id ? { ...m, pending: false } : m
      ))
      pendingMsgIdRef.current = null
    }
    setAiTyping(false)
  }, [])

  const handleTokenUsage = useCallback((usage: TurnTokenUsage) => {
    // Accumulate into session totals
    setTokenUsage(prev => prev ? {
      total_input_tokens: prev.total_input_tokens + usage.input_tokens,
      total_output_tokens: prev.total_output_tokens + usage.output_tokens,
      total_cache_creation_tokens: prev.total_cache_creation_tokens + usage.cache_creation_input_tokens,
      total_cache_read_tokens: prev.total_cache_read_tokens + usage.cache_read_input_tokens,
      turn_count: prev.turn_count + 1,
    } : {
      total_input_tokens: usage.input_tokens,
      total_output_tokens: usage.output_tokens,
      total_cache_creation_tokens: usage.cache_creation_input_tokens,
      total_cache_read_tokens: usage.cache_read_input_tokens,
      turn_count: 1,
    })
    // Update active model if reported
    if (usage.model) setActiveModel(usage.model)
  }, [])

  const handleTokenLimitReached = useCallback((banner: string) => {
    setTokenBlocked(true)
    setTokenBannerText(banner)
  }, [])

  const handleModelChanged = useCallback((model: string) => {
    setActiveModel(model)
  }, [])

  const { status, sendInput, sendResize, sendCancel } = useWebSocket({
    sessionId:            session.session_id,
    token:                session.token,
    onPtyData:            handlePtyData,
    onImage:              handleImage,
    onChatStart:          handleChatStart,
    onToolStart:          handleToolStart,
    onToolEnd:            handleToolEnd,
    onAssistantText:      handleAssistantText,
    onChatEnd:            handleChatEnd,
    onTokenUsage:         handleTokenUsage,
    onTokenLimitReached:  handleTokenLimitReached,
    onModelChanged:       handleModelChanged,
  })

  // Patch handleSend to use the real sendInput (avoid closure ordering issue)
  const handleSendWithWs = useCallback((text: string) => {
    setMessages(prev => [...prev, {
      id: nextId(),
      role: 'user',
      segments: [{ kind: 'text' as const, content: text }],
      pending: false,
    }])
    sendInput(text + '\n')
  }, [sendInput])

  // Switch model: call API (writes pending_model.txt) + update local UI immediately
  const handleModelChange = useCallback(async (model: string) => {
    setActiveModel(model)
    try {
      await api.setSessionModel(session.session_id, session.token, model)
    } catch {
      // Non-critical — the /model inject will be retried on next reconnect
    }
  }, [session.session_id, session.token])

  async function handleEndSession() {
    if (!confirm('End this session? Your progress is saved.')) return
    await api.endSession(session.session_id, session.token).catch(() => {})
    onEnd()
  }

  return (
    <div className="flex flex-col h-screen bg-wp-page">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="shrink-0 h-12 md:h-14 bg-wp-surface border-b border-wp-border-mid flex items-center px-2 md:px-4 gap-2 md:gap-4 shadow-sm">
        <div className="flex items-center gap-1 md:gap-2 mr-1 md:mr-2">
          <GraduationCap className="w-4 h-4 md:w-5 md:h-5 text-wp-accent" />
          <span className="hidden sm:inline font-bold text-wp-text-primary text-xs md:text-sm">EduClaw</span>
        </div>

        <span className="hidden sm:inline px-2 md:px-2.5 py-0.5 rounded-full bg-wp-accent-subtle text-wp-accent text-xs font-medium">
          {auth.cohort_id || 'no cohort'}
        </span>

        <StatusDot status={status} />

        {/* Hamburger menu for files on mobile */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          title={sidebarOpen ? "Close files menu" : "Open files menu"}
          className={`md:hidden flex items-center gap-2 px-3 py-1.5 rounded-wp-md font-semibold transition-all duration-200
            ${sidebarOpen 
              ? 'bg-wp-accent text-white shadow-md' 
              : 'bg-wp-surface text-wp-accent hover:bg-wp-accent-subtle'}`}
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
          onClick={() => setSidebarOpen(o => !o)}
          title={sidebarOpen ? "Hide files" : "Show files"}
          className={`hidden sm:flex items-center gap-1 md:gap-2 px-2 md:px-2.5 py-1.5 md:py-2 rounded-wp-md text-sm font-semibold transition-all duration-200
            ${sidebarOpen 
              ? 'bg-wp-accent text-white shadow-md' 
              : 'bg-wp-surface hover:bg-wp-accent-subtle text-wp-accent hover:text-wp-accent-hover'}`}
        >
          <Files className="w-5 h-5 md:w-5 md:h-5" />
          <span className="text-xs md:text-sm">Files</span>
        </button>

        {/* Toggle assignment progress — desktop only */}
        <button
          onClick={() => setRightPanelOpen(o => !o)}
          title={rightPanelOpen ? "Hide progress" : "Show progress"}
          className={`hidden md:flex items-center gap-2 px-2.5 py-2 rounded-wp-md text-sm font-semibold transition-all duration-200
            ${rightPanelOpen 
              ? 'bg-wp-accent text-white shadow-md' 
              : 'bg-wp-surface hover:bg-wp-accent-subtle text-wp-accent hover:text-wp-accent-hover'}`}
        >
          <BarChart3 className="w-5 h-5" />
          <span className="text-sm">Progress</span>
        </button>

        {/* End session */}
        <button
          onClick={handleEndSession}
          className="px-2 md:px-3 py-1.5 md:py-2 rounded-wp-md bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs md:text-sm font-semibold transition-all shadow-sm hover:shadow-md"
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
            <div className="px-3 md:px-4 pt-2 md:pt-3 pb-1.5 text-xs font-semibold text-wp-text-secondary uppercase tracking-wider">
              📁 Files
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
                    isSubject: tab === 'subject',
                    subjectId,
                  })
                }}
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
              onCancel={sendCancel}
              disabled={status !== 'connected' || aiTyping}
              availableModels={availableModels}
              activeModel={activeModel}
              onModelChange={handleModelChange}
              tokenUsage={tokenUsage}
              tokenBlocked={tokenBlocked}
              tokenBannerText={tokenBannerText}
              sessionId={session.session_id}
              token={session.token}
              onFileSelect={(path, name) => setSelectedFile({ path, name, isSubject: false })}
            />
          </div>

          {/* Terminal — collapsed by default, toggled open */}
          <div className="shrink-0 border-t border-wp-border-mid bg-slate-900">
            {/* Toggle bar */}
            <button
              className="w-full flex items-center justify-between px-4 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              onClick={() => setTerminalOpen(o => !o)}
            >
              <span className="flex items-center gap-2">
                <span>{terminalOpen ? '▼' : '▶'}</span>
                <span className="font-mono">Terminal</span>
                <span className="text-slate-600">— shell & code execution</span>
              </span>
              <span className="text-slate-600 text-[10px]">
                {terminalOpen ? 'Click to collapse' : 'Click to expand'}
              </span>
            </button>

            {/* xterm.js — always mounted, just hidden when closed so PTY stream is preserved */}
            <div className={`overflow-hidden transition-all duration-200 ${terminalOpen ? 'h-40 md:h-64' : 'h-0'}`}>
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

      {/* ── Image lightbox ───────────────────────────────────────────────── */}
      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-3xl max-h-[85vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <span className="text-sm font-medium text-slate-700 truncate">
                {lightboxImage.path.split('/').pop()}
              </span>
              <button
                onClick={() => setLightboxImage(null)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ✕
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
        title={selectedFile?.name || 'File Preview'}
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
  )
}

