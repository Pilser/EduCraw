import type {
  LoginResponse,
  Session,
  SessionListItem,
  ForkThreadResult,
  ImportThreadResult,
  SessionModels,
  TokenUsage,
} from "./edu-types";

const BASE = ""; // Same origin, Vite proxy handles /auth and /sessions

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    console.error(`[edu-api] Request failed: ${res.status} ${url}`, text);
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return res.json();
  } else {
    const text = await res.text();
    console.error(`[edu-api] Expected JSON but got: ${contentType}`, text);
    throw new Error(`Expected JSON response but got ${contentType}`);
  }
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export const eduApi = {
  /** Student/staff login */
  async login(username: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  /** Bootstrap admin token (dev only) */
  async bootstrapToken(secret: string): Promise<{ token: string }> {
    return request<{ token: string }>("/auth/token", {
      method: "POST",
      body: JSON.stringify({ secret }),
    });
  },

  /** Create a new chat session */
  async createSession(
    studentId: string,
    token: string,
    model?: string,
  ): Promise<Session> {
    return request<Session>("/sessions", {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ student_id: studentId, model }),
    });
  },

  /** End/terminate a session */
  async endSession(sessionId: string, token: string): Promise<void> {
    await fetch(`${BASE}/sessions/${sessionId}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
  },

  /** Get available models for a session */
  async getSessionModels(
    sessionId: string,
    token: string,
  ): Promise<SessionModels> {
    return request<SessionModels>(`/sessions/${sessionId}/models`, {
      headers: authHeader(token),
    });
  },

  /** Switch the active model for a session */
  async setSessionModel(
    sessionId: string,
    token: string,
    model: string,
    thinkingParams?: Record<string, unknown>,
  ): Promise<void> {
    await fetch(`${BASE}/sessions/${sessionId}/model`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(token) },
      body: JSON.stringify({ model, thinking_params: thinkingParams }),
    });
  },

  /** Get token usage for a session */
  async getSessionTokenUsage(
    sessionId: string,
    token: string,
  ): Promise<TokenUsage> {
    return request<TokenUsage>(`/sessions/${sessionId}/token-usage`, {
      headers: authHeader(token),
    });
  },

  /** List threads for a session */
  async listThreads(
    sessionId: string,
    token: string,
  ): Promise<SessionListItem[]> {
    return request<SessionListItem[]>(`/sessions/${sessionId}/threads`, {
      headers: authHeader(token),
    });
  },

  /** Fork a thread, creating a new session with copied history */
  async forkThread(
    sessionId: string,
    threadId: string,
    token: string,
  ): Promise<ForkThreadResult> {
    return request<ForkThreadResult>(
      `/sessions/${sessionId}/threads/${threadId}/fork`,
      {
        method: "POST",
        headers: authHeader(token),
      },
    );
  },

  /** Export a thread as JSON string */
  async exportThread(
    sessionId: string,
    threadId: string,
    token: string,
  ): Promise<{ data: string }> {
    return request<{ data: string }>(
      `/sessions/${sessionId}/threads/${threadId}/export`,
      {
        headers: authHeader(token),
      },
    );
  },

  /** Import a thread from JSON string */
  async importThread(
    sessionId: string,
    data: string,
    token: string,
  ): Promise<ImportThreadResult> {
    return request<ImportThreadResult>(
      `/sessions/${sessionId}/threads/import`,
      {
        method: "POST",
        headers: authHeader(token),
        body: JSON.stringify({ data }),
      },
    );
  },

  /** List subject files (read-only course materials) */
  async listSubjectFiles(subjectId: string, token: string): Promise<any[]> {
    return request<any[]>(`/files/subject/${subjectId}/tree`, {
      headers: authHeader(token),
    });
  },

  /** Read subject file */
  async readSubjectFile(
    subjectId: string,
    path: string,
    token: string,
  ): Promise<Blob> {
    const res = await fetch(
      `${BASE}/files/subject/${subjectId}/read?path=${encodeURIComponent(path)}`,
      { headers: authHeader(token) },
    );
    if (!res.ok) {
      throw new Error(`Failed to read file: ${res.status}`);
    }
    return res.blob();
  },

  /** List student files (read-write workspace) */
  async listStudentFiles(sessionId: string, token: string): Promise<any[]> {
    return request<any[]>(`/files/student/${sessionId}/tree`, {
      headers: authHeader(token),
    });
  },

  /** Read student file */
  async readStudentFile(
    sessionId: string,
    path: string,
    token: string,
  ): Promise<Blob> {
    const res = await fetch(
      `${BASE}/files/student/${sessionId}/read?path=${encodeURIComponent(path)}`,
      { headers: authHeader(token) },
    );
    if (!res.ok) {
      throw new Error(`Failed to read file: ${res.status}`);
    }
    return res.blob();
  },

  /** Write student file */
  async writeStudentFile(
    sessionId: string,
    path: string,
    content: string | Blob,
    token: string,
  ): Promise<void> {
    const res = await fetch(
      `${BASE}/files/student/${sessionId}/write?path=${encodeURIComponent(path)}`,
      {
        method: "PUT",
        headers: {
          ...authHeader(token),
          "Content-Type":
            typeof content === "string"
              ? "text/plain"
              : "application/octet-stream",
        },
        body: content,
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to write file: ${res.status}`);
    }
  },

  /** Delete student file */
  async deleteStudentFile(
    sessionId: string,
    path: string,
    token: string,
  ): Promise<void> {
    const res = await fetch(
      `${BASE}/files/student/${sessionId}/delete?path=${encodeURIComponent(path)}`,
      {
        method: "DELETE",
        headers: authHeader(token),
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to delete file: ${res.status}`);
    }
  },
};
