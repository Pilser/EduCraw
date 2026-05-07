import { useState, useEffect } from 'react'
import LoginPage from './pages/LoginPage'
import SessionPage from './pages/SessionPage'
import AdminPage from './pages/AdminPage'
import { api } from './api/client'
import type { LoginResponse, Session } from './api/types'

type View =
  | { kind: 'login'; error?: string }
  | { kind: 'session'; auth: LoginResponse; session: Session; mode: 'new' }
  | { kind: 'admin'; token: string; role: string; displayName: string }

const STORAGE_KEY = 'educlaw_auth'

// Helper to save auth to localStorage
function saveAuthToStorage(auth: LoginResponse) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
  } catch {
    // localStorage might be unavailable (private browsing, etc.)
  }
}

// Helper to load auth from localStorage
function loadAuthFromStorage(): LoginResponse | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as LoginResponse
    }
  } catch {
    // Invalid stored data, clear it
    localStorage.removeItem(STORAGE_KEY)
  }
  return null
}

// Helper to clear auth from localStorage
function clearAuthFromStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore
  }
}

export default function App() {
  const [view, setView] = useState<View>(() => {
    // On initial load, try to restore auth from localStorage
    const storedAuth = loadAuthFromStorage()
    if (storedAuth && storedAuth.role === 'student') {
      // Try to recreate session with stored token
      // We'll create a new session and show the session page
      return { kind: 'login' } as View // Will be updated in useEffect
    }
    if (storedAuth && storedAuth.role !== 'student') {
      return { kind: 'admin', token: storedAuth.token, role: storedAuth.role, displayName: storedAuth.display_name }
    }
    return { kind: 'login' }
  })

  // Restore session on mount if we have stored auth
  useEffect(() => {
    const storedAuth = loadAuthFromStorage()
    if (storedAuth && storedAuth.role === 'student') {
      // Verify token is still valid by trying to create a session
      api.createSession(storedAuth.student_id, storedAuth.token)
        .then(session => {
          setView({ kind: 'session', auth: storedAuth, session, mode: 'new' })
        })
        .catch(() => {
          // Token invalid or expired, clear storage and show login
          clearAuthFromStorage()
          setView({ kind: 'login' })
        })
    }
  }, [])

  async function handleStudentLogin(auth: LoginResponse) {
    // Save to localStorage
    saveAuthToStorage(auth)
    
    // Create initial session, always start with mode 'new' (chat area decides to auto-load or show selector)
    try {
      const session = await api.createSession(auth.student_id, auth.token)
      setView({ kind: 'session', auth, session, mode: 'new' })
    } catch (err) {
      clearAuthFromStorage()
      setView({ kind: 'login', error: 'Failed to create session' })
    }
  }

  return (
    <>
      {view.kind === 'login' && (
        <LoginPage
          onLogin={handleStudentLogin}
          onStaffLogin={(token, role, displayName) => {
            // For staff, also save to storage
            const auth = { token, role, display_name: displayName } as any
            saveAuthToStorage(auth)
            setView({ kind: 'admin', token, role, displayName })
          }}
          externalError={view.error}
        />
      )}
      {view.kind === 'session' && (
        <SessionPage
          auth={view.auth}
          session={view.session}
          onEnd={() => {
            clearAuthFromStorage()
            setView({ kind: 'login' })
          }}
        />
      )}
      {view.kind === 'admin' && (
        <AdminPage
          token={view.token}
          role={view.role}
          displayName={view.displayName}
          onLogout={() => {
            clearAuthFromStorage()
            setView({ kind: 'login' })
          }}
        />
      )}
    </>
  )
}


