import type {
  Cohort,
  LoginResponse,
  MeResponse,
  QuotaResponse,
  Session,
  SessionListItem,
  ForkThreadResult,
  ImportThreadResult,
  SessionModels,
  TokenUsage,
  UpdateMeRequest,
  UpdateMeResponse,
} from "./edu-types";
import { handleError, classifyError, type AppError } from "./error-handler.js";

export { type AppError };

const BASE = ""; // Same origin, Vite proxy handles /auth and /sessions

// ── SSE Stream parser ─────────────────────────────────────────────────────

export interface SseEvent {
  event: string;
  data: any;
}

/**
 * Parse a fetch response body as an SSE stream.
 * Returns an async iterable of parsed SSE events plus an abort function.
 */
function sseStream(
  input: RequestInfo,
  init?: RequestInit,
): { events: AsyncIterable<SseEvent>; abort: () => void } {
  const controller = new AbortController();
  const signal = controller.signal;

  const events: AsyncIterable<SseEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<SseEvent> {
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let buffer = "";
      let done = false;

      return {
        async next(): Promise<IteratorResult<SseEvent>> {
          if (done) return { value: undefined, done: true };

          if (!reader) {
            const response = await fetch(input, {
              ...init,
              signal,
              headers: {
                "Content-Type": "application/json",
                ...(init?.headers as Record<string, string> | undefined),
              },
            });

            if (!response.ok) {
              const text = await response.text().catch(() => "Unknown error");
              console.error(`[sse] Request failed: ${response.status}`, text);
              let parsed: { error?: string; code?: string } = {};
              try { parsed = JSON.parse(text); } catch { /* not JSON */ }
              const classified = classifyError({
                status: response.status,
                message: parsed.error || text,
                code: parsed.code,
              });
              handleError(classified);
              throw classified;
            }

            if (!response.body) {
              console.error("[sse] Response has no body");
              done = true;
              return { value: undefined, done: true };
            }

            reader = response.body.getReader();
          }

          const decoder = new TextDecoder();

          while (true) {
            // Look for double newline (SSE event delimiter)
            const doubleNewlineIdx = buffer.indexOf("\n\n");
            if (doubleNewlineIdx !== -1) {
              const eventBlock = buffer.substring(0, doubleNewlineIdx);
              buffer = buffer.substring(doubleNewlineIdx + 2);

              const eventMatch = eventBlock.match(/^event:\s*([^\n]*)/);
              const dataMatch = eventBlock.match(/^data:\s*([\s\S]*?)$/m);

              if (eventMatch && dataMatch) {
                const eventType = eventMatch[1].trim();
                const rawData = dataMatch[1].trim();

                let parsedData: any;
                try {
                  parsedData = JSON.parse(rawData);
                } catch {
                  parsedData = rawData;
                }

                return {
                  value: { event: eventType, data: parsedData },
                  done: false,
                };
              }
              // Malformed event block — skip and try next
              continue;
            }

            // Need more data — read next chunk
            if (reader) {
              let result: ReadableStreamReadResult<Uint8Array>;
              try {
                result = await reader.read();
              } catch (readErr: any) {
                const readErrName = readErr?.name || "ReadError";
                const readErrMsg = readErr?.message || String(readErr);
                console.error(
                  `[sse-stream] reader.read() failed: ${readErrName}: ${readErrMsg}`,
                  "\n  buffer.length:", buffer.length,
                  "\n  full error:", readErr,
                );
                throw readErr;
              }
              if (result.done) {
                done = true;
                return { value: undefined, done: true };
              }
              buffer += decoder.decode(result.value, { stream: true });
            } else {
              done = true;
              return { value: undefined, done: true };
            }
          }
        },
      };
    },
  };

  return { events, abort: () => controller.abort() };
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    console.error(`[edu-api] Request failed: ${res.status} ${url}`, text);
    // Parse backend JSON error if available
    let parsed: { error?: string; code?: string } = {};
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    handleError({ status: res.status, message: parsed.error || text || res.statusText, code: parsed.code });
    throw new Error(`${res.status}: ${parsed.error || text || res.statusText}`);
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

