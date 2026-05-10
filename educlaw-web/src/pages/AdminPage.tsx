import { Fragment, useState, useEffect, type FormEvent } from "react";
import {
  GraduationCap,
  LogOut,
  Users,
  BookOpen,
  FolderOpen,
  ClipboardList,
  Monitor,
  Cpu,
  Plus,
  X,
  Coins,
  Lock,
  Eye,
  Brain,
  Edit2,
  Check,
} from "lucide-react";
import {
  api,
  type AdminStudent,
  type AdminSession,
  type CreateStudentBody,
  type CreateAssignmentBody,
  normalizeThinkingParams,
} from "../api/client";
import type { Cohort, Subject, Assignment, Model } from "../api/types";
import ThinkingConfigEditor from "../components/ThinkingConfigEditor";

interface Props {
  token: string;
  role: string;
  displayName: string;
  onLogout: () => void;
}

type Tab =
  | "students"
  | "cohorts"
  | "subjects"
  | "assignments"
  | "sessions"
  | "models";

export default function AdminPage({
  token,
  role,
  displayName,
  onLogout,
}: Props) {
  const [tab, setTab] = useState<Tab>("students");

  const tabCls = (t: Tab) => {
    const isActive = tab === t;
    return `flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-wp-md transition-all duration-200 ${
      isActive
        ? "bg-wp-accent text-wp-on-accent shadow-md shadow-wp-accent/20"
        : "text-wp-text-secondary bg-wp-inset hover:bg-wp-border-soft hover:text-wp-text-primary"
    }`;
  };

  return (
    <div className="min-h-screen bg-wp-page">
      {/* Header */}
      <header className="bg-wp-surface border-b border-wp-border-soft px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-wp-xl bg-wp-accent text-wp-on-accent shadow-lg shadow-wp-accent/20">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-wp-text-primary text-xl">
                EduClaw Admin
              </h1>
              <p className="text-sm text-wp-text-secondary font-medium capitalize">
                {role} · {displayName}
              </p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 px-4 py-2.5 bg-wp-error-bg hover:bg-wp-error/10 text-wp-error font-semibold rounded-wp-md transition-all text-sm border border-wp-error/20"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="bg-wp-surface border-b border-wp-border-soft px-6 py-4">
        <div className="max-w-7xl mx-auto flex gap-2 flex-wrap">
          <button
            className={tabCls("students")}
            onClick={() => setTab("students")}
          >
            <Users className="w-4 h-4" /> Students
          </button>
          <button
            className={tabCls("cohorts")}
            onClick={() => setTab("cohorts")}
          >
            <FolderOpen className="w-4 h-4" /> Cohorts
          </button>
          <button
            className={tabCls("subjects")}
            onClick={() => setTab("subjects")}
          >
            <BookOpen className="w-4 h-4" /> Subjects
          </button>
          <button
            className={tabCls("assignments")}
            onClick={() => setTab("assignments")}
          >
            <ClipboardList className="w-4 h-4" /> Assignments
          </button>
          <button
            className={tabCls("sessions")}
            onClick={() => setTab("sessions")}
          >
            <Monitor className="w-4 h-4" /> Live Sessions
          </button>
          <button className={tabCls("models")} onClick={() => setTab("models")}>
            <Cpu className="w-4 h-4" /> AI Models
          </button>
        </div>
      </div>

      <main className="px-6 py-8 max-w-7xl mx-auto">
        {tab === "students" && <StudentsTab token={token} role={role} />}
        {tab === "cohorts" && <CohortsTab token={token} />}
        {tab === "subjects" && <SubjectsTab token={token} />}
        {tab === "assignments" && <AssignmentsTab token={token} />}
        {tab === "sessions" && <SessionsTab token={token} />}
        {tab === "models" && <ModelsTab token={token} />}
      </main>
    </div>
  );
}

// Shared input styles
const inputCls =
  "w-full px-3.5 py-2.5 rounded-wp-md border border-wp-border-mid bg-white focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent text-wp-text-primary text-sm transition-all duration-200 placeholder-wp-text-tertiary";
const btnSm =
  "px-2.5 py-1.5 rounded-wp-md text-xs font-semibold transition-all duration-200";

// ── Students tab ────────────────────────────────────────────────────────────

