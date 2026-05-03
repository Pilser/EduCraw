import { useState, useEffect, type FormEvent } from 'react'
import { GraduationCap, LogOut } from 'lucide-react'
import { api, type AdminStudent, type AdminSession, type CreateStudentBody, type CreateAssignmentBody } from '../api/client'
import type { Cohort, Subject, Assignment, Model } from '../api/types'

interface Props {
  token: string
  role: string
  displayName: string
  onLogout: () => void
}

type Tab = 'students' | 'cohorts' | 'subjects' | 'assignments' | 'sessions' | 'models'

export default function AdminPage({ token, role, displayName, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>('students')

  const tabCls = (t: Tab) =>
    `px-5 py-3 text-base font-bold rounded-wp-md transition-all ${tab === t ? 'bg-wp-accent text-wp-on-accent shadow-md' : 'text-wp-text-secondary bg-wp-inset hover:bg-wp-border-soft'}`

  return (
    <div className="min-h-screen bg-wp-page">
      {/* Header */}
      <header className="bg-wp-surface border-b-2 border-wp-border-mid px-8 py-5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-wp-accent text-wp-on-accent shadow-md">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-wp-text-primary text-2xl">EduClaw Admin</h1>
            <p className="text-sm text-wp-text-secondary font-medium capitalize">{role} · {displayName}</p>
          </div>
        </div>
        <button 
          onClick={onLogout} 
          className="flex items-center gap-2 px-4 py-2.5 bg-wp-error-bg hover:bg-wp-border-soft text-wp-error font-bold rounded-wp-md transition-all text-base border border-wp-error"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </header>

      {/* Tab bar */}
      <div className="px-8 py-5 flex gap-3 border-b-2 border-wp-border-mid bg-wp-surface flex-wrap">
        <button className={tabCls('students')}    onClick={() => setTab('students')}>Students</button>
        <button className={tabCls('cohorts')}     onClick={() => setTab('cohorts')}>Cohorts</button>
        <button className={tabCls('subjects')}    onClick={() => setTab('subjects')}>Subjects</button>
        <button className={tabCls('assignments')} onClick={() => setTab('assignments')}>Assignments</button>
        <button className={tabCls('sessions')}    onClick={() => setTab('sessions')}>Live Sessions</button>
        <button className={tabCls('models')}      onClick={() => setTab('models')}>AI Models</button>
      </div>

      <main className="px-8 py-8 max-w-6xl mx-auto">
        {tab === 'students'    && <StudentsTab    token={token} role={role} />}
        {tab === 'cohorts'     && <CohortsTab     token={token} />}
        {tab === 'subjects'    && <SubjectsTab    token={token} />}
        {tab === 'assignments' && <AssignmentsTab token={token} />}
        {tab === 'sessions'    && <SessionsTab    token={token} />}
        {tab === 'models'      && <ModelsTab      token={token} />}
      </main>
    </div>
  )
}

// ── Students tab ────────────────────────────────────────────────────────────

function StudentsTab({ token, role }: { token: string; role: string }) {
  const [students,  setStudents]  = useState<AdminStudent[]>([])
  const [cohorts,   setCohorts]   = useState<Cohort[]>([])
  const [allModels, setAllModels] = useState<Model[]>([])
  const [loading,   setLoading]   = useState(true)   // first-load only
  const [syncing,   setSyncing]   = useState(false)  // background refresh after save
  const [error,     setError]     = useState('')
  const [creating,  setCreating]  = useState(false)
  const [editId,    setEditId]    = useState<string | null>(null)
  const [editForm,  setEditForm]  = useState({ display_name: '', cohort_id: '', new_password: '' })
  const [detailId,  setDetailId]  = useState<string | null>(null)

  async function load(isFirstLoad = false) {
    if (isFirstLoad) setLoading(true)
    else             setSyncing(true)
    try {
      const [s, c, m] = await Promise.all([
        api.adminListStudents(token),
        api.adminListCohorts(token),
        api.adminListModels(token),
      ])
      setStudents(s); setCohorts(c); setAllModels(m)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false); setSyncing(false) }
  }

  useEffect(() => { load(true) }, [])

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const get  = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value.trim()
    const body: CreateStudentBody = {
      username:     get('username'),
      password:     get('password'),
      display_name: get('display_name'),
      role:         get('role') as CreateStudentBody['role'],
      cohort_id:    get('cohort_id'),
    }
    try {
      await api.adminCreateStudent(token, body)
      form.reset(); setCreating(false); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed') }
  }

  function startEdit(s: AdminStudent) {
    setEditId(s.id)
    setEditForm({ display_name: s.display_name, cohort_id: s.cohort_id, new_password: '' })
    setError('')
  }

  async function handleSaveEdit(id: string) {
    try {
      await api.adminUpdateStudent(token, id, {
        display_name: editForm.display_name || undefined,
        cohort_id:    editForm.cohort_id    || undefined,
        new_password: editForm.new_password || undefined,
      })
      setEditId(null); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed') }
  }

  async function handleDelete(id: string, username: string) {
    if (!confirm(`Delete account "${username}"? This cannot be undone.`)) return
    try { await api.adminDeleteStudent(token, id); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  const inputCls = 'px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-800 placeholder-slate-400'
  const btnSm = 'px-2 py-1 rounded text-xs font-medium transition-colors'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-700">Students & Staff</h2>
          {syncing && <span className="text-xs text-slate-400 animate-pulse">Syncing…</span>}
        </div>
        {role === 'admin' && (
          <button onClick={() => setCreating(c => !c)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            {creating ? 'Cancel' : '+ New account'}
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-2 gap-3">
          <div className="col-span-2 font-medium text-sm text-slate-700 mb-1">Create account</div>
          <input name="username"     required placeholder="Username"     className={inputCls} />
          <input name="password"     required placeholder="Password" type="password" className={inputCls} />
          <input name="display_name" required placeholder="Display name"  className={inputCls} />
          <select name="role" className={inputCls}>
            <option value="student">Student</option>
            <option value="teacher">Teacher</option>
            <option value="admin">Admin</option>
          </select>
          <select name="cohort_id" required className={`${inputCls} col-span-2`}>
            <option value="">— Select cohort —</option>
            {cohorts.map(c => <option key={c.id} value={c.id}>{c.title} ({c.id})</option>)}
          </select>
          {error && <p className="col-span-2 text-red-600 text-sm">⚠ {error}</p>}
          <button type="submit" className="col-span-2 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg">Create</button>
        </form>
      )}

      {error && !creating && <p className="text-red-600 text-sm">⚠ {error}</p>}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                {['Username', 'Name', 'Role', 'Cohort', 'Token budget', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map(s => editId === s.id ? (
                <tr key={s.id} className="bg-blue-50">
                  <td className="px-4 py-2 font-mono text-slate-500 text-xs">{s.username}</td>
                  <td className="px-2 py-2">
                    <input value={editForm.display_name} onChange={e => setEditForm(f => ({ ...f, display_name: e.target.value }))}
                      className={`${inputCls} w-32`} placeholder="Display name" />
                  </td>
                  <td className="px-2 py-2 text-slate-400 text-xs">{s.role}</td>
                  <td className="px-2 py-2">
                    <select value={editForm.cohort_id} onChange={e => setEditForm(f => ({ ...f, cohort_id: e.target.value }))} className={inputCls}>
                      <option value="">— none —</option>
                      {cohorts.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2" colSpan={2}>
                    <input value={editForm.new_password} onChange={e => setEditForm(f => ({ ...f, new_password: e.target.value }))}
                      type="password" className={`${inputCls} w-32`} placeholder="New password (opt)" />
                  </td>
                  <td className="px-2 py-2 flex gap-1">
                    <button onClick={() => handleSaveEdit(s.id)} className={`${btnSm} bg-green-600 text-white hover:bg-green-700`}>Save</button>
                    <button onClick={() => setEditId(null)} className={`${btnSm} bg-slate-200 text-slate-700 hover:bg-slate-300`}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <>
                  <tr key={s.id} className={`hover:bg-slate-50 ${detailId === s.id ? 'bg-violet-50/50' : ''}`}>
                    <td className="px-4 py-3 font-mono text-slate-700 text-xs">{s.username}</td>
                    <td className="px-4 py-3 text-slate-800 font-medium">{s.display_name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.role === 'admin' ? 'bg-red-100 text-red-700' : s.role === 'teacher' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {s.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{s.cohort_id || '—'}</td>
                    <td className="px-4 py-3">
                      {s.token_blocked_at ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          ⛔ Blocked
                        </span>
                      ) : s.token_limit ? (
                        <span className="text-xs text-slate-600">
                          Limit: <strong>{s.token_limit.toLocaleString()}</strong>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Unlimited</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.has_active_session
                        ? <span className="flex items-center gap-1 text-green-600 text-xs"><span className="w-2 h-2 bg-green-500 rounded-full inline-block animate-pulse" />Active</span>
                        : <span className="text-slate-400 text-xs">Offline</span>}
                    </td>
                    {role === 'admin' && (
                      <td className="px-4 py-3 flex gap-1">
                        <button onClick={() => startEdit(s)} className={`${btnSm} bg-slate-100 text-slate-700 hover:bg-slate-200`}>Edit</button>
                        <button
                          onClick={() => setDetailId(d => d === s.id ? null : s.id)}
                          className={`${btnSm} ${detailId === s.id ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700 hover:bg-violet-100'}`}>
                          {detailId === s.id ? 'Close' : 'Manage'}
                        </button>
                        <button onClick={() => handleDelete(s.id, s.username)} className={`${btnSm} bg-red-50 text-red-600 hover:bg-red-100`}>Del</button>
                      </td>
                    )}
                  </tr>
                  {detailId === s.id && role === 'admin' && (
                    <tr key={`${s.id}-detail`}>
                      <td colSpan={7} className="px-0 py-0 border-t-2 border-violet-200">
                        <StudentDetail
                          token={token}
                          student={s}
                          allModels={allModels}
                          onSaved={load}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {students.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">No accounts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Student management panel ─────────────────────────────────────────────────
//
// Shown as a full-width row below the student.  Manages its own data fetching
// so saves never lose state (parent only does a silent background sync).

function StudentDetail({
  token,
  student,
  allModels,
  onSaved,
}: {
  token: string
  student: AdminStudent
  allModels: Model[]
  onSaved: () => void
}) {
  // ── Token budget state ───────────────────────────────────────────────────
  const [tokenLimit,   setTokenLimit]   = useState(String(student.token_limit ?? ''))
  const [banner,       setBanner]       = useState(student.token_block_banner ?? '')
  const [tokenUsage,   setTokenUsage]   = useState<{
    total_tokens_used: number
    token_limit: number | null
    token_blocked_at: string | null
    token_block_banner: string | null
  } | null>(null)
  const [savingBudget, setSavingBudget] = useState(false)
  const [budgetMsg,    setBudgetMsg]    = useState<{ ok: boolean; text: string } | null>(null)

  // ── Model assignment state ───────────────────────────────────────────────
  const [assignedModels, setAssignedModels] = useState<string[]>([])
  const [loadingModels,  setLoadingModels]  = useState(true)
  const [savingModels,   setSavingModels]   = useState(false)
  const [modelsMsg,      setModelsMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  const enabledModels = allModels.filter(m => m.enabled)

  // ── Re-sync token form when parent reloads the student row ───────────────
  useEffect(() => {
    setTokenLimit(String(student.token_limit ?? ''))
    setBanner(student.token_block_banner ?? '')
  }, [student.token_limit, student.token_block_banner, student.token_blocked_at])

  // ── Fetch live data: usage + raw model assignments ───────────────────────
  function fetchDetail() {
    Promise.all([
      api.adminGetStudentTokenUsage(token, student.id),
      api.adminGetStudentModels(token, student.id),
    ]).then(([usage, modelsResp]) => {
      setTokenUsage(usage)
      setAssignedModels(modelsResp.models)
      setLoadingModels(false)
    }).catch(() => setLoadingModels(false))
  }

  useEffect(() => { fetchDetail() }, [token, student.id])

  // ── Token budget handlers ────────────────────────────────────────────────
  async function handleSaveBudget(e: FormEvent) {
    e.preventDefault()
    setSavingBudget(true); setBudgetMsg(null)
    try {
      const limit = tokenLimit.trim() === '' ? null : parseInt(tokenLimit, 10)
      await api.adminSetTokenLimit(token, student.id, limit, banner.trim())
      setBudgetMsg({ ok: true, text: 'Token budget saved.' })
      fetchDetail()   // refresh our own live data
      onSaved()       // silent background sync of parent table
    } catch (err) {
      setBudgetMsg({ ok: false, text: err instanceof Error ? err.message : 'Save failed' })
    } finally { setSavingBudget(false) }
  }

  async function handleClearBlock() {
    setSavingBudget(true); setBudgetMsg(null)
    try {
      await api.adminClearTokenBlock(token, student.id)
      setBudgetMsg({ ok: true, text: 'Block cleared. Student can send messages again.' })
      fetchDetail()
      onSaved()
    } finally { setSavingBudget(false) }
  }

  // ── Model assignment handlers ────────────────────────────────────────────
  function toggleModel(name: string) {
    setAssignedModels(prev =>
      prev.includes(name) ? prev.filter(m => m !== name) : [...prev, name]
    )
    setModelsMsg(null)
  }

  async function handleSaveModels() {
    setSavingModels(true); setModelsMsg(null)
    try {
      await api.adminSetStudentModels(token, student.id, assignedModels)
      setModelsMsg({
        ok: true,
        text: assignedModels.length === 0
          ? 'Restriction cleared — student can use all enabled models.'
          : `Saved: ${assignedModels.length} model(s) allowed.`,
      })
      // No parent reload needed — model list lives only in the detail panel.
    } catch (err) {
      setModelsMsg({ ok: false, text: err instanceof Error ? err.message : 'Save failed' })
    } finally { setSavingModels(false) }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm text-slate-800 placeholder-slate-400 bg-white'

  // Usage % for the progress bar
  const usedTokens   = tokenUsage?.total_tokens_used ?? 0
  const limitTokens  = tokenUsage?.token_limit ?? 0
  const usagePct     = limitTokens > 0 ? Math.min(100, Math.round((usedTokens / limitTokens) * 100)) : 0
  const isBlocked    = !!(tokenUsage?.token_blocked_at)

  return (
    <div className="bg-slate-50 border-t border-violet-200">
      {/* Panel header */}
      <div className="px-6 py-3 bg-violet-600 flex items-center gap-3">
        <span className="text-white font-semibold text-sm">Managing: {student.display_name}</span>
        <span className="text-violet-200 text-xs font-mono">@{student.username}</span>
        <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${
          isBlocked ? 'bg-red-200 text-red-800' : 'bg-violet-200 text-violet-800'
        }`}>
          {isBlocked ? '⛔ Blocked' : student.has_active_session ? '● Active session' : '○ Offline'}
        </span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-slate-200">

        {/* ═══════════════════════ LEFT: Token Budget ═══════════════════════ */}
        <div className="p-6 space-y-5">

          {/* Section title */}
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-violet-500 rounded" />
            <h3 className="font-semibold text-slate-800 text-sm">Token Budget</h3>
          </div>

          {/* Live usage card */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Tokens used this student</span>
              {tokenUsage?.token_limit && (
                <span className={`font-semibold ${usagePct >= 90 ? 'text-red-600' : usagePct >= 70 ? 'text-amber-600' : 'text-slate-700'}`}>
                  {usagePct}%
                </span>
              )}
            </div>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-slate-800">{usedTokens.toLocaleString()}</span>
              {tokenUsage?.token_limit
                ? <span className="text-sm text-slate-400 mb-0.5">/ {tokenUsage.token_limit.toLocaleString()} limit</span>
                : <span className="text-sm text-slate-400 mb-0.5">tokens (no limit)</span>
              }
            </div>
            {tokenUsage?.token_limit && (
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${usagePct >= 90 ? 'bg-red-500' : usagePct >= 70 ? 'bg-amber-500' : 'bg-violet-500'}`}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
            )}
          </div>

          {/* Block status banner */}
          {isBlocked && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-700">Student is blocked</p>
                <p className="text-xs text-red-600 mt-0.5">
                  Since {new Date(tokenUsage!.token_blocked_at!).toLocaleString()}
                </p>
                {tokenUsage?.token_block_banner && (
                  <p className="text-xs text-red-500 mt-1 italic">"{tokenUsage.token_block_banner}"</p>
                )}
              </div>
              <button
                onClick={handleClearBlock}
                disabled={savingBudget}
                className="shrink-0 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                Unblock
              </button>
            </div>
          )}

          {/* Budget form */}
          <form onSubmit={handleSaveBudget} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Token limit <span className="text-slate-400 font-normal">(leave empty for unlimited)</span>
              </label>
              <input
                type="number" min={0} step={1000}
                value={tokenLimit}
                onChange={e => { setTokenLimit(e.target.value); setBudgetMsg(null) }}
                placeholder="e.g. 50000"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Block message <span className="text-slate-400 font-normal">(shown to student when limit is hit)</span>
              </label>
              <textarea
                rows={3}
                value={banner}
                onChange={e => { setBanner(e.target.value); setBudgetMsg(null) }}
                placeholder="e.g. You have reached your token limit. Please contact your teacher."
                className={`${inputCls} resize-none`}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={savingBudget}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {savingBudget ? 'Saving…' : 'Save budget'}
              </button>
              {tokenLimit && (
                <button type="button" onClick={() => { setTokenLimit(''); setBudgetMsg(null) }}
                  className="text-xs text-slate-400 hover:text-slate-600">
                  Remove limit
                </button>
              )}
            </div>
            {budgetMsg && (
              <p className={`text-xs font-medium flex items-center gap-1.5 ${budgetMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
                {budgetMsg.ok ? '✓' : '⚠'} {budgetMsg.text}
              </p>
            )}
          </form>
        </div>

        {/* ═══════════════════════ RIGHT: Allowed Models ════════════════════ */}
        <div className="p-6 space-y-5">

          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-violet-500 rounded" />
            <h3 className="font-semibold text-slate-800 text-sm">Allowed Models</h3>
            {!loadingModels && (
              <span className="ml-auto text-xs text-slate-400">
                {assignedModels.length === 0
                  ? 'All enabled'
                  : `${assignedModels.length} of ${enabledModels.length} selected`}
              </span>
            )}
          </div>

          {/* Current restriction badge */}
          {!loadingModels && (
            <div className={`rounded-xl border px-4 py-3 text-xs ${
              assignedModels.length === 0
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-amber-50 border-amber-200 text-amber-700'
            }`}>
              {assignedModels.length === 0 ? (
                <span>✓ No restriction — student can access all <strong>{enabledModels.length}</strong> enabled model(s).</span>
              ) : (
                <span>
                  Student is restricted to: {assignedModels.map((name, i) => {
                    const m = allModels.find(x => x.name === name)
                    return <strong key={name}>{i > 0 ? ', ' : ''}{m?.display_name ?? name}</strong>
                  })}
                </span>
              )}
            </div>
          )}

          {/* Model checkboxes */}
          {loadingModels ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-8 bg-slate-100 rounded-lg animate-pulse" />)}
            </div>
          ) : enabledModels.length === 0 ? (
            <p className="text-xs text-slate-400 bg-slate-100 rounded-xl p-4">
              No enabled models — go to the <strong>AI Models</strong> tab to add some.
            </p>
          ) : (
            <div className="space-y-1.5">
              {enabledModels.map(m => {
                const checked = assignedModels.includes(m.name)
                return (
                  <label
                    key={m.name}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? 'bg-violet-50 border-violet-200'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleModel(m.name)}
                      className="accent-violet-600 w-4 h-4 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{m.display_name}</p>
                      <p className="text-xs text-slate-400 font-mono truncate">{m.name}</p>
                    </div>
                    {checked && <span className="ml-auto text-xs text-violet-600 font-medium shrink-0">Allowed</span>}
                  </label>
                )
              })}
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveModels}
                disabled={savingModels || loadingModels}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {savingModels ? 'Saving…' : 'Save restrictions'}
              </button>
              {assignedModels.length > 0 && (
                <button
                  onClick={() => { setAssignedModels([]); setModelsMsg(null) }}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                >
                  Clear all (allow all)
                </button>
              )}
            </div>
            {modelsMsg && (
              <p className={`text-xs font-medium flex items-center gap-1.5 ${modelsMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
                {modelsMsg.ok ? '✓' : '⚠'} {modelsMsg.text}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Models tab ────────────────────────────────────────────────────────────────

function ModelsTab({ token }: { token: string }) {
  const [models,  setModels]  = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName]   = useState('')
  const [newDisplay, setNewDisplay] = useState('')
  const [error,   setError]   = useState('')

  async function load() {
    setLoading(true)
    try { setModels(await api.adminListModels(token)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    try {
      await api.adminCreateModel(token, newName.trim(), newDisplay.trim())
      setNewName(''); setNewDisplay(''); setCreating(false); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed') }
  }

  async function handleToggleEnabled(m: Model) {
    try {
      await api.adminSetModelEnabled(token, m.id, m.enabled === 0)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed') }
  }

  async function handleDelete(m: Model) {
    if (!confirm(`Delete model "${m.display_name}"? Students already assigned this model will fall back to the default.`)) return
    try { await api.adminDeleteModel(token, m.id); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  const inputCls = 'px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-800 placeholder-slate-400'
  const btnSm = 'px-2 py-1 rounded text-xs font-medium transition-colors'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-700">AI Models</h2>
        <button
          onClick={() => setCreating(c => !c)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {creating ? 'Cancel' : '+ Add model'}
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3 max-w-md">
          <div className="font-medium text-sm text-slate-700">Add model</div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Model name (exact API identifier)</label>
            <input required value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="e.g. claude-opus-4-5" className={`${inputCls} w-full font-mono`} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Display name (shown to students)</label>
            <input required value={newDisplay} onChange={e => setNewDisplay(e.target.value)}
              placeholder="e.g. Claude Opus 4.5" className={`${inputCls} w-full`} />
          </div>
          {error && <p className="text-red-600 text-sm">⚠ {error}</p>}
          <button type="submit" className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg">
            Add model
          </button>
        </form>
      )}

      {error && !creating && <p className="text-red-600 text-sm">⚠ {error}</p>}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                {['Display name', 'Model ID', 'Status', 'Added', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {models.map(m => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-800 font-medium">{m.display_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{m.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {m.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(m.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 flex gap-1">
                    <button onClick={() => handleToggleEnabled(m)} className={`${btnSm} ${m.enabled ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
                      {m.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => handleDelete(m)} className={`${btnSm} bg-red-50 text-red-600 hover:bg-red-100`}>Del</button>
                  </td>
                </tr>
              ))}
              {models.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">No models yet — the default (grok-4-1-fast-reasoning) is seeded on server start.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Cohorts tab ──────────────────────────────────────────────────────────────

function CohortsTab({ token }: { token: string }) {
  const [cohorts,  setCohorts]  = useState<Cohort[]>([])
  const [loading,  setLoading]  = useState(true)
  const [creating, setCreating] = useState(false)
  const [slug,     setSlug]     = useState('')
  const [title,    setTitle]    = useState('')
  const [error,    setError]    = useState('')
  const [editId,   setEditId]   = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ slug: '', title: '' })

  async function load() {
    setLoading(true)
    try { setCohorts(await api.adminListCohorts(token)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    try {
      await api.adminCreateCohort(token, slug.trim(), title.trim())
      setSlug(''); setTitle(''); setCreating(false); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed') }
  }

  function startEdit(c: Cohort) {
    setEditId(c.id); setEditForm({ slug: c.id, title: c.title }); setError('')
  }

  async function handleSaveEdit(oldId: string) {
    try {
      await api.adminUpdateCohort(token, oldId, editForm.slug !== oldId ? editForm.slug : undefined, editForm.title)
      setEditId(null); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed') }
  }

  async function handleDelete(id: string, t: string) {
    if (!confirm(`Delete cohort "${t}" and ALL its subjects + their files? This cannot be undone.`)) return
    try { await api.adminDeleteCohort(token, id); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  const inputCls = 'px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-800 placeholder-slate-400'
  const btnSm = 'px-2 py-1 rounded text-xs font-medium transition-colors'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-700">Cohorts</h2>
        <button onClick={() => setCreating(c => !c)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
          {creating ? 'Cancel' : '+ New cohort'}
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3 max-w-md">
          <div className="font-medium text-sm text-slate-700">Create cohort</div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Slug (ID — e.g. year-5a, primary-2b)</label>
            <input value={slug} onChange={e => setSlug(e.target.value)} required placeholder="e.g. year-5a" pattern="[a-zA-Z0-9_-]+" title="Alphanumeric, dash, underscore only" className={`${inputCls} w-full font-mono`} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required placeholder="e.g. Year 5A — 2025" className={`${inputCls} w-full`} />
          </div>
          {error && <p className="text-red-600 text-sm">⚠ {error}</p>}
          <button type="submit" className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg">Create</button>
        </form>
      )}

      {error && !creating && <p className="text-red-600 text-sm">⚠ {error}</p>}

      {loading ? <p className="text-slate-500 text-sm">Loading…</p> : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>{['Slug (ID)', 'Title', 'Created', ''].map(h => <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cohorts.map(c => editId === c.id ? (
                <tr key={c.id} className="bg-blue-50">
                  <td className="px-2 py-2">
                    <input value={editForm.slug} onChange={e => setEditForm(f => ({ ...f, slug: e.target.value }))}
                      pattern="[a-zA-Z0-9_-]+" className={`${inputCls} w-36 font-mono`} />
                  </td>
                  <td className="px-2 py-2">
                    <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                      className={`${inputCls} w-48`} />
                  </td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-2 py-2 flex gap-1">
                    <button onClick={() => handleSaveEdit(c.id)} className={`${btnSm} bg-green-600 text-white hover:bg-green-700`}>Save</button>
                    <button onClick={() => setEditId(null)} className={`${btnSm} bg-slate-200 text-slate-700 hover:bg-slate-300`}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{c.id}</td>
                  <td className="px-4 py-3 text-slate-800">{c.title}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 flex gap-1">
                    <button onClick={() => startEdit(c)} className={`${btnSm} bg-slate-100 text-slate-700 hover:bg-slate-200`}>Edit</button>
                    <button onClick={() => handleDelete(c.id, c.title)} className={`${btnSm} bg-red-50 text-red-600 hover:bg-red-100`}>Del</button>
                  </td>
                </tr>
              ))}
              {cohorts.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400 text-sm">No cohorts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Subjects tab ──────────────────────────────────────────────────────────────

function SubjectsTab({ token }: { token: string }) {
  const [subjects,     setSubjects]     = useState<Subject[]>([])
  const [cohorts,      setCohorts]      = useState<Cohort[]>([])
  const [loading,      setLoading]      = useState(true)
  const [creating,     setCreating]     = useState(false)
  const [cohortId,     setCohortId]     = useState('')
  const [filterCohort, setFilterCohort] = useState('')
  const [slug,         setSlug]         = useState('')
  const [title,        setTitle]        = useState('')
  const [error,        setError]        = useState('')
  const [editId,       setEditId]       = useState<string | null>(null)
  const [editForm,     setEditForm]     = useState({ slug: '', title: '' })

  async function load(forCohort?: string) {
    setLoading(true)
    try {
      const [s, c] = await Promise.all([
        api.adminListSubjects(token, forCohort || undefined),
        api.adminListCohorts(token),
      ])
      setSubjects(s); setCohorts(c)
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    try {
      await api.adminCreateSubject(token, cohortId, slug.trim(), title.trim())
      setCohortId(''); setSlug(''); setTitle(''); setCreating(false)
      load(filterCohort || undefined)
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed') }
  }

  function startEdit(s: Subject) {
    setEditId(s.id); setEditForm({ slug: s.slug, title: s.title }); setError('')
  }

  async function handleSaveEdit(subj: Subject) {
    try {
      await api.adminUpdateSubject(token, subj.id, editForm.slug !== subj.slug ? editForm.slug : undefined, editForm.title)
      setEditId(null); load(filterCohort || undefined)
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed') }
  }

  async function handleDelete(s: Subject) {
    if (!confirm(`Delete subject "${s.title}" and all its files? This cannot be undone.`)) return
    try { await api.adminDeleteSubject(token, s.id); load(filterCohort || undefined) }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  function cohortTitle(id: string) { return cohorts.find(c => c.id === id)?.title ?? id }

  const inputCls = 'px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-800 placeholder-slate-400'
  const btnSm = 'px-2 py-1 rounded text-xs font-medium transition-colors'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-slate-700">Subjects</h2>
        <div className="flex items-center gap-2">
          <select value={filterCohort} onChange={e => { setFilterCohort(e.target.value); load(e.target.value || undefined) }} className={inputCls}>
            <option value="">All cohorts</option>
            {cohorts.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <button onClick={() => setCreating(c => !c)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            {creating ? 'Cancel' : '+ New subject'}
          </button>
        </div>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3 max-w-md">
          <div className="font-medium text-sm text-slate-700">Create subject</div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Cohort</label>
            <select value={cohortId} onChange={e => setCohortId(e.target.value)} required className={`${inputCls} w-full`}>
              <option value="">— Select cohort —</option>
              {cohorts.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Slug <span className="text-slate-400">(alphanumeric/dash, e.g. mathematics)</span></label>
            <input value={slug} onChange={e => setSlug(e.target.value)} required placeholder="e.g. mathematics" className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required placeholder="e.g. Introduction to Mathematics" className={`${inputCls} w-full`} />
          </div>
          {error && <p className="text-red-600 text-sm">⚠ {error}</p>}
          <button type="submit" className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg">Create</button>
        </form>
      )}

      {error && !creating && <p className="text-red-600 text-sm">⚠ {error}</p>}

      {loading ? <p className="text-slate-500 text-sm">Loading…</p> : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>{['Cohort', 'Slug', 'Title', 'Created', ''].map(h => <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subjects.map(s => editId === s.id ? (
                <tr key={s.id} className="bg-blue-50">
                  <td className="px-4 py-3 text-slate-500 text-xs">{cohortTitle(s.cohort_id)}</td>
                  <td className="px-2 py-2">
                    <input value={editForm.slug} onChange={e => setEditForm(f => ({ ...f, slug: e.target.value }))}
                      pattern="[a-zA-Z0-9_-]+" className={`${inputCls} w-32 font-mono`} />
                  </td>
                  <td className="px-2 py-2">
                    <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                      className={`${inputCls} w-48`} />
                  </td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{new Date(s.created_at).toLocaleDateString()}</td>
                  <td className="px-2 py-2 flex gap-1">
                    <button onClick={() => handleSaveEdit(s)} className={`${btnSm} bg-green-600 text-white hover:bg-green-700`}>Save</button>
                    <button onClick={() => setEditId(null)} className={`${btnSm} bg-slate-200 text-slate-700 hover:bg-slate-300`}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500 text-xs">{cohortTitle(s.cohort_id)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.slug}</td>
                  <td className="px-4 py-3 text-slate-800">{s.title}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(s.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 flex gap-1">
                    <button onClick={() => startEdit(s)} className={`${btnSm} bg-slate-100 text-slate-700 hover:bg-slate-200`}>Edit</button>
                    <button onClick={() => handleDelete(s)} className={`${btnSm} bg-red-50 text-red-600 hover:bg-red-100`}>Del</button>
                  </td>
                </tr>
              ))}
              {subjects.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">No subjects yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-slate-100 rounded-xl p-4 text-xs text-slate-600 max-w-md">
        <p className="font-medium mb-1">After creating a subject:</p>
        <p>Copy course materials (.md files + image folders) into:</p>
        <code className="block mt-1 bg-white rounded px-2 py-1 font-mono">/srv/educlaw/data/subjects/&lt;cohort_id&gt;/&lt;slug&gt;/</code>
      </div>
    </div>
  )
}

// ── Assignments tab ───────────────────────────────────────────────────────────

function AssignmentsTab({ token }: { token: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [subjects,    setSubjects]    = useState<Subject[]>([])
  const [filterSubj,  setFilterSubj]  = useState('')
  const [loading,     setLoading]     = useState(true)
  const [creating,    setCreating]    = useState(false)
  const [form, setForm] = useState<CreateAssignmentBody>({ subject_id: '', title: '', description: '', due_date: '' })
  const [error, setError] = useState('')

  async function load(subjectId?: string) {
    setLoading(true)
    try {
      const [a, s] = await Promise.all([
        api.adminListAssignments(token, subjectId),
        api.adminListSubjects(token),
      ])
      setAssignments(a)
      setSubjects(s)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function handleFilterChange(subjectId: string) {
    setFilterSubj(subjectId)
    load(subjectId || undefined)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    try {
      await api.adminCreateAssignment(token, {
        subject_id:  form.subject_id,
        title:       form.title,
        description: form.description || undefined,
        due_date:    form.due_date    || undefined,
      })
      setForm({ subject_id: '', title: '', description: '', due_date: '' })
      setCreating(false)
      load(filterSubj || undefined)
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed') }
  }

  const inputCls = 'px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-800 placeholder-slate-400'

  function subjectTitle(id: string) {
    return subjects.find(s => s.id === id)?.title ?? id
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-700">Assignments</h2>
        <button
          onClick={() => setCreating(c => !c)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {creating ? 'Cancel' : '+ New assignment'}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs text-slate-500">Filter by subject:</label>
        <select
          value={filterSubj}
          onChange={e => handleFilterChange(e.target.value)}
          className={`${inputCls} min-w-[180px]`}
        >
          <option value="">All subjects</option>
          {subjects.map(s => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3 max-w-lg">
          <div className="font-medium text-sm text-slate-700">Create assignment</div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Subject</label>
            <select required value={form.subject_id} onChange={e => setForm(f => ({ ...f, subject_id: e.target.value }))} className={`${inputCls} w-full`}>
              <option value="">— Select subject —</option>
              {subjects.map(s => (
                <option key={s.id} value={s.id}>{s.title} ({s.id})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Title</label>
            <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Chapter 3 Quiz" className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Description (optional)</label>
            <textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Instructions for the student…" className={`${inputCls} w-full resize-none`} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Due date (optional)</label>
            <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className={`${inputCls} w-full`} />
          </div>
          {error && <p className="text-red-600 text-sm">⚠ {error}</p>}
          <button type="submit" className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg">Create assignment</button>
        </form>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                {['Title', 'Subject', 'Due date', 'Created'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assignments.map(a => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-800 font-medium">{a.title}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{subjectTitle(a.subject_id)}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{a.due_date ? new Date(a.due_date).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(a.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400 text-sm">No assignments yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Sessions tab ──────────────────────────────────────────────────────────────

function SessionsTab({ token }: { token: string }) {
  const [sessions, setSessions] = useState<AdminSession[]>([])
  const [loading, setLoading]   = useState(true)

  async function load() {
    setLoading(true)
    try { setSessions(await api.adminListSessions(token)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function terminate(id: string) {
    if (!confirm('Terminate this session?')) return
    await api.adminTerminateSession(token, id)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-700">Live Sessions</h2>
        <button onClick={load} className="text-sm text-slate-500 hover:text-slate-700">↻ Refresh</button>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                {['Student ID', 'State', 'Idle', 'Started', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.student_id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-slate-800">{s.state}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {s.idle_secs != null ? `${Math.floor(s.idle_secs / 60)}m ${s.idle_secs % 60}s` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(s.started_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => terminate(s.id)} className="text-xs text-red-500 hover:text-red-700">
                      Terminate
                    </button>
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">No active sessions.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