function extractSessionId(url: string): string | undefined {
  const m = url.match(/\/sessions\/([a-f0-9-]{36})/);
  return m?.[1];
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

  /** Student self-registration */
  async register(
    displayName: string,
    username: string,
    password: string,
    confirmPassword: string,
    cohortId?: string,
  ): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        display_name: displayName,
        username,
        password,
        confirm_password: confirmPassword,
        cohort_id: cohortId || "",
      }),
    });
  },

  /** List all available cohorts (public) */
  async listCohorts(): Promise<Cohort[]> {
    return request<Cohort[]>("/cohorts");
  },

  /** Create a new chat session. sessionId is generated by frontend. */
  async createSession(
    studentId: string,
    token: string,
    model?: string,
    sessionId?: string,
  ): Promise<Session> {
    return request<Session>("/sessions", {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ student_id: studentId, model, session_id: sessionId }),
    });
  },

  /** Eagerly spawn goose for a session */
  async spawnSession(
    sessionId: string,
    token: string,
    action: "recent" | "new",
  ): Promise<{ status: string; thread_id: string | null }> {
    return request(`/sessions/${sessionId}/spawn`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ action }),
    });
  },

  /** End/terminate a session */
  async endSession(sessionId: string, token: string): Promise<void> {
    const res = await fetch(`${BASE}/sessions/${sessionId}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      let parsed: { error?: string; code?: string } = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      handleError({ status: res.status, message: parsed.error || text, code: parsed.code });
      throw new Error(`${res.status}: ${parsed.error || text || res.statusText}`);
    }
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
    const res = await fetch(`${BASE}/sessions/${sessionId}/model`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(token) },
      body: JSON.stringify({ model, thinking_params: thinkingParams }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      let parsed: { error?: string; code?: string } = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      handleError({ status: res.status, message: parsed.error || text, code: parsed.code });
      throw new Error(`${res.status}: ${parsed.error || text || res.statusText}`);
    }
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

  /** Delete a thread permanently */
  async deleteThread(
    sessionId: string,
    threadId: string,
    token: string,
  ): Promise<void> {
    const res = await fetch(`${BASE}/sessions/${sessionId}/threads/${threadId}`, {
      method: "DELETE",
      headers: authHeader(token),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      let parsed: { error?: string; code?: string } = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      handleError({ status: res.status, message: parsed.error || text, code: parsed.code });
      throw new Error(`${res.status}: ${parsed.error || text || res.statusText}`);
    }
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
      const text = await res.text().catch(() => "Unknown error");
      let parsed: { error?: string; code?: string } = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      handleError({ status: res.status, message: parsed.error || text, code: parsed.code });
      throw new Error(`${res.status}: ${parsed.error || text || res.statusText}`);
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
      const text = await res.text().catch(() => "Unknown error");
      let parsed: { error?: string; code?: string } = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      handleError({ status: res.status, message: parsed.error || text, code: parsed.code });
      throw new Error(`${res.status}: ${parsed.error || text || res.statusText}`);
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
      const text = await res.text().catch(() => "Unknown error");
      let parsed: { error?: string; code?: string } = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      handleError({ status: res.status, message: parsed.error || text, code: parsed.code });
      throw new Error(`${res.status}: ${parsed.error || text || res.statusText}`);
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
      const text = await res.text().catch(() => "Unknown error");
      let parsed: { error?: string; code?: string } = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      handleError({ status: res.status, message: parsed.error || text, code: parsed.code });
      throw new Error(`${res.status}: ${parsed.error || text || res.statusText}`);
    }
  },

  /** Get student workspace disk usage and quota */
  async getStudentQuota(
    sessionId: string,
    token: string,
  ): Promise<QuotaResponse> {
    return request<QuotaResponse>(`/files/student/${sessionId}/quota`, {
      headers: authHeader(token),
    });
  },

  /** Get current student's profile */
  async getMe(token: string): Promise<MeResponse> {
    return request<MeResponse>("/me", {
      headers: authHeader(token),
    });
  },

  /** Update current student's profile (cohort, display name, password) */
  async updateMe(
    token: string,
    body: UpdateMeRequest,
  ): Promise<UpdateMeResponse> {
    return request<UpdateMeResponse>("/me", {
      method: "PATCH",
      headers: authHeader(token),
      body: JSON.stringify(body),
    });
  },

  // ── SSE methods (new transport replacing WebSocket) ──────────────────

  /** Send user input and get back an SSE event stream */
  sendInput(
    sessionId: string,
    token: string,
    data: string,
    image?: string,
    mimeType?: string,
    requestId?: string,
  ): { events: AsyncIterable<SseEvent>; abort: () => void } {
    return sseStream(`${BASE}/sessions/${sessionId}/input`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ data, image, mime_type: mimeType, request_id: requestId }),
    });
  },

  /** Cancel the current in-flight prompt */
  async cancelInput(sessionId: string, token: string): Promise<void> {
    const res = await fetch(`${BASE}/sessions/${sessionId}/cancel`, {
      method: "POST",
      headers: authHeader(token),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      let parsed: { error?: string; code?: string } = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      handleError({ status: res.status, message: parsed.error || text, code: parsed.code });
      throw new Error(`${res.status}: ${parsed.error || text || res.statusText}`);
    }
  },

  /** Load thread replay as an SSE event stream */
  replayThread(
    sessionId: string,
    token: string,
    threadId: string,
  ): { events: AsyncIterable<SseEvent>; abort: () => void } {
    return sseStream(
      `${BASE}/sessions/${sessionId}/threads/${threadId}/replay`,
      {
        headers: authHeader(token),
      },
    );
  },
};
