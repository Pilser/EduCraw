import type {
  LoginResponse,
  Session,
  FileNode,
  AssignmentProgress,
  Cohort,
  Subject,
  Assignment,
  Model,
  SessionModels,
  TokenUsage,
} from "./types";

const BASE = ""; // same origin

const json = (res: Response) => {
  if (!res.ok)
    return res
      .text()
      .then((t) => Promise.reject(new Error(t || `HTTP ${res.status}`)));
  return res.json();
};

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────

  async login(username: string, password: string): Promise<LoginResponse> {
    return fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(json);
  },

  /** Bootstrap token — uses ADMIN_SECRET, not username/password */
  async bootstrapToken(secret: string): Promise<{ token: string }> {
    return fetch(`${BASE}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    }).then(json);
  },

  // ── Sessions ─────────────────────────────────────────────────────────────

  async createSession(studentId: string, token: string): Promise<Session> {
    return fetch(`${BASE}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ student_id: studentId }),
    }).then(json);
  },

  async endSession(sessionId: string, token: string): Promise<void> {
    await fetch(`${BASE}/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  // ── Files ────────────────────────────────────────────────────────────────

  async listSubjectFiles(
    subjectId: string,
    token: string,
  ): Promise<FileNode[]> {
    return fetch(`${BASE}/files/subject/${subjectId}/tree`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  async listStudentFiles(
    sessionId: string,
    token: string,
  ): Promise<FileNode[]> {
    return fetch(`${BASE}/files/student/${sessionId}/tree`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  async readSubjectFile(
    subjectId: string,
    filePath: string,
    token: string,
  ): Promise<Blob> {
    const res = await fetch(
      `${BASE}/files/subject/${subjectId}/read?path=${encodeURIComponent(filePath)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);
    return res.blob();
  },

  async readStudentFile(
    sessionId: string,
    filePath: string,
    token: string,
  ): Promise<Blob> {
    const res = await fetch(
      `${BASE}/files/student/${sessionId}/read?path=${encodeURIComponent(filePath)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);
    return res.blob();
  },

  async uploadStudentFile(
    sessionId: string,
    filePath: string,
    content: string | ArrayBuffer,
    token: string,
  ): Promise<void> {
    const isText = typeof content === "string";
    const body = isText ? content : content;
    const res = await fetch(
      `${BASE}/files/student/${sessionId}/write?path=${encodeURIComponent(filePath)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": isText ? "text/plain" : "application/octet-stream",
          Authorization: `Bearer ${token}`,
        },
        body: body,
      },
    );
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to upload file: ${error || res.statusText}`);
    }
  },

  async getProgress(
    sessionId: string,
    token: string,
  ): Promise<AssignmentProgress | null> {
    const res = await fetch(`${BASE}/sessions/${sessionId}/progress`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    return json(res);
  },

  // ── Admin — Students ─────────────────────────────────────────────────────

  async adminListStudents(token: string): Promise<AdminStudent[]> {
    return fetch(`${BASE}/admin/students`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  async adminCreateStudent(
    token: string,
    body: CreateStudentBody,
  ): Promise<{ id: string }> {
    return fetch(`${BASE}/admin/students`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }).then(json);
  },

  async adminUpdateStudent(
    token: string,
    id: string,
    body: UpdateStudentBody,
  ): Promise<void> {
    await fetch(`${BASE}/admin/students/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }).then(json);
  },

  async adminDeleteStudent(token: string, id: string): Promise<void> {
    await fetch(`${BASE}/admin/students/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  // ── Admin — Sessions ─────────────────────────────────────────────────────

  async adminListSessions(token: string): Promise<AdminSession[]> {
    return fetch(`${BASE}/admin/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  async adminTerminateSession(token: string, sessionId: string): Promise<void> {
    await fetch(`${BASE}/admin/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  // ── Admin — Cohorts ──────────────────────────────────────────────────────

  async adminListCohorts(token: string): Promise<Cohort[]> {
    return fetch(`${BASE}/admin/cohorts`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  async adminCreateCohort(
    token: string,
    slug: string,
    title: string,
  ): Promise<{ id: string }> {
    return fetch(`${BASE}/admin/cohorts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ slug, title }),
    }).then(json);
  },

  async adminUpdateCohort(
    token: string,
    id: string,
    newSlug: string | undefined,
    title: string,
  ): Promise<{ id: string }> {
    return fetch(`${BASE}/admin/cohorts/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        new_slug: newSlug !== id ? newSlug : undefined,
        title,
      }),
    }).then(json);
  },

  async adminDeleteCohort(token: string, id: string): Promise<void> {
    await fetch(`${BASE}/admin/cohorts/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  // ── Admin — Subjects ─────────────────────────────────────────────────────

  async adminListSubjects(
    token: string,
    cohortId?: string,
  ): Promise<Subject[]> {
    const url = cohortId
      ? `${BASE}/admin/subjects?cohort_id=${encodeURIComponent(cohortId)}`
      : `${BASE}/admin/subjects`;
    return fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  async adminCreateSubject(
    token: string,
    cohortId: string,
    slug: string,
    title: string,
  ): Promise<{ id: string; slug: string }> {
    return fetch(`${BASE}/admin/subjects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ cohort_id: cohortId, slug, title }),
    }).then(json);
  },

  async adminUpdateSubject(
    token: string,
    id: string,
    newSlug: string | undefined,
    title: string,
  ): Promise<{ id: string; slug: string }> {
    return fetch(`${BASE}/admin/subjects/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ new_slug: newSlug, title }),
    }).then(json);
  },

  async adminDeleteSubject(token: string, id: string): Promise<void> {
    await fetch(`${BASE}/admin/subjects/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  // ── Admin — Assignments ──────────────────────────────────────────────────

  async adminListAssignments(
    token: string,
    subjectId?: string,
  ): Promise<Assignment[]> {
    const url = subjectId
      ? `${BASE}/admin/assignments?subject_id=${encodeURIComponent(subjectId)}`
      : `${BASE}/admin/assignments`;
    return fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  async adminCreateAssignment(
    token: string,
    body: CreateAssignmentBody,
  ): Promise<{ id: string }> {
    return fetch(`${BASE}/admin/assignments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }).then(json);
  },

  // ── Sessions — model + token usage ────────────────────────────────────────

  /** Fetch allowed models for this session + which is currently active. */
  async getSessionModels(
    sessionId: string,
    token: string,
  ): Promise<SessionModels> {
    return fetch(`${BASE}/sessions/${sessionId}/models`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  /** Switch the active model mid-session. */
  async setSessionModel(
    sessionId: string,
    token: string,
    model: string,
  ): Promise<void> {
    await fetch(`${BASE}/sessions/${sessionId}/model`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ model }),
    }).then(json);
  },

  /** Cumulative token usage for the session. */
  async getSessionTokenUsage(
    sessionId: string,
    token: string,
  ): Promise<TokenUsage> {
    return fetch(`${BASE}/sessions/${sessionId}/token-usage`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  async getMyTokenBalance(token: string): Promise<{ balance: number }> {
    return fetch(`${BASE}/me/token-balance`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  // ── Admin — Models ────────────────────────────────────────────────────────

  async adminListModels(token: string): Promise<Model[]> {
    return fetch(`${BASE}/admin/models`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  async adminCreateModel(
    token: string,
    name: string,
    display_name: string,
    multiplier = 1.0,
  ): Promise<{
    id: string;
    name: string;
    display_name: string;
    multiplier: number;
    enabled: number;
  }> {
    return fetch(`${BASE}/admin/models`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, display_name, multiplier }),
    }).then(json);
  },

  async adminSetModelEnabled(
    token: string,
    id: string,
    enabled: boolean,
  ): Promise<void> {
    await fetch(`${BASE}/admin/models/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled }),
    });
  },

  async adminSetModelMultiplier(
    token: string,
    name: string,
    multiplier: number,
  ): Promise<void> {
    await fetch(`${BASE}/admin/models/${encodeURIComponent(name)}/multiplier`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ multiplier }),
    }).then(json);
  },

  async adminUpdateModelSpecs(
    token: string,
    id: string,
    provider: string | null,
    think_mode: number | null,
    visual_support: number,
  ): Promise<void> {
    await fetch(`${BASE}/admin/models/${id}/specs`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ provider, think_mode, visual_support }),
    });
  },

  async adminDeleteModel(token: string, id: string): Promise<void> {
    await fetch(`${BASE}/admin/models/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  // Token limit
  async adminSetTokenLimit(
    token: string,
    studentId: string,
    limit: number | null,
    banner: string,
  ): Promise<void> {
    await fetch(`${BASE}/admin/students/${studentId}/token-limit`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ token_limit: limit, banner }),
    });
  },

  async adminClearTokenBlock(token: string, studentId: string): Promise<void> {
    await fetch(`${BASE}/admin/students/${studentId}/token-limit`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  async adminGetStudentTokenUsage(
    token: string,
    studentId: string,
  ): Promise<{
    total_tokens_used: number;
    token_limit: number | null;
    token_blocked_at: string | null;
    token_block_banner: string | null;
  }> {
    return fetch(`${BASE}/admin/students/${studentId}/token-usage`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  // Per-student model assignment
  async adminGetStudentModels(
    token: string,
    studentId: string,
  ): Promise<{ models: string[] }> {
    return fetch(`${BASE}/admin/students/${studentId}/models`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  async adminSetStudentModels(
    token: string,
    studentId: string,
    models: string[],
  ): Promise<void> {
    await fetch(`${BASE}/admin/students/${studentId}/models`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ models }),
    });
  },

  // Token balance management
  async adminGetTokenBalance(
    token: string,
    studentId: string,
  ): Promise<{ balance: number }> {
    return fetch(`${BASE}/admin/students/${studentId}/token-balance`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },

  async adminTopupTokens(
    token: string,
    studentId: string,
    amount: number,
  ): Promise<{ new_balance: number }> {
    return fetch(`${BASE}/admin/students/${studentId}/topup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ amount }),
    }).then(json);
  },

  async adminDeductTokens(
    token: string,
    studentId: string,
    amount: number,
  ): Promise<{ new_balance: number }> {
    return fetch(`${BASE}/admin/students/${studentId}/deduct`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ amount }),
    }).then(json);
  },

  async adminGetTokenDeductions(
    token: string,
    studentId: string,
  ): Promise<
    Array<{
      id: string;
      session_id: string;
      model_name: string;
      multiplier: number;
      tokens_used: number;
      tokens_deducted: number;
      balance_before: number;
      balance_after: number;
      created_at: string;
    }>
  > {
    return fetch(`${BASE}/admin/students/${studentId}/token-deductions`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(json);
  },
};

// ── Admin types (only used by AdminPage) ─────────────────────────────────

export interface AdminStudent {
  id: string;
  username: string;
  display_name: string;
  role: string;
  cohort_id: string;
  last_seen: string | null;
  has_active_session: boolean;
  token_limit: number | null;
  token_balance: number;
  token_blocked_at: string | null;
  token_block_banner: string | null;
}

export interface AdminSession {
  id: string;
  student_id: string;
  state: string;
  idle_secs: number | null;
  started_at: string;
}

export interface CreateStudentBody {
  username: string;
  password: string;
  display_name: string;
  role: "student" | "teacher" | "admin";
  cohort_id: string;
}

export interface UpdateStudentBody {
  display_name?: string;
  cohort_id?: string;
  new_password?: string;
}

export interface CreateAssignmentBody {
  subject_id: string;
  title: string;
  description?: string;
  due_date?: string;
}