function StudentsTab({ token, role }: { token: string; role: string }) {
  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [allModels, setAllModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    display_name: "",
    cohort_id: "",
    new_password: "",
  });
  const [detailId, setDetailId] = useState<string | null>(null);

  async function load(isFirstLoad = false) {
    if (isFirstLoad) setLoading(true);
    else setSyncing(true);
    try {
      const [s, c, m] = await Promise.all([
        api.adminListStudents(token),
        api.adminListCohorts(token),
        api.adminListModels(token),
      ]);
      setStudents(s);
      setCohorts(c);
      setAllModels(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  useEffect(() => {
    load(true);
  }, []);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const get = (name: string) =>
      (
        form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement
      ).value.trim();
    const body: CreateStudentBody = {
      username: get("username"),
      password: get("password"),
      display_name: get("display_name"),
      role: get("role") as CreateStudentBody["role"],
      cohort_id: get("cohort_id"),
    };
    try {
      await api.adminCreateStudent(token, body);
      form.reset();
      setCreating(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  }

  function startEdit(s: AdminStudent) {
    setEditId(s.id);
    setEditForm({
      display_name: s.display_name,
      cohort_id: s.cohort_id,
      new_password: "",
    });
    setError("");
  }

  async function handleSaveEdit(id: string) {
    try {
      await api.adminUpdateStudent(token, id, {
        display_name: editForm.display_name || undefined,
        cohort_id: editForm.cohort_id || undefined,
        new_password: editForm.new_password || undefined,
      });
      setEditId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleDelete(id: string, username: string) {
    if (!confirm(`Delete account "${username}"? This cannot be undone.`))
      return;
    try {
      await api.adminDeleteStudent(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const roleBadge = (r: string) => {
    const colors: Record<string, string> = {
      admin: "bg-red-100 text-red-700 border-red-200",
      teacher: "bg-purple-100 text-purple-700 border-purple-200",
      student:
        "bg-wp-accent-subtle text-wp-text-secondary border-wp-border-soft",
    };
    return `px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[r] || colors.student}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-wp-text-primary">
            Students & Staff
          </h2>
          {syncing && (
            <span className="text-xs text-wp-text-tertiary animate-pulse">
              Syncing…
            </span>
          )}
        </div>
        {role === "admin" && (
          <button
            onClick={() => setCreating((c) => !c)}
            className="flex items-center gap-2 px-4 py-2.5 bg-wp-accent hover:bg-wp-accent-hover text-wp-on-accent text-sm font-semibold rounded-wp-md transition-all shadow-md shadow-wp-accent/20"
          >
            {creating ? (
              <X className="w-4 h-4" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {creating ? "Cancel" : "+ New account"}
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="bg-wp-surface border border-wp-border-soft rounded-wp-xl p-5 grid grid-cols-2 gap-4"
        >
          <div className="col-span-2 font-semibold text-wp-text-primary text-sm mb-1">
            Create account
          </div>
          <input
            name="username"
            required
            placeholder="Username"
            className={inputCls}
          />
          <input
            name="password"
            required
            placeholder="Password"
            type="password"
            className={inputCls}
          />
          <input
            name="display_name"
            required
            placeholder="Display name"
            className={inputCls}
          />
          <select name="role" className={inputCls}>
            <option value="student">Student</option>
            <option value="teacher">Teacher</option>
            <option value="admin">Admin</option>
          </select>
          <select
            name="cohort_id"
            required
            className={`${inputCls} col-span-2`}
          >
            <option value="">— Select cohort —</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.id})
              </option>
            ))}
          </select>
          {error && (
            <p className="col-span-2 text-wp-error text-sm font-medium">
              ⚠ {error}
            </p>
          )}
          <button
            type="submit"
            className="col-span-2 py-2.5 bg-wp-text-primary hover:bg-wp-text-secondary text-wp-on-accent text-sm font-semibold rounded-wp-md"
          >
            Create
          </button>
        </form>
      )}

      {error && !creating && (
        <p className="text-wp-error text-sm font-medium">⚠ {error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-wp-accent border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-wp-surface border border-wp-border-soft rounded-wp-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-wp-inset text-wp-text-secondary text-xs uppercase">
              <tr>
                {[
                  "Username",
                  "Name",
                  "Role",
                  "Cohort",
                  "Token budget",
                  "Status",
                  "",
                ].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-wp-border-ghost">
              {students.map((s) =>
                editId === s.id ? (
                  <tr key={s.id} className="bg-wp-accent-subtle">
                    <td className="px-4 py-2.5 font-mono text-wp-text-tertiary text-xs">
                      {s.username}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={editForm.display_name}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            display_name: e.target.value,
                          }))
                        }
                        className={`${inputCls} w-32`}
                        placeholder="Display name"
                      />
                    </td>
                    <td className="px-2 py-2 text-wp-text-tertiary text-xs">
                      {s.role}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={editForm.cohort_id}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            cohort_id: e.target.value,
                          }))
                        }
                        className={inputCls}
                      >
                        <option value="">— none —</option>
                        {cohorts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2" colSpan={2}>
                      <input
                        value={editForm.new_password}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            new_password: e.target.value,
                          }))
                        }
                        type="password"
                        className={`${inputCls} w-32`}
                        placeholder="New password (opt)"
                      />
                    </td>
                    <td className="px-2 py-2 flex gap-1.5">
                      <button
                        onClick={() => handleSaveEdit(s.id)}
                        className={`${btnSm} bg-wp-success text-white hover:bg-wp-success/90`}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className={`${btnSm} bg-wp-border-soft text-wp-text-secondary hover:bg-wp-border-mid`}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <Fragment key={s.id}>
                    <tr
                      key={s.id}
                      className={`hover:bg-wp-inset ${detailId === s.id ? "bg-wp-accent-subtle/50" : ""}`}
                    >
                      <td className="px-4 py-3.5 font-mono text-wp-text-secondary text-xs">
                        {s.username}
                      </td>
                      <td className="px-4 py-3.5 text-wp-text-primary font-medium">
                        {s.display_name}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={roleBadge(s.role)}>{s.role}</span>
                      </td>
                      <td className="px-4 py-3.5 text-wp-text-tertiary text-xs">
                        {s.cohort_id || "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        {s.token_blocked_at ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200">
                            ⛔ Blocked
                          </span>
                        ) : s.token_limit ? (
                          <span className="text-xs text-wp-text-secondary">
                            Limit:{" "}
                            <strong className="text-wp-text-primary">
                              {s.token_limit.toLocaleString()}
                            </strong>
                          </span>
                        ) : (
                          <span className="text-xs text-wp-text-tertiary">
                            Unlimited
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {s.has_active_session ? (
                          <span className="flex items-center gap-1.5 text-wp-success text-xs font-medium">
                            <span className="w-2 h-2 bg-wp-success rounded-full inline-block animate-pulse" />
                            Active
                          </span>
                        ) : (
                          <span className="text-wp-text-tertiary text-xs">
                            Offline
                          </span>
                        )}
                      </td>
                      {role === "admin" && (
                        <td className="px-4 py-3.5 flex gap-1.5">
                          <button
                            onClick={() => startEdit(s)}
                            className={`${btnSm} bg-wp-bgSurface border border-wp-borderMid text-wp-textSecondary hover:border-wp-borderHard hover:bg-wp-bgSurfaceAlt`}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              setDetailId((d) => (d === s.id ? null : s.id))
                            }
                            className={`${btnSm} flex items-center gap-1.5 ${detailId === s.id ? "bg-wp-accent text-white border border-wp-borderHard" : "bg-wp-bgInset text-wp-textSecondary border border-wp-borderMid hover:bg-wp-bgSurface hover:border-wp-borderHard"}`}
                          >
                            <Coins size={14} />
                            {detailId === s.id ? "Close" : "Tokens"}
                          </button>
                          <button
                            onClick={() => handleDelete(s.id, s.username)}
                            className={`${btnSm} bg-wp-errorBg text-wp-error border border-wp-error/30 hover:bg-wp-error/20`}
                          >
                            Del
                          </button>
                        </td>
                      )}
                    </tr>
                    {detailId === s.id && role === "admin" && (
                      <tr key={`${s.id}-detail`}>
                        <td
                          colSpan={7}
                          className="px-0 py-0 border-t-2 border-wp-accent/30"
                        >
                          <StudentDetail
                            token={token}
                            student={s}
                            allModels={allModels}
                            onSaved={load}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ),
              )}
              {students.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-wp-text-tertiary text-sm"
                  >
                    No accounts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Student management panel ─────────────────────────────────────────────────

function StudentDetail({
  token,
  student,
  allModels,
  onSaved,
}: {
  token: string;
  student: AdminStudent;
  allModels: Model[];
  onSaved: () => void;
}) {
  const [tokenBalance, setTokenBalance] = useState(student.token_balance);
  const [topupAmount, setTopupAmount] = useState("");
  const [deductAmount, setDeductAmount] = useState("");
  const [savingBalance, setSavingBalance] = useState(false);
  const [balanceMsg, setBalanceMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const [assignedModels, setAssignedModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [savingModels, setSavingModels] = useState(false);
  const [modelsMsg, setModelsMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const enabledModels = allModels.filter((m) => m.enabled);

  useEffect(() => {
    setTokenBalance(student.token_balance);
  }, [student.token_balance]);

  function fetchDetail() {
    api
      .adminGetStudentModels(token, student.id)
      .then((modelsResp) => {
        setAssignedModels(modelsResp.models);
        setLoadingModels(false);
      })
      .catch(() => setLoadingModels(false));
  }

  useEffect(() => {
    fetchDetail();
  }, [token, student.id]);

  function toggleModel(name: string) {
    setAssignedModels((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name],
    );
    setModelsMsg(null);
  }

  async function handleSaveModels() {
    setSavingModels(true);
    setModelsMsg(null);
    try {
      await api.adminSetStudentModels(token, student.id, assignedModels);
      setModelsMsg({
        ok: true,
        text:
          assignedModels.length === 0
            ? "Restriction cleared — student can use all enabled models."
            : `Saved: ${assignedModels.length} model(s) allowed.`,
      });
    } catch (err) {
      setModelsMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSavingModels(false);
    }
  }

  async function handleTopup(e: FormEvent) {
    e.preventDefault();
    const amt = parseInt(topupAmount, 10);
    if (isNaN(amt) || amt <= 0) {
      setBalanceMsg({ ok: false, text: "Enter a positive amount" });
      return;
    }
    setSavingBalance(true);
    setBalanceMsg(null);
    try {
      const data = await api.adminTopupTokens(token, student.id, amt);
      setTokenBalance(data.new_balance);
      setTopupAmount("");
      setBalanceMsg({
        ok: true,
        text: `✓ Added ${amt} tokens. New balance: ${data.new_balance.toLocaleString()}`,
      });
      onSaved();
    } catch (err) {
      setBalanceMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Topup failed",
      });
    } finally {
      setSavingBalance(false);
    }
  }

  async function handleDeduct(e: FormEvent) {
    e.preventDefault();
    const amt = parseInt(deductAmount, 10);
    if (isNaN(amt) || amt <= 0) {
      setBalanceMsg({ ok: false, text: "Enter a positive amount" });
      return;
    }
    setSavingBalance(true);
    setBalanceMsg(null);
    try {
      const data = await api.adminDeductTokens(token, student.id, amt);
      setTokenBalance(data.new_balance);
      setDeductAmount("");
      setBalanceMsg({
        ok: true,
        text: `✓ Deducted ${amt} tokens. New balance: ${data.new_balance.toLocaleString()}`,
      });
      onSaved();
    } catch (err) {
      setBalanceMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Deduct failed",
      });
    } finally {
      setSavingBalance(false);
    }
  }

  const panelInputCls =
    "w-full px-3 py-2 rounded-wp-md border border-wp-border-mid bg-white focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent text-wp-text-primary text-sm placeholder-wp-text-tertiary";

  return (
    <div className="bg-wp-inset border-t border-wp-border-soft">
      {/* Panel header */}
      <div className="px-6 py-3 bg-wp-accent flex items-center gap-3">
        <span className="text-white font-semibold text-sm">
          Managing: {student.display_name}
        </span>
        <span className="text-wp-accent-muted text-xs font-mono">
          @{student.username}
        </span>
        <span className="ml-auto px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/20 text-white">
          {student.has_active_session ? "● Active session" : "○ Offline"}
        </span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-wp-border-soft">
        {/* LEFT: Token Balance Management */}
        <div className="p-6 space-y-5">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-wp-accent rounded" />
            <Coins size={16} className="text-wp-accent" />
            <h3 className="font-semibold text-wp-text-primary text-sm">
              Token Balance
            </h3>
          </div>

          <div className="bg-wp-inset rounded-wp-lg p-4 border border-wp-border-mid">
            <div className="text-xs text-wp-text-secondary mb-1">
              Current balance
            </div>
            <div className="text-3xl font-bold text-wp-accent tabular-nums">
              {(tokenBalance ?? 0).toLocaleString()}
            </div>
            <div className="text-xs text-wp-text-tertiary mt-2">
              tokens allocated to {student.display_name}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Topup form */}
            <form onSubmit={handleTopup} className="space-y-2">
              <label className="block text-xs font-semibold text-wp-text-secondary">
                Add tokens
              </label>
              <input
                type="number"
                min={1}
                value={topupAmount}
                onChange={(e) => {
                  setTopupAmount(e.target.value);
                  setBalanceMsg(null);
                }}
                placeholder="Amount"
                className={`${panelInputCls} text-sm`}
                disabled={savingBalance}
              />
              <button
                type="submit"
                disabled={savingBalance}
                className="w-full px-3 py-2 bg-orange-500 text-white hover:bg-orange-600 text-xs font-medium rounded-lg disabled:opacity-50 border border-orange-500 transition-colors font-semibold"
              >
                {savingBalance ? "Adding…" : "Add"}
              </button>
            </form>

            {/* Deduct form */}
            <form onSubmit={handleDeduct} className="space-y-2">
              <label className="block text-xs font-semibold text-wp-text-secondary">
                Remove tokens
              </label>
              <input
                type="number"
                min={1}
                value={deductAmount}
                onChange={(e) => {
                  setDeductAmount(e.target.value);
                  setBalanceMsg(null);
                }}
                placeholder="Amount"
                className={`${panelInputCls} text-sm`}
                disabled={savingBalance}
              />
              <button
                type="submit"
                disabled={savingBalance}
                className="w-full px-3 py-2 bg-red-500 text-white hover:bg-red-600 text-xs font-medium rounded-lg disabled:opacity-50 border border-red-500 transition-colors font-semibold"
              >
                {savingBalance ? "Removing…" : "Remove"}
              </button>
            </form>
          </div>

          {balanceMsg && (
            <p
              className={`text-xs font-medium flex items-center gap-1.5 ${balanceMsg.ok ? "text-wp-success" : "text-wp-error"}`}
            >
              {balanceMsg.ok ? "✓" : "⚠"} {balanceMsg.text}
            </p>
          )}

          {(tokenBalance ?? 0) < 0 && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-wp-lg p-4">
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-700">
                  Negative balance
                </p>
                <p className="text-xs text-red-600 mt-0.5">
                  Student has {Math.abs(tokenBalance ?? 0).toLocaleString()}{" "}
                  tokens in debt. They can still use the system.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Allowed Models */}
        <div className="p-6 space-y-5">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-wp-accent rounded" />
            <Lock size={16} className="text-wp-accent" />
            <h3 className="font-semibold text-wp-text-primary text-sm">
              Model Access
            </h3>
            {!loadingModels && (
              <span className="ml-auto text-xs text-wp-text-tertiary">
                {assignedModels.length === 0
                  ? "All enabled"
                  : `${assignedModels.length} of ${enabledModels.length} selected`}
              </span>
            )}
          </div>

          {!loadingModels && (
            <div
              className={`rounded-wp-lg border px-4 py-3 text-xs ${
                assignedModels.length === 0
                  ? "bg-wp-success-bg border-wp-success/20 text-wp-success"
                  : "bg-wp-warning-bg border-wp-warning/20 text-wp-warning"
              }`}
            >
              {assignedModels.length === 0 ? (
                <span>
                  ✓ No restriction — student can access all{" "}
                  <strong>{enabledModels.length}</strong> enabled model(s).
                </span>
              ) : (
                <span>
                  Student is restricted to:{" "}
                  {assignedModels.map((name, i) => {
                    const m = allModels.find((x) => x.name === name);
                    return (
                      <strong key={name}>
                        {i > 0 ? ", " : ""}
                        {m?.display_name ?? name}
                      </strong>
                    );
                  })}
                </span>
              )}
            </div>
          )}

          {loadingModels ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-10 bg-wp-border-ghost rounded-wp-lg animate-pulse"
                />
              ))}
            </div>
          ) : enabledModels.length === 0 ? (
            <p className="text-xs text-wp-text-tertiary bg-wp-inset rounded-wp-lg p-4">
              No enabled models — go to the <strong>AI Models</strong> tab to
              add some.
            </p>
          ) : (
            <div className="space-y-1.5">
              {enabledModels.map((m) => {
                const checked = assignedModels.includes(m.name);
                return (
                  <label
                    key={m.name}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-wp-lg border cursor-pointer transition-colors ${
                      checked
                        ? "bg-wp-accent-subtle border-wp-accent/30"
                        : "bg-white border-wp-border-soft hover:bg-wp-inset"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleModel(m.name)}
                      className="accent-wp-accent w-4 h-4 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-wp-text-primary">
                        {m.display_name}
                      </p>
                      <p className="text-xs text-wp-text-tertiary font-mono truncate">
                        {m.name}
                      </p>
                    </div>
                    {checked && (
                      <span className="ml-auto text-xs text-wp-accent font-medium shrink-0">
                        Allowed
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveModels}
                disabled={savingModels || loadingModels}
                className="px-4 py-2 bg-green-600 text-white hover:bg-green-700 text-xs font-medium rounded-lg disabled:opacity-50 border border-green-600 transition-colors font-semibold"
              >
                {savingModels ? "Saving\u2026" : "Save restrictions"}
              </button>
              {assignedModels.length > 0 && (
                <button
                  onClick={() => {
                    setAssignedModels([]);
                    setModelsMsg(null);
                  }}
                  className="text-xs text-wp-text-tertiary hover:text-red-500 transition-colors"
                >
                  Clear all (allow all)
                </button>
              )}
            </div>
            {modelsMsg && (
              <p
                className={`text-xs font-medium flex items-center gap-1.5 ${modelsMsg.ok ? "text-wp-success" : "text-wp-error"}`}
              >
                {modelsMsg.ok ? "✓" : "⚠"} {modelsMsg.text}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Models tab ────────────────────────────────────────────────────────────────

function ModelsTab({ token }: { token: string }) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [newMultiplier, setNewMultiplier] = useState("1.0");
  const [newProvider, setNewProvider] = useState("");
  const [newThinkMode, setNewThinkMode] = useState<string>("");
  const [newVisualSupport, setNewVisualSupport] = useState(false);
  const [error, setError] = useState("");
  const [editingMultiplier, setEditingMultiplier] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const [editingSpecs, setEditingSpecs] = useState<{
    id: string;
    provider: string;
    think_mode: string;
    visual_support: boolean;
  } | null>(null);
  const [editingThinking, setEditingThinking] = useState<Record<
    string,
    unknown
  > | null>(null);

  async function load() {
    setLoading(true);
    try {
      setModels(await api.adminListModels(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    try {
      const multiplier = parseFloat(newMultiplier) || 1.0;
      const modelId = await api.adminCreateModel(
        token,
        newName.trim(),
        newDisplay.trim(),
        multiplier,
      );

      // Update specs if provider or capabilities are set
      if (newProvider || newThinkMode || newVisualSupport) {
        await api.adminUpdateModelSpecs(
          token,
          modelId.id,
          newProvider || null,
          newThinkMode ? parseInt(newThinkMode) : null,
          newVisualSupport ? 1 : 0,
        );
      }

      setNewName("");
      setNewDisplay("");
      setNewMultiplier("1.0");
      setNewProvider("");
      setNewThinkMode("");
      setNewVisualSupport(false);
      setCreating(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  }

  async function handleToggleEnabled(m: Model) {
    try {
      await api.adminSetModelEnabled(token, m.id, m.enabled === 0);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleSetMultiplier(modelName: string, multiplier: number) {
    try {
      await api.adminSetModelMultiplier(token, modelName, multiplier);
      setEditingMultiplier(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleUpdateSpecs(
    id: string,
    provider: string | null,
    think_mode: number | null,
    visual_support: number,
  ) {
    try {
      await api.adminUpdateModelSpecs(
        token,
        id,
        provider,
        think_mode,
        visual_support,
      );
      // Save thinking params if they were edited
      if (editingThinking !== null) {
        await api.adminUpdateModelThinking(token, id, editingThinking);
        setEditingThinking(null);
      }
      setEditingSpecs(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleDelete(m: Model) {
    if (
      !confirm(
        `Delete model "${m.display_name}"? Students already assigned this model will fall back to the default.`,
      )
    )
      return;
    try {
      await api.adminDeleteModel(token, m.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-wp-text-primary">AI Models</h2>
        <button
          onClick={() => setCreating((c) => !c)}
          className="flex items-center gap-2 px-4 py-2.5 bg-wp-accent hover:bg-wp-accent-hover text-wp-on-accent text-sm font-semibold rounded-wp-md transition-all shadow-md shadow-wp-accent/20"
        >
          {creating ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {creating ? "Cancel" : "+ Add model"}
        </button>
      </div>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="bg-wp-surface border border-wp-border-mid rounded-wp-lg p-5 space-y-3 max-w-2xl shadow-sm"
        >
          <div className="font-semibold text-wp-text-primary text-sm">
            Add model
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-wp-text-secondary mb-1.5">
                Model name (exact API identifier)
              </label>
              <input
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. claude-opus-4-5"
                className={`w-full px-3 py-2 rounded-wp-md border border-wp-border-mid bg-wp-page focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent text-wp-text-primary text-sm placeholder-wp-text-tertiary font-mono`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-wp-text-secondary mb-1.5">
                Display name (shown to students)
              </label>
              <input
                required
                value={newDisplay}
                onChange={(e) => setNewDisplay(e.target.value)}
                placeholder="e.g. Claude Opus 4.5"
                className={`w-full px-3 py-2 rounded-wp-md border border-wp-border-mid bg-wp-page focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent text-wp-text-primary text-sm placeholder-wp-text-tertiary`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-wp-text-secondary mb-1.5">
                Provider ID (e.g. openai, anthropic, xai, deepseek)
              </label>
              <input
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value)}
                placeholder="e.g. openai"
                className={`w-full px-3 py-2 rounded-wp-md border border-wp-border-mid bg-wp-page focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent text-wp-text-primary text-sm placeholder-wp-text-tertiary font-mono`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-wp-text-secondary mb-1.5">
                Token multiplier (1.0 = base rate)
              </label>
              <input
                required
                type="number"
                min="0"
                step="0.1"
                value={newMultiplier}
                onChange={(e) => setNewMultiplier(e.target.value)}
                placeholder="e.g. 1.0 or 3.33"
                className={`w-full px-3 py-2 rounded-wp-md border border-wp-border-mid bg-wp-page focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent text-wp-text-primary text-sm placeholder-wp-text-tertiary font-mono`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-wp-text-secondary mb-1.5">
                Thinking mode
              </label>
              <select
                value={newThinkMode}
                onChange={(e) => setNewThinkMode(e.target.value)}
                className={`w-full px-3 py-2 rounded-wp-md border border-wp-border-mid bg-wp-page focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent text-wp-text-primary text-sm`}
              >
                <option value="">Unknown</option>
                <option value="1">Thinking model</option>
                <option value="0">Non-thinking</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                id="newVisualSupport"
                checked={newVisualSupport}
                onChange={(e) => setNewVisualSupport(e.target.checked)}
                className="w-4 h-4 accent-wp-accent"
              />
              <label
                htmlFor="newVisualSupport"
                className="text-sm font-medium text-wp-text-secondary cursor-pointer"
              >
                <Eye className="w-4 h-4 inline mr-1" />
                Supports vision/images
              </label>
            </div>
          </div>
          {error && (
            <p className="text-wp-error text-xs font-medium">⚠ {error}</p>
          )}
          <button
            type="submit"
            className="w-full py-2.5 bg-wp-accent hover:bg-wp-accent-hover text-wp-on-accent text-sm font-semibold rounded-wp-md transition-colors"
          >
            Add model
          </button>
        </form>
      )}

      {error && !creating && (
        <p className="text-wp-error text-sm font-medium">⚠ {error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-wp-accent border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-wp-surface border border-wp-border-mid rounded-wp-lg overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-wp-inset border-b border-wp-border-soft text-wp-text-secondary text-xs uppercase tracking-wide">
              <tr>
                {[
                  "Display name",
                  "Model ID",
                  "Provider",
                  "Capabilities",
                  "Multiplier",
                  "Status",
                  "Added",
                  "",
                ].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-wp-border-ghost">
              {models.map((m) => (
                <Fragment key={m.id}>
                  <tr className="hover:bg-wp-inset/40 transition-colors">
                    <td className="px-4 py-3 text-wp-text-primary font-medium">
                      <div className="flex items-center gap-2">
                        {m.display_name}
                        {m.think_mode === 1 && (
                          <Brain className="w-4 h-4 text-wp-info" />
                        )}
                        {m.visual_support === 1 && (
                          <Eye className="w-4 h-4 text-wp-accent" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-wp-text-tertiary">
                      {m.name}
                    </td>
                    <td className="px-4 py-3 text-xs text-wp-text-tertiary font-mono">
                      {m.provider || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {m.think_mode === 1 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-wp-info-bg text-wp-info border border-wp-info/20">
                            <Brain className="w-3 h-3" /> Think
                          </span>
                        )}
                        {m.visual_support === 1 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-wp-accent-subtle text-wp-accent border border-wp-accent/20">
                            <Eye className="w-3 h-3" /> Vision
                          </span>
                        )}
                        {!m.think_mode && !m.visual_support && (
                          <span className="text-wp-text-tertiary text-xs">
                            —
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {editingMultiplier?.id === m.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={editingMultiplier.value}
                            onChange={(e) =>
                              setEditingMultiplier({
                                ...editingMultiplier,
                                value: e.target.value,
                              })
                            }
                            className="w-16 px-2 py-1 rounded border border-wp-border-mid text-xs font-mono"
                            autoFocus
                          />
                          <button
                            onClick={() =>
                              handleSetMultiplier(
                                m.name,
                                parseFloat(editingMultiplier.value),
                              )
                            }
                            className="px-2 py-1 text-xs font-medium bg-wp-success text-white rounded hover:bg-wp-success/90 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingMultiplier(null)}
                            className="px-2 py-1 text-xs font-medium bg-wp-border-soft text-wp-text-secondary rounded hover:bg-wp-border-mid transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() =>
                            setEditingMultiplier({
                              id: m.id,
                              value: String((m.multiplier as number) || 1.0),
                            })
                          }
                          className="px-2.5 py-1 rounded text-xs font-mono font-semibold bg-wp-accent-subtle text-wp-text-primary border border-wp-border-mid hover:bg-wp-accent-muted transition-colors"
                        >
                          {((m.multiplier as number) || 1.0).toFixed(2)}x
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${m.enabled ? "bg-wp-success-bg text-wp-success border border-wp-success/20" : "bg-wp-border-soft text-wp-text-tertiary border border-wp-border-ghost"}`}
                      >
                        {m.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-wp-text-tertiary text-xs">
                      {new Date(m.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        <button
                          onClick={() => {
                            setEditingSpecs({
                              id: m.id,
                              provider: m.provider || "",
                              think_mode:
                                m.think_mode === null
                                  ? ""
                                  : String(m.think_mode),
                              visual_support: m.visual_support === 1,
                            });
                            setEditingThinking(
                              normalizeThinkingParams(m.thinking_params),
                            );
                          }}
                          className="px-2.5 py-1.5 text-xs font-medium bg-wp-info-bg text-wp-info hover:bg-wp-info/10 rounded-wp-md transition-colors border border-wp-info/20 flex items-center gap-1"
                          title="Update model specs"
                        >
                          <Edit2 className="w-3 h-3" />
                          Specs
                        </button>
                        <button
                          onClick={() => handleToggleEnabled(m)}
                          className={`px-2.5 py-1.5 text-xs font-medium rounded-wp-md transition-colors ${m.enabled ? "bg-wp-border-soft text-wp-text-secondary hover:bg-wp-border-mid" : "bg-wp-success-bg text-wp-success hover:bg-wp-success/20 border border-wp-success/30"}`}
                        >
                          {m.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => handleDelete(m)}
                          className="px-2.5 py-1.5 text-xs font-medium bg-wp-error-bg text-wp-error hover:bg-wp-error/10 rounded-wp-md transition-colors border border-wp-error/20"
                        >
                          Del
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingSpecs?.id === m.id && (
                    <tr
                      key={`${m.id}-specs`}
                      className="bg-wp-accent-subtle/30"
                    >
                      <td colSpan={8} className="px-6 py-4">
                        <div className="bg-wp-surface border border-wp-border-mid rounded-wp-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-wp-text-primary flex items-center gap-2">
                              <Edit2 className="w-4 h-4" />
                              Update Model Specifications
                            </h4>
                            <button
                              onClick={() => setEditingSpecs(null)}
                              className="text-wp-text-tertiary hover:text-wp-text-primary"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-wp-text-secondary mb-1.5">
                                Provider ID
                              </label>
                              <input
                                value={editingSpecs.provider}
                                onChange={(e) =>
                                  setEditingSpecs({
                                    ...editingSpecs,
                                    provider: e.target.value,
                                  })
                                }
                                placeholder="e.g. openai, anthropic, xai"
                                className="w-full px-3 py-2 rounded-wp-md border border-wp-border-mid bg-wp-page focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent text-wp-text-primary text-sm placeholder-wp-text-tertiary font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-wp-text-secondary mb-1.5">
                                Thinking mode
                              </label>
                              <select
                                value={editingSpecs.think_mode}
                                onChange={(e) =>
                                  setEditingSpecs({
                                    ...editingSpecs,
                                    think_mode: e.target.value,
                                  })
                                }
                                className="w-full px-3 py-2 rounded-wp-md border border-wp-border-mid bg-wp-page focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent text-wp-text-primary text-sm"
                              >
                                <option value="">Unknown</option>
                                <option value="1">Thinking model</option>
                                <option value="0">Non-thinking</option>
                              </select>
                            </div>
                            <div className="flex items-end">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editingSpecs.visual_support}
                                  onChange={(e) =>
                                    setEditingSpecs({
                                      ...editingSpecs,
                                      visual_support: e.target.checked,
                                    })
                                  }
                                  className="w-4 h-4 accent-wp-accent"
                                />
                                <span className="text-sm font-medium text-wp-text-secondary">
                                  <Eye className="w-4 h-4 inline mr-1" />
                                  Supports vision
                                </span>
                              </label>
                            </div>
                          </div>
                          {editingSpecs.provider && (
                            <div className="mt-4 p-3 bg-wp-accent-subtle/20 border border-wp-border-soft rounded-wp-md">
                              <ThinkingConfigEditor
                                provider={editingSpecs.provider}
                                value={editingThinking}
                                onChange={setEditingThinking}
                              />
                            </div>
                          )}
                          <div className="flex gap-2 mt-4">
                            <button
                              onClick={() =>
                                handleUpdateSpecs(
                                  m.id,
                                  editingSpecs.provider || null,
                                  editingSpecs.think_mode
                                    ? parseInt(editingSpecs.think_mode)
                                    : null,
                                  editingSpecs.visual_support ? 1 : 0,
                                )
                              }
                              className="px-4 py-2 bg-wp-success text-white hover:bg-wp-success/90 text-sm font-semibold rounded-wp-md transition-colors flex items-center gap-1.5"
                            >
                              <Check className="w-4 h-4" />
                              Save changes
                            </button>
                            <button
                              onClick={() => {
                                setEditingSpecs(null);
                                setEditingThinking(null);
                              }}
                              className="px-4 py-2 bg-wp-border-soft text-wp-text-secondary hover:bg-wp-border-mid text-sm font-medium rounded-wp-md transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {models.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-wp-text-tertiary text-sm"
                  >
                    No models yet — the default (grok-3-fast) is seeded on
                    server start.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Cohorts tab ──────────────────────────────────────────────────────────────

function CohortsTab({ token }: { token: string }) {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ slug: "", title: "" });

  async function load() {
    setLoading(true);
    try {
      setCohorts(await api.adminListCohorts(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await api.adminCreateCohort(token, slug.trim(), title.trim());
      setSlug("");
      setTitle("");
      setCreating(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  }

  function startEdit(c: Cohort) {
    setEditId(c.id);
    setEditForm({ slug: c.id, title: c.title });
    setError("");
  }

  async function handleSaveEdit(oldId: string) {
    try {
      await api.adminUpdateCohort(
        token,
        oldId,
        editForm.slug !== oldId ? editForm.slug : undefined,
        editForm.title,
      );
      setEditId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleDelete(id: string, t: string) {
    if (
      !confirm(
        `Delete cohort "${t}" and ALL its subjects + their files? This cannot be undone.`,
      )
    )
      return;
    try {
      await api.adminDeleteCohort(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-wp-text-primary">Cohorts</h2>
        <button
          onClick={() => setCreating((c) => !c)}
          className="flex items-center gap-2 px-4 py-2.5 bg-wp-accent hover:bg-wp-accent-hover text-wp-on-accent text-sm font-semibold rounded-wp-md transition-all shadow-md shadow-wp-accent/20"
        >
          {creating ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {creating ? "Cancel" : "+ New cohort"}
        </button>
      </div>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="bg-wp-surface border border-wp-border-soft rounded-wp-xl p-5 space-y-3 max-w-md"
        >
          <div className="font-semibold text-wp-text-primary text-sm">
            Create cohort
          </div>
          <div>
            <label className="block text-xs text-wp-text-secondary mb-1">
              Slug (ID — e.g. year-5a, primary-2b)
            </label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              placeholder="e.g. year-5a"
              pattern="[a-zA-Z0-9_-]+"
              title="Alphanumeric, dash, underscore only"
              className={`${inputCls} w-full font-mono`}
            />
          </div>
          <div>
            <label className="block text-xs text-wp-text-secondary mb-1">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Year 5A — 2025"
              className={`${inputCls} w-full`}
            />
          </div>
          {error && (
            <p className="text-wp-error text-sm font-medium">⚠ {error}</p>
          )}
          <button
            type="submit"
            className="w-full py-2.5 bg-wp-text-primary hover:bg-wp-text-secondary text-wp-on-accent text-sm font-semibold rounded-wp-md"
          >
            Create
          </button>
        </form>
      )}

      {error && !creating && (
        <p className="text-wp-error text-sm font-medium">⚠ {error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-wp-accent border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-wp-surface border border-wp-border-soft rounded-wp-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-wp-inset text-wp-text-secondary text-xs uppercase">
              <tr>
                {["Slug (ID)", "Title", "Created", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-wp-border-ghost">
              {cohorts.map((c) =>
                editId === c.id ? (
                  <tr key={c.id} className="bg-wp-accent-subtle">
                    <td className="px-2 py-2.5">
                      <input
                        value={editForm.slug}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, slug: e.target.value }))
                        }
                        pattern="[a-zA-Z0-9_-]+"
                        className={`${inputCls} w-36 font-mono`}
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <input
                        value={editForm.title}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, title: e.target.value }))
                        }
                        className={`${inputCls} w-48`}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-wp-text-tertiary text-xs">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-2 py-2.5 flex gap-1.5">
                      <button
                        onClick={() => handleSaveEdit(c.id)}
                        className={`${btnSm} bg-wp-success text-white hover:bg-wp-success/90`}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className={`${btnSm} bg-wp-border-soft text-wp-text-secondary hover:bg-wp-border-mid`}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} className="hover:bg-wp-inset">
                    <td className="px-4 py-3.5 font-mono text-xs text-wp-text-secondary">
                      {c.id}
                    </td>
                    <td className="px-4 py-3.5 text-wp-text-primary">
                      {c.title}
                    </td>
                    <td className="px-4 py-3.5 text-wp-text-tertiary text-xs">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3.5 flex gap-1.5">
                      <button
                        onClick={() => startEdit(c)}
                        className={`${btnSm} bg-wp-border-soft text-wp-text-secondary hover:bg-wp-border-mid`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(c.id, c.title)}
                        className={`${btnSm} bg-red-50 text-red-600 hover:bg-red-100`}
                      >
                        Del
                      </button>
                    </td>
                  </tr>
                ),
              )}
              {cohorts.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-wp-text-tertiary text-sm"
                  >
                    No cohorts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Subjects tab ──────────────────────────────────────────────────────────────

function SubjectsTab({ token }: { token: string }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [cohortId, setCohortId] = useState("");
  const [filterCohort, setFilterCohort] = useState("");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ slug: "", title: "" });

  async function load(forCohort?: string) {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        api.adminListSubjects(token, forCohort || undefined),
        api.adminListCohorts(token),
      ]);
      setSubjects(s);
      setCohorts(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await api.adminCreateSubject(token, cohortId, slug.trim(), title.trim());
      setCohortId("");
      setSlug("");
      setTitle("");
      setCreating(false);
      load(filterCohort || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  }

  function startEdit(s: Subject) {
    setEditId(s.id);
    setEditForm({ slug: s.slug, title: s.title });
    setError("");
  }

  async function handleSaveEdit(subj: Subject) {
    try {
      await api.adminUpdateSubject(
        token,
        subj.id,
        editForm.slug !== subj.slug ? editForm.slug : undefined,
        editForm.title,
      );
      setEditId(null);
      load(filterCohort || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleDelete(s: Subject) {
    if (
      !confirm(
        `Delete subject "${s.title}" and all its files? This cannot be undone.`,
      )
    )
      return;
    try {
      await api.adminDeleteSubject(token, s.id);
      load(filterCohort || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function cohortTitle(id: string) {
    return cohorts.find((c) => c.id === id)?.title ?? id;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-wp-text-primary">Subjects</h2>
        <div className="flex items-center gap-2">
          <select
            value={filterCohort}
            onChange={(e) => {
              setFilterCohort(e.target.value);
              load(e.target.value || undefined);
            }}
            className={`${inputCls} min-w-[150px]`}
          >
            <option value="">All cohorts</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button
            onClick={() => setCreating((c) => !c)}
            className="flex items-center gap-2 px-4 py-2.5 bg-wp-accent hover:bg-wp-accent-hover text-wp-on-accent text-sm font-semibold rounded-wp-md transition-all shadow-md shadow-wp-accent/20"
          >
            {creating ? (
              <X className="w-4 h-4" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {creating ? "Cancel" : "+ New subject"}
          </button>
        </div>
      </div>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="bg-wp-surface border border-wp-border-soft rounded-wp-xl p-5 space-y-3 max-w-md"
        >
          <div className="font-semibold text-wp-text-primary text-sm">
            Create subject
          </div>
          <div>
            <label className="block text-xs text-wp-text-secondary mb-1">
              Cohort
            </label>
            <select
              value={cohortId}
              onChange={(e) => setCohortId(e.target.value)}
              required
              className={`${inputCls} w-full`}
            >
              <option value="">— Select cohort —</option>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-wp-text-secondary mb-1">
              Slug{" "}
              <span className="text-wp-text-tertiary">
                (alphanumeric/dash, e.g. mathematics)
              </span>
            </label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              placeholder="e.g. mathematics"
              className={`${inputCls} w-full`}
            />
          </div>
          <div>
            <label className="block text-xs text-wp-text-secondary mb-1">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Introduction to Mathematics"
              className={`${inputCls} w-full`}
            />
          </div>
          {error && (
            <p className="text-wp-error text-sm font-medium">⚠ {error}</p>
          )}
          <button
            type="submit"
            className="w-full py-2.5 bg-wp-text-primary hover:bg-wp-text-secondary text-wp-on-accent text-sm font-semibold rounded-wp-md"
          >
            Create
          </button>
        </form>
      )}

      {error && !creating && (
        <p className="text-wp-error text-sm font-medium">⚠ {error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-wp-accent border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-wp-surface border border-wp-border-soft rounded-wp-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-wp-inset text-wp-text-secondary text-xs uppercase">
              <tr>
                {["Cohort", "Slug", "Title", "Created", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-wp-border-ghost">
              {subjects.map((s) =>
                editId === s.id ? (
                  <tr key={s.id} className="bg-wp-accent-subtle">
                    <td className="px-4 py-2.5 text-wp-text-tertiary text-xs">
                      {cohortTitle(s.cohort_id)}
                    </td>
                    <td className="px-2 py-2.5">
                      <input
                        value={editForm.slug}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, slug: e.target.value }))
                        }
                        pattern="[a-zA-Z0-9_-]+"
                        className={`${inputCls} w-32 font-mono`}
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <input
                        value={editForm.title}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, title: e.target.value }))
                        }
                        className={`${inputCls} w-48`}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-wp-text-tertiary text-xs">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-2 py-2.5 flex gap-1.5">
                      <button
                        onClick={() => handleSaveEdit(s)}
                        className={`${btnSm} bg-wp-success text-white hover:bg-wp-success/90`}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className={`${btnSm} bg-wp-border-soft text-wp-text-secondary hover:bg-wp-border-mid`}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} className="hover:bg-wp-inset">
                    <td className="px-4 py-3.5 text-wp-text-tertiary text-xs">
                      {cohortTitle(s.cohort_id)}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-wp-text-secondary">
                      {s.slug}
                    </td>
                    <td className="px-4 py-3.5 text-wp-text-primary">
                      {s.title}
                    </td>
                    <td className="px-4 py-3.5 text-wp-text-tertiary text-xs">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3.5 flex gap-1.5">
                      <button
                        onClick={() => startEdit(s)}
                        className={`${btnSm} bg-wp-border-soft text-wp-text-secondary hover:bg-wp-border-mid`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        className={`${btnSm} bg-red-50 text-red-600 hover:bg-red-100`}
                      >
                        Del
                      </button>
                    </td>
                  </tr>
                ),
              )}
              {subjects.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-wp-text-tertiary text-sm"
                  >
                    No subjects yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-wp-inset rounded-wp-lg p-4 text-xs text-wp-text-secondary max-w-md">
        <p className="font-semibold mb-1.5">After creating a subject:</p>
        <p>Copy course materials (.md files + image folders) into:</p>
        <code className="block mt-2 bg-white rounded-wp-md px-3 py-2 font-mono text-wp-text-primary">
          /srv/educlaw/data/subjects/&lt;cohort_id&gt;/&lt;slug&gt;/
        </code>
      </div>
    </div>
  );
}

// ── Assignments tab ───────────────────────────────────────────────────────────

function AssignmentsTab({ token }: { token: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [filterSubj, setFilterSubj] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateAssignmentBody>({
    subject_id: "",
    title: "",
    description: "",
    due_date: "",
  });
  const [error, setError] = useState("");

  async function load(subjectId?: string) {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([
        api.adminListAssignments(token, subjectId),
        api.adminListSubjects(token),
      ]);
      setAssignments(a);
      setSubjects(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleFilterChange(subjectId: string) {
    setFilterSubj(subjectId);
    load(subjectId || undefined);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await api.adminCreateAssignment(token, {
        subject_id: form.subject_id,
        title: form.title,
        description: form.description || undefined,
        due_date: form.due_date || undefined,
      });
      setForm({ subject_id: "", title: "", description: "", due_date: "" });
      setCreating(false);
      load(filterSubj || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  }

  function subjectTitle(id: string) {
    return subjects.find((s) => s.id === id)?.title ?? id;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-wp-text-primary">Assignments</h2>
        <button
          onClick={() => setCreating((c) => !c)}
          className="flex items-center gap-2 px-4 py-2.5 bg-wp-accent hover:bg-wp-accent-hover text-wp-on-accent text-sm font-semibold rounded-wp-md transition-all shadow-md shadow-wp-accent/20"
        >
          {creating ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {creating ? "Cancel" : "+ New assignment"}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-wp-text-secondary font-medium">
          Filter by subject:
        </label>
        <select
          value={filterSubj}
          onChange={(e) => handleFilterChange(e.target.value)}
          className={`${inputCls} min-w-[180px]`}
        >
          <option value="">All subjects</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </div>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="bg-wp-surface border border-wp-border-soft rounded-wp-xl p-5 space-y-3 max-w-lg"
        >
          <div className="font-semibold text-wp-text-primary text-sm">
            Create assignment
          </div>
          <div>
            <label className="block text-xs text-wp-text-secondary mb-1">
              Subject
            </label>
            <select
              required
              value={form.subject_id}
              onChange={(e) =>
                setForm((f) => ({ ...f, subject_id: e.target.value }))
              }
              className={`${inputCls} w-full`}
            >
              <option value="">— Select subject —</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-wp-text-secondary mb-1">
              Title
            </label>
            <input
              required
              value={form.title}
              onChange={(e) =>
                setForm((f) => ({ ...f, title: e.target.value }))
              }
              placeholder="e.g. Chapter 3 Quiz"
              className={`${inputCls} w-full`}
            />
          </div>
          <div>
            <label className="block text-xs text-wp-text-secondary mb-1">
              Description (optional)
            </label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="Instructions for the student…"
              className={`${inputCls} w-full resize-none`}
            />
          </div>
          <div>
            <label className="block text-xs text-wp-text-secondary mb-1">
              Due date (optional)
            </label>
            <input
              type="date"
              value={form.due_date}
              onChange={(e) =>
                setForm((f) => ({ ...f, due_date: e.target.value }))
              }
              className={`${inputCls} w-full`}
            />
          </div>
          {error && (
            <p className="text-wp-error text-sm font-medium">⚠ {error}</p>
          )}
          <button
            type="submit"
            className="w-full py-2.5 bg-wp-text-primary hover:bg-wp-text-secondary text-wp-on-accent text-sm font-semibold rounded-wp-md"
          >
            Create assignment
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-wp-accent border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-wp-surface border border-wp-border-soft rounded-wp-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-wp-inset text-wp-text-secondary text-xs uppercase">
              <tr>
                {["Title", "Subject", "Due date", "Created"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-wp-border-ghost">
              {assignments.map((a) => (
                <tr key={a.id} className="hover:bg-wp-inset">
                  <td className="px-4 py-3.5 text-wp-text-primary font-medium">
                    {a.title}
                  </td>
                  <td className="px-4 py-3.5 text-wp-text-tertiary text-xs">
                    {subjectTitle(a.subject_id)}
                  </td>
                  <td className="px-4 py-3.5 text-wp-text-tertiary text-xs">
                    {a.due_date
                      ? new Date(a.due_date).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3.5 text-wp-text-tertiary text-xs">
                    {new Date(a.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-wp-text-tertiary text-sm"
                  >
                    No assignments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Sessions tab ──────────────────────────────────────────────────────────────

function SessionsTab({ token }: { token: string }) {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setSessions(await api.adminListSessions(token));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function terminate(id: string) {
    if (!confirm("Terminate this session?")) return;
    await api.adminTerminateSession(token, id);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-wp-text-primary">
          Live Sessions
        </h2>
        <button
          onClick={load}
          className="text-sm text-wp-text-tertiary hover:text-wp-accent transition-colors font-medium flex items-center gap-1.5"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-wp-accent border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-wp-surface border border-wp-border-soft rounded-wp-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-wp-inset text-wp-text-secondary text-xs uppercase">
              <tr>
                {["Student ID", "State", "Idle", "Started", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-wp-border-ghost">
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-wp-inset">
                  <td className="px-4 py-3.5 font-mono text-xs text-wp-text-secondary">
                    {s.student_id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3.5 text-wp-text-primary">
                    {s.state}
                  </td>
                  <td className="px-4 py-3.5 text-wp-text-tertiary">
                    {s.idle_secs != null
                      ? `${Math.floor(s.idle_secs / 60)}m ${s.idle_secs % 60}s`
                      : "—"}
                  </td>
                  <td className="px-4 py-3.5 text-wp-text-tertiary text-xs">
                    {new Date(s.started_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      onClick={() => terminate(s.id)}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Terminate
                    </button>
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-wp-text-tertiary text-sm"
                  >
                    No active sessions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
