import { useState } from 'react'
import { ArrowRight, Loader2, Sparkles, BookOpen, GitBranch, ChevronLeft } from 'lucide-react'

interface SessionInfo {
  id: string
  title?: string
  updated_at?: string
  cwd: string
}

interface Props {
  onNewSession: () => void
  onLoadSession: (threadId: string) => void
  onForkSession: (threadId: string) => void
  onListSessions: () => Promise<SessionInfo[]>
  isLoading?: boolean
}

export default function SessionSelector({
  onNewSession,
  onLoadSession,
  onForkSession,
  onListSessions,
  isLoading = false,
}: Props) {
  const [mode, setMode] = useState<'pick' | 'load' | 'fork'>('pick')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [error, setError] = useState<string>()

  async function handleShowList(newMode: 'load' | 'fork') {
    setMode(newMode)
    setError(undefined)
    setListLoading(true)
    try {
      const list = await onListSessions()
      setSessions(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
      setMode('pick')
    } finally {
      setListLoading(false)
    }
  }

  function handleSelectSession(threadId: string) {
    if (mode === 'load') {
      onLoadSession(threadId)
    } else {
      onForkSession(threadId)
    }
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full h-full overflow-y-auto">
        {mode === 'pick' ? (
          <div className="space-y-6 px-6 py-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-wp-textPrimary mb-2">Sessions</h1>
              <p className="text-wp-textSecondary text-sm">Choose an action</p>
            </div>

            {error && (
              <div className="p-4 bg-errorBg border border-error/30 rounded-md">
                <p className="text-error text-sm">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={onNewSession}
                disabled={isLoading}
                className="w-full px-4 py-3 bg-wp-accent hover:bg-wp-accent-hover disabled:bg-wp-border-mid text-wp-text-on-accent rounded-wp-lg font-medium transition-colors flex items-center justify-center gap-2 group"
              >
                <Sparkles className="w-4 h-4" />
                <span>Start New Session</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>

              <button
                onClick={() => handleShowList('load')}
                disabled={isLoading || listLoading}
                className="w-full px-4 py-3 bg-wp-bgSurfaceAlt hover:bg-wp-bgInset disabled:bg-wp-borderSoft border border-wp-borderMid text-wp-textPrimary rounded-md font-medium transition-colors flex items-center justify-center gap-2 group"
              >
                {listLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading sessions…</span>
                  </>
                ) : (
                  <>
                    <BookOpen className="w-4 h-4" />
                    <span>Load Existing Session</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>

              <button
                onClick={() => handleShowList('fork')}
                disabled={isLoading || listLoading}
                className="w-full px-4 py-3 bg-wp-bgSurfaceAlt hover:bg-wp-bgInset disabled:bg-wp-borderSoft border border-wp-borderMid text-wp-textPrimary rounded-md font-medium transition-colors flex items-center justify-center gap-2 group"
              >
                {listLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading sessions…</span>
                  </>
                ) : (
                  <>
                    <GitBranch className="w-4 h-4" />
                    <span>Fork & Continue</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </div>

            <div className="text-center text-xs text-wp-textTertiary">
              <p>Load: Continue from where you left off</p>
              <p>Fork: Start fresh with previous context</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-6 py-6">
            <div>
              <button
                onClick={() => setMode('pick')}
                className="flex items-center gap-2 text-sm text-wp-textSecondary hover:text-wp-textPrimary transition-colors mb-4"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <h2 className="text-xl font-bold text-wp-textPrimary mb-4">
                {mode === 'load' ? 'Load a Session' : 'Fork & Continue'}
              </h2>
            </div>

            {sessions.length === 0 ? (
              <div className="p-6 text-center bg-wp-bgInset rounded-md border border-wp-borderMid">
                <p className="text-wp-textSecondary">No previous sessions found</p>
                <button
                  onClick={() => setMode('pick')}
                  className="mt-4 text-wp-accent hover:text-wp-accentHover transition-colors text-sm font-medium"
                >
                  Start a new one instead
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => handleSelectSession(session.id)}
                    className="w-full p-3 text-left bg-wp-bgSurface hover:bg-wp-bgInset rounded-md border border-wp-borderMid hover:border-wp-accent transition-colors group"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-wp-textPrimary truncate group-hover:text-wp-accent transition-colors">
                          {session.title || `Session ${session.id.slice(0, 8)}`}
                        </p>
                        <p className="text-xs text-wp-textTertiary mt-1">
                          {session.updated_at
                            ? new Date(session.updated_at).toLocaleDateString()
                            : 'No date'}
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-wp-textTertiary group-hover:text-wp-accent transition-colors flex-shrink-0 ml-2" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
