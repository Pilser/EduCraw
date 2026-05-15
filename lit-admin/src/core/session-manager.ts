import type { LoginResponse } from "./admin-types";

const AUTH_STORAGE_KEY = "educlaw_auth";

interface StoredAuth extends LoginResponse {}

export class SessionManager {
  static saveAuth(auth: LoginResponse): void {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
    } catch {
      // localStorage might be unavailable
    }
  }

  static loadAuth(): StoredAuth | null {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      return stored ? (JSON.parse(stored) as StoredAuth) : null;
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
  }

  static clearAuth(): void {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }

  static isAuthenticated(): boolean {
    return this.loadAuth() !== null;
  }

  static async validateToken(token: string): Promise<boolean> {
    try {
      const res = await fetch("/me", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
