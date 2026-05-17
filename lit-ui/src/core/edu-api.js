const BASE = ""; // Same origin, Vite proxy handles /auth and /sessions
async function request(url, options) {
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
    }
    else {
        const text = await res.text();
        console.error(`[edu-api] Expected JSON but got: ${contentType}`, text);
        throw new Error(`Expected JSON response but got ${contentType}`);
    }
}
function authHeader(token) {
    return { Authorization: `Bearer ${token}` };
}
export const eduApi = {
    /** Student/staff login */
    async login(username, password) {
        return request("/auth/login", {
            method: "POST",
            body: JSON.stringify({ username, password }),
        });
    },
    /** Bootstrap admin token (dev only) */
    async bootstrapToken(secret) {
        return request("/auth/token", {
            method: "POST",
            body: JSON.stringify({ secret }),
        });
    },
    /** Student self-registration */
    async register(displayName, username, password, confirmPassword, cohortId) {
        return request("/auth/register", {
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
    async listCohorts() {
        return request("/cohorts");
    },
    /** Create a new chat session */
    async createSession(studentId, token, model) {
        return request("/sessions", {
            method: "POST",
            headers: authHeader(token),
            body: JSON.stringify({ student_id: studentId, model }),
        });
    },
    /** End/terminate a session */
    async endSession(sessionId, token) {
        await fetch(`${BASE}/sessions/${sessionId}`, {
            method: "DELETE",
            headers: authHeader(token),
        });
    },
    /** Get available models for a session */
    async getSessionModels(sessionId, token) {
        return request(`/sessions/${sessionId}/models`, {
            headers: authHeader(token),
        });
    },
    /** Switch the active model for a session */
    async setSessionModel(sessionId, token, model, thinkingParams) {
        await fetch(`${BASE}/sessions/${sessionId}/model`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeader(token) },
            body: JSON.stringify({ model, thinking_params: thinkingParams }),
        });
    },
    /** Get token usage for a session */
    async getSessionTokenUsage(sessionId, token) {
        return request(`/sessions/${sessionId}/token-usage`, {
            headers: authHeader(token),
        });
    },
    /** List threads for a session */
    async listThreads(sessionId, token) {
        return request(`/sessions/${sessionId}/threads`, {
            headers: authHeader(token),
        });
    },
    /** Fork a thread, creating a new session with copied history */
    async forkThread(sessionId, threadId, token) {
        return request(`/sessions/${sessionId}/threads/${threadId}/fork`, {
            method: "POST",
            headers: authHeader(token),
        });
    },
    /** Create a new empty thread (no history) */
    async createThread(sessionId, token) {
        return request(`/sessions/${sessionId}/threads/new`, {
            method: "POST",
            headers: authHeader(token),
        });
    },
    /** Export a thread as JSON string */
    async exportThread(sessionId, threadId, token) {
        return request(`/sessions/${sessionId}/threads/${threadId}/export`, {
            headers: authHeader(token),
        });
    },
    /** Import a thread from JSON string */
    async importThread(sessionId, data, token) {
        return request(`/sessions/${sessionId}/threads/import`, {
            method: "POST",
            headers: authHeader(token),
            body: JSON.stringify({ data }),
        });
    },
    /** List subject files (read-only course materials) */
    async listSubjectFiles(subjectId, token) {
        return request(`/files/subject/${subjectId}/tree`, {
            headers: authHeader(token),
        });
    },
    /** Read subject file */
    async readSubjectFile(subjectId, path, token) {
        const res = await fetch(`${BASE}/files/subject/${subjectId}/read?path=${encodeURIComponent(path)}`, { headers: authHeader(token) });
        if (!res.ok) {
            throw new Error(`Failed to read file: ${res.status}`);
        }
        return res.blob();
    },
    /** List student files (read-write workspace) */
    async listStudentFiles(sessionId, token) {
        return request(`/files/student/${sessionId}/tree`, {
            headers: authHeader(token),
        });
    },
    /** Read student file */
    async readStudentFile(sessionId, path, token) {
        const res = await fetch(`${BASE}/files/student/${sessionId}/read?path=${encodeURIComponent(path)}`, { headers: authHeader(token) });
        if (!res.ok) {
            throw new Error(`Failed to read file: ${res.status}`);
        }
        return res.blob();
    },
    /** Write student file */
    async writeStudentFile(sessionId, path, content, token) {
        const res = await fetch(`${BASE}/files/student/${sessionId}/write?path=${encodeURIComponent(path)}`, {
            method: "PUT",
            headers: {
                ...authHeader(token),
                "Content-Type": typeof content === "string"
                    ? "text/plain"
                    : "application/octet-stream",
            },
            body: content,
        });
        if (!res.ok) {
            throw new Error(`Failed to write file: ${res.status}`);
        }
    },
    /** Delete student file */
    async deleteStudentFile(sessionId, path, token) {
        const res = await fetch(`${BASE}/files/student/${sessionId}/delete?path=${encodeURIComponent(path)}`, {
            method: "DELETE",
            headers: authHeader(token),
        });
        if (!res.ok) {
            throw new Error(`Failed to delete file: ${res.status}`);
        }
    },
    /** Get current student's profile */
    async getMe(token) {
        return request("/me", {
            headers: authHeader(token),
        });
    },
    /** Update current student's profile (cohort, display name, password) */
    async updateMe(token, body) {
        return request("/me", {
            method: "PATCH",
            headers: authHeader(token),
            body: JSON.stringify(body),
        });
    },
};
