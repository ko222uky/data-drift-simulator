"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authApi } from "./api";

// The session lives in an HttpOnly cookie set by the auth service, so the browser never
// touches the token. This context only tracks *who* is signed in, via /api/auth/me.

interface AuthState {
  user: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Call when an API request returns 401 (e.g. the session expired). */
  invalidate: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi
      .me()
      .then((me) => setUser(me.username))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    setUser(res.username);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const invalidate = useCallback(() => setUser(null), []);

  return <AuthContext value={{ user, loading, login, logout, invalidate }}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
