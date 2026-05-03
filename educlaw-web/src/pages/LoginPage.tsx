import { useState, type FormEvent } from 'react'
import { GraduationCap, AlertCircle, LogIn } from 'lucide-react'
import { api } from '../api/client'
import type { LoginResponse } from '../api/types'

interface Props {
  onLogin:       (auth: LoginResponse) => void
  onStaffLogin:  (token: string, role: string, displayName: string) => void
  externalError?: string
}

export default function LoginPage({ onLogin, onStaffLogin, externalError }: Props) {
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [staffOpen, setStaffOpen] = useState(false)
  const [staffMode, setStaffMode] = useState<'login' | 'bootstrap'>('login')

  // ── Student login ───────────────────────────────────────────────────────
  async function handleStudentSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const form = e.currentTarget
    const username = (form.elements.namedItem('username') as HTMLInputElement).value.trim()
    const password = (form.elements.namedItem('password') as HTMLInputElement).value
    try {
      const auth = await api.login(username, password)
      if (auth.role !== 'student') {
        onStaffLogin(auth.token, auth.role, auth.display_name)
        return
      }
      onLogin(auth)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setLoading(false)
    }
  }

  // ── Staff: username + password ──────────────────────────────────────────
  async function handleStaffLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const form = e.currentTarget
    const username = (form.elements.namedItem('s_username') as HTMLInputElement).value.trim()
    const password = (form.elements.namedItem('s_password') as HTMLInputElement).value
    try {
      const auth = await api.login(username, password)
      if (auth.role === 'student') {
        setError('This account does not have staff access.')
        setLoading(false)
        return
      }
      onStaffLogin(auth.token, auth.role, auth.display_name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setLoading(false)
    }
  }

  // ── Bootstrap: ADMIN_SECRET → token ────────────────────────────────────
  async function handleBootstrap(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const form = e.currentTarget
    const secret = (form.elements.namedItem('secret') as HTMLInputElement).value
    try {
      const { token } = await api.bootstrapToken(secret)
      onStaffLogin(token, 'admin', 'Administrator')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid secret')
      setLoading(false)
    }
  }

  const inputCls = 'w-full px-4 py-3 rounded-wp-md border border-wp-border-mid bg-wp-page focus:outline-none focus:ring-2 focus:ring-wp-accent focus:border-transparent text-wp-text-primary placeholder-wp-text-tertiary text-base font-medium'

  return (
    <div className="min-h-screen bg-gradient-to-br from-wp-page via-wp-surface to-wp-surface-alt flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-wp-accent text-wp-on-accent text-3xl mb-4 shadow-lg">
            <GraduationCap className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold text-wp-text-primary">EduClaw</h1>
          <p className="text-wp-text-secondary mt-2 text-base">Your AI-powered learning tutor</p>
        </div>

        {/* Student card */}
        <div className="bg-wp-surface border-2 border-wp-border-mid rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-bold text-wp-text-primary mb-8">Sign in to learn</h2>

          <form onSubmit={handleStudentSubmit} className="space-y-5" autoComplete="off">
            <div>
              <label className="block text-base font-semibold text-wp-text-primary mb-2">Username</label>
              <input name="username" type="text" required placeholder="your-username" className={inputCls} />
            </div>
            <div>
              <label className="block text-base font-semibold text-wp-text-primary mb-2">Password</label>
              <input name="password" type="password" required placeholder="••••••••" className={inputCls} />
            </div>

            {(error || externalError) && !staffOpen && (
              <div className="flex items-start gap-3 bg-wp-error-bg border border-wp-error text-wp-error rounded-wp-lg px-4 py-3 text-sm font-medium">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{error || externalError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 px-4 bg-wp-accent hover:bg-wp-accent-hover disabled:bg-wp-accent-muted text-wp-on-accent font-bold rounded-wp-lg transition-all shadow-lg text-base flex items-center justify-center gap-2"
            >
              {loading && !staffOpen ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Connecting…
                </>
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  Start Learning
                </>
              )}
            </button>
          </form>
        </div>

        {/* Staff section — collapsed by default, subtle */}
        <div className="mt-6">
          <button
            onClick={() => { setStaffOpen(o => !o); setError('') }}
            className="w-full text-sm text-wp-text-tertiary hover:text-wp-accent transition-colors font-medium"
          >
            {staffOpen ? '▲ Close staff access' : '▼ Staff access'}
          </button>

          {staffOpen && (
            <div className="mt-3 bg-wp-surface border-2 border-wp-border-mid rounded-2xl shadow-lg p-6">
              {/* Tab toggle */}
              <div className="flex gap-2 mb-5">
                <button
                  onClick={() => { setStaffMode('login'); setError('') }}
                  className={`flex-1 py-2.5 text-base rounded-wp-md font-bold transition-all ${staffMode === 'login' ? 'bg-wp-accent text-wp-on-accent' : 'bg-wp-inset text-wp-text-primary hover:bg-wp-border-soft'}`}
                >
                  Sign in
                </button>
                <button
                  onClick={() => { setStaffMode('bootstrap'); setError('') }}
                  className={`flex-1 py-2.5 text-base rounded-wp-md font-bold transition-all ${staffMode === 'bootstrap' ? 'bg-wp-accent text-wp-on-accent' : 'bg-wp-inset text-wp-text-primary hover:bg-wp-border-soft'}`}
                >
                  First-time setup
                </button>
              </div>

              {staffMode === 'login' ? (
                <form onSubmit={handleStaffLogin} className="space-y-4" autoComplete="off">
                  <input name="s_username" type="text" required placeholder="Staff username" className={inputCls} />
                  <input name="s_password" type="password" required placeholder="Staff password" className={inputCls} />
                  {error && staffOpen && staffMode === 'login' && (
                    <div className="flex items-start gap-2 bg-wp-error-bg border border-wp-error text-wp-error rounded-wp-md px-4 py-3 text-sm font-medium">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 bg-wp-accent hover:bg-wp-accent-hover disabled:bg-wp-accent-muted text-wp-on-accent font-bold rounded-wp-md transition-all text-base"
                  >
                    {loading ? 'Signing in…' : 'Sign in as Staff'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleBootstrap} className="space-y-4">
                  <p className="text-sm text-wp-text-secondary bg-wp-inset rounded-wp-md px-4 py-3 font-medium">
                    Enter the <code className="font-mono bg-wp-border-soft px-2 py-1 rounded">ADMIN_SECRET</code> from your <code className="font-mono bg-wp-border-soft px-2 py-1 rounded">.env</code> to access the admin panel.
                  </p>
                  <input name="secret" type="password" required placeholder="Admin secret" className={inputCls} />
                  {error && staffOpen && staffMode === 'bootstrap' && (
                    <div className="flex items-start gap-2 bg-wp-error-bg border border-wp-error text-wp-error rounded-wp-md px-4 py-3 text-sm font-medium">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 bg-wp-accent hover:bg-wp-accent-hover disabled:bg-wp-accent-muted text-wp-on-accent font-bold rounded-wp-md transition-all text-base"
                  >
                    {loading ? 'Verifying…' : 'Open Admin Panel'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-wp-text-tertiary text-sm mt-8 font-medium">EduClaw · AI-Powered Learning Platform</p>
      </div>
    </div>
  )
}
