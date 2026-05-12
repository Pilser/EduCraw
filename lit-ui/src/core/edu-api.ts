import type {
  LoginResponse,
  Session,
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
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
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
};
