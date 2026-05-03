import { useState, type FormEvent } from 'react'
import { GraduationCap, AlertCircle, LogIn, Shield, User } from 'lucide-react'
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

  const inputCls = 'w-full px-4 py-3.5 rounded-wp-md border border-wp-border-mid bg-white focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent text-wp-text-primary placeholder-wp-text-tertiary text-base transition-all duration-200'
  const inputLabel = 'block text-sm font-semibold text-wp-text-secondary mb-2'

  return (
    <div className="min-h-screen bg-wp-page flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-wp-accent/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-wp-accent/3 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />
        <div className="absolute top-1/2 left-1/3 w-64 h-64 bg-amber-400/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Brand header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-wp-xl bg-wp-accent text-wp-on-accent mb-5 shadow-xl shadow-wp-accent/20 relative">
            <div className="absolute inset-0 rounded-wp-xl bg-gradient-to-br from-white/10 to-transparent" />
            <GraduationCap className="w-10 h-10 relative z-10" />
          </div>
          <h1 className="text-4xl font-bold text-wp-text-primary tracking-tight">EduClaw</h1>
          <p className="text-wp-text-secondary mt-2.5 text-lg font-medium">Your AI-powered learning tutor</p>
        </div>

        {/* Main login card */}
        <div className="bg-wp-surface rounded-wp-xl shadow-xl shadow-wp-border-mid/20 border border-wp-border-soft/50 p-8 relative">
          {/* Decorative top border */}
          <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-wp-accent/40 to-transparent" />
          
          <h2 className="text-2xl font-bold text-wp-text-primary mb-6 flex items-center gap-2">
            <span className="w-1 h-7 bg-wp-accent rounded-full" />
            Sign in to learn
          </h2>

          <form onSubmit={handleStudentSubmit} className="space-y-5" autoComplete="off">
            <div>
              <label className={inputLabel}>Username</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-wp-text-tertiary">
                  <User className="w-5 h-5" />
                </div>
                <input 
                  name="username" 
                  type="text" 
                  required 
                  placeholder="your-username" 
                  className={`${inputCls} pl-11`} 
                />
              </div>
            </div>
            <div>
              <label className={inputLabel}>Password</label>
              <input 
                name="password" 
                type="password" 
                required 
                placeholder="Enter your password" 
                className={inputCls} 
              />
            </div>

            {(error || externalError) && !staffOpen && (
              <div className="flex items-start gap-3 bg-wp-error-bg border border-wp-error/20 rounded-wp-lg px-4 py-3.5 text-sm font-medium text-wp-error">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{error || externalError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 px-4 bg-wp-accent hover:bg-wp-accent-hover disabled:bg-wp-accent-muted text-wp-on-accent font-bold rounded-wp-lg transition-all duration-200 shadow-lg shadow-wp-accent/20 hover:shadow-xl hover:shadow-wp-accent/30 text-base flex items-center justify-center gap-2.5 active:scale-[0.98]"
            >
              {loading ? (
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

        {/* Staff access section */}
        <div className="mt-6">
          <button
            onClick={() => { setStaffOpen(o => !o); setError('') }}
            className="w-full text-sm text-wp-text-tertiary hover:text-wp-accent transition-colors font-medium flex items-center justify-center gap-2 py-2"
          >
            {staffOpen ? (
              <>
                <svg className="w-4 h-4 rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                Close staff access
              </>
            ) : (
              <>
                <svg className="w-4 h-4 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                Staff access
              </>
            )}
          </button>

          {staffOpen && (
            <div className="mt-3 bg-wp-surface border border-wp-border-soft/50 rounded-wp-xl shadow-lg p-6">
              {/* Tab toggle */}
              <div className="flex gap-2 mb-6">
                <button
                  onClick={() => { setStaffMode('login'); setError('') }}
                  className={`flex-1 py-2.5 text-base rounded-wp-md font-semibold transition-all ${staffMode === 'login' ? 'bg-wp-accent text-wp-on-accent shadow-md' : 'bg-wp-inset text-wp-text-primary hover:bg-wp-border-soft'}`}
                >
                  Sign in
                </button>
                <button
                  onClick={() => { setStaffMode('bootstrap'); setError('') }}
                  className={`flex-1 py-2.5 text-base rounded-wp-md font-semibold transition-all ${staffMode === 'bootstrap' ? 'bg-wp-accent text-wp-on-accent shadow-md' : 'bg-wp-inset text-wp-text-primary hover:bg-wp-border-soft'}`}
                >
                  First-time setup
                </button>
              </div>

              {staffMode === 'login' ? (
                <form onSubmit={handleStaffLogin} className="space-y-4" autoComplete="off">
                  <div>
                    <label className={inputLabel}>Staff username</label>
                    <input name="s_username" type="text" required placeholder="username" className={inputCls} />
                  </div>
                  <div>
                    <label className={inputLabel}>Password</label>
                    <input name="s_password" type="password" required placeholder="password" className={inputCls} />
                  </div>
                  {error && staffOpen && staffMode === 'login' && (
                    <div className="flex items-start gap-2 bg-wp-error-bg border border-wp-error/20 text-wp-error rounded-wp-md px-4 py-3 text-sm font-medium">
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
                  <div className="bg-wp-inset rounded-wp-lg p-4 text-sm text-wp-text-secondary">
                    <div className="flex items-start gap-3">
                      <Shield className="w-5 h-5 text-wp-accent shrink-0 mt-0.5" />
                      <p>
                        Enter the <code className="font-mono bg-white/60 px-2 py-0.5 rounded text-wp-text-primary">ADMIN_SECRET</code> from your <code className="font-mono bg-white/60 px-2 py-0.5 rounded text-wp-text-primary">.env</code> to access the admin panel.
                      </p>
                    </div>
                  </div>
                  <input name="secret" type="password" required placeholder="Admin secret" className={inputCls} />
                  {error && staffOpen && staffMode === 'bootstrap' && (
                    <div className="flex items-start gap-2 bg-wp-error-bg border border-wp-error/20 text-wp-error rounded-wp-md px-4 py-3 text-sm font-medium">
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

        <p className="text-center text-wp-text-tertiary text-sm mt-10 font-medium">EduClaw &middot; AI-Powered Learning Platform</p>
      </div>
    </div>
  )
}