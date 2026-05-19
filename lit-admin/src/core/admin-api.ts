import type {
  AdminSession,
  AdminStudent,
  Cohort,
  CreateStudentBody,
  LoginResponse,
  Model,
  ProviderSchema,
  StudentTokenUsage,
  Subject,
  TokenCode,
  TokenDeduction,
  UpdateStudentBody,
} from "./admin-types";

const BASE = "";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  const ct = res.headers.get("content-type");
  if (ct && ct.includes("application/json")) {
    return res.json();
  }
  const text = await res.text();
  throw new Error(`Expected JSON but got ${ct}: ${text}`);
}

async function requestNoContent(
  url: string,
  options?: RequestInit,
): Promise<void> {
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export const adminApi = {
  // ── Auth ──────────────────────────────────────────────

  async login(username: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  async bootstrapToken(secret: string): Promise<{ token: string }> {
    return request<{ token: string }>("/auth/token", {
      method: "POST",
      body: JSON.stringify({ secret }),
    });
  },

  // ── Students ──────────────────────────────────────────

  async listStudents(token: string): Promise<AdminStudent[]> {
    return request<AdminStudent[]>("/admin/students", {
      headers: authHeader(token),
    });
  },

  async createStudent(
    token: string,
    body: CreateStudentBody,
  ): Promise<{ id: string }> {
    return request<{ id: string }>("/admin/students", {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify(body),
    });
  },

  async updateStudent(
    token: string,
    id: string,
    body: UpdateStudentBody,
  ): Promise<void> {
    return requestNoContent(`/admin/students/${id}`, {
      method: "PUT",
      headers: authHeader(token),
      body: JSON.stringify(body),
    });
  },

  async deleteStudent(token: string, id: string): Promise<void> {
    return requestNoContent(`/admin/students/${id}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
  },

  async getTokenBalance(
    token: string,
    studentId: string,
  ): Promise<{ balance: number }> {
    const res = await request<{ token_balance: number }>(
      `/admin/students/${studentId}/token-balance`,
      { headers: authHeader(token) },
    );
    return { balance: res.token_balance };
  },

  async topupTokens(
    token: string,
    studentId: string,
    amount: number,
  ): Promise<{ new_balance: number }> {
    return request<{ new_balance: number }>(
      `/admin/students/${studentId}/topup`,
      {
        method: "POST",
        headers: authHeader(token),
        body: JSON.stringify({ amount }),
      },
    );
  },

  async deductTokens(
    token: string,
    studentId: string,
    amount: number,
  ): Promise<{ new_balance: number }> {
    return request<{ new_balance: number }>(
      `/admin/students/${studentId}/deduct`,
      {
        method: "POST",
        headers: authHeader(token),
        body: JSON.stringify({ amount }),
      },
    );
  },

  async getTokenDeductions(
    token: string,
    studentId: string,
  ): Promise<TokenDeduction[]> {
    const res = await request<{ deductions: TokenDeduction[] }>(
      `/admin/students/${studentId}/token-deductions`,
      { headers: authHeader(token) },
    );
    return res.deductions;
  },

  async banStudent(
    token: string,
    studentId: string,
    message?: string,
  ): Promise<void> {
    return requestNoContent(`/admin/students/${studentId}/ban`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ message: message || null }),
    });
  },

  async unbanStudent(
    token: string,
    studentId: string,
  ): Promise<void> {
    return requestNoContent(`/admin/students/${studentId}/unban`, {
      method: "POST",
      headers: authHeader(token),
    });
  },

  async getStudentModels(
    token: string,
    studentId: string,
  ): Promise<{ models: string[] }> {
    return request<{ models: string[] }>(
      `/admin/students/${studentId}/models`,
      { headers: authHeader(token) },
    );
  },

  async setStudentModels(
    token: string,
    studentId: string,
    models: string[],
  ): Promise<void> {
    return requestNoContent(`/admin/students/${studentId}/models`, {
      method: "PUT",
      headers: authHeader(token),
      body: JSON.stringify({ models }),
    });
  },

  async getStudentTokenUsage(
    token: string,
    studentId: string,
  ): Promise<StudentTokenUsage> {
    return request<StudentTokenUsage>(
      `/admin/students/${studentId}/token-usage`,
      { headers: authHeader(token) },
    );
  },

  // ── Cohorts ───────────────────────────────────────────

  async listCohorts(token: string): Promise<Cohort[]> {
    return request<Cohort[]>("/admin/cohorts", {
      headers: authHeader(token),
    });
  },

  async createCohort(
    token: string,
    slug: string,
    title: string,
  ): Promise<{ id: string }> {
    return request<{ id: string }>("/admin/cohorts", {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ slug, title }),
    });
  },

  async updateCohort(
    token: string,
    id: string,
    new_slug: string,
    title: string,
  ): Promise<{ id: string }> {
    return request<{ id: string }>(`/admin/cohorts/${id}`, {
      method: "PUT",
      headers: authHeader(token),
      body: JSON.stringify({ new_slug, title }),
    });
  },

  async deleteCohort(token: string, id: string): Promise<void> {
    return requestNoContent(`/admin/cohorts/${id}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
  },

  // ── Subjects ──────────────────────────────────────────

  async listSubjects(
    token: string,
    cohortId?: string,
  ): Promise<Subject[]> {
    const qs = cohortId ? `?cohort_id=${encodeURIComponent(cohortId)}` : "";
    return request<Subject[]>(`/admin/subjects${qs}`, {
      headers: authHeader(token),
    });
  },

  async createSubject(
    token: string,
    cohort_id: string,
    slug: string,
    title: string,
  ): Promise<{ id: string; slug: string }> {
    return request<{ id: string; slug: string }>("/admin/subjects", {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ cohort_id, slug, title }),
    });
  },

  async updateSubject(
    token: string,
    id: string,
    new_slug: string,
    title: string,
  ): Promise<{ id: string; slug: string }> {
    return request<{ id: string; slug: string }>(`/admin/subjects/${id}`, {
      method: "PUT",
      headers: authHeader(token),
      body: JSON.stringify({ new_slug, title }),
    });
  },

  async deleteSubject(token: string, id: string): Promise<void> {
    return requestNoContent(`/admin/subjects/${id}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
  },

  // ── Sessions ──────────────────────────────────────────

  async listSessions(token: string): Promise<AdminSession[]> {
    return request<AdminSession[]>("/admin/sessions", {
      headers: authHeader(token),
    });
  },

  async terminateSession(token: string, sessionId: string): Promise<void> {
    return requestNoContent(`/admin/sessions/${sessionId}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
  },

  // ── Models ────────────────────────────────────────────

  async listModels(token: string): Promise<Model[]> {
    return request<Model[]>("/admin/models", {
      headers: authHeader(token),
    });
  },

  async createModel(
    token: string,
    name: string,
    display_name: string,
    input_multiplier: number,
    output_multiplier: number,
  ): Promise<Model> {
    return request<Model>("/admin/models", {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ name, display_name, input_multiplier, output_multiplier }),
    });
  },

  async setModelEnabled(
    token: string,
    id: string,
    enabled: boolean,
  ): Promise<void> {
    return requestNoContent(`/admin/models/${id}`, {
      method: "PUT",
      headers: authHeader(token),
      body: JSON.stringify({ enabled }),
    });
  },

  async setModelMultipliers(
    token: string,
    name: string,
    input_multiplier: number,
    output_multiplier: number,
  ): Promise<void> {
    return requestNoContent(`/admin/models/${name}/multipliers`, {
      method: "PUT",
      headers: authHeader(token),
      body: JSON.stringify({ input_multiplier, output_multiplier }),
    });
  },

  async updateModelSpecs(
    token: string,
    id: string,
    provider: string,
    think_mode: number,
    visual_support: number,
  ): Promise<void> {
    return requestNoContent(`/admin/models/${id}/specs`, {
      method: "PUT",
      headers: authHeader(token),
      body: JSON.stringify({ provider, think_mode, visual_support }),
    });
  },

  async updateModelThinking(
    token: string,
    id: string,
    thinking_params: Record<string, unknown>,
  ): Promise<void> {
    return requestNoContent(`/admin/models/${id}/thinking`, {
      method: "PUT",
      headers: authHeader(token),
      body: JSON.stringify({ thinking_params }),
    });
  },

  async deleteModel(token: string, id: string): Promise<void> {
    return requestNoContent(`/admin/models/${id}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
  },

  async getProviderSchema(provider: string): Promise<ProviderSchema> {
    return request<ProviderSchema>(
      `/admin/provider-schema/${encodeURIComponent(provider)}`,
    );
  },

  // ── Token Codes ──────────────────────────────────────

  async generateTokenCodes(
    token: string,
    tokens: number,
    count: number,
  ): Promise<{ codes: string[] }> {
    return request<{ codes: string[] }>("/admin/token-codes", {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ tokens, count }),
    });
  },

  async listTokenCodes(
    token: string,
    tokens?: number,
    used?: boolean,
  ): Promise<TokenCode[]> {
    const params = new URLSearchParams();
    if (tokens != null) params.set("tokens", String(tokens));
    if (used != null) params.set("used", used ? "true" : "false");
    const qs = params.toString();
    return request<TokenCode[]>(`/admin/token-codes${qs ? "?" + qs : ""}`, {
      headers: authHeader(token),
    });
  },

  async deleteTokenCode(token: string, id: string): Promise<void> {
    return requestNoContent(`/admin/token-codes/${id}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
  },

  async exportTokenCodes(token: string, tokens: number): Promise<string> {
    const res = await fetch(`${BASE}/admin/token-codes/export?tokens=${tokens}`, {
      headers: authHeader(token),
    });
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
    return res.text();
  },
};
