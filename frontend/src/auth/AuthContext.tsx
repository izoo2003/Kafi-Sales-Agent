import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { client } from "../api/client";
import {
  clearSession,
  getStoredToken,
  getStoredUser,
  isAdmin,
  storeSession,
  type AuthUser,
} from "./session";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [loading, setLoading] = useState(() => Boolean(getStoredToken()));

  const refreshMe = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    // Hard safety net: if the /auth/me request hangs beyond this, unblock the UI.
    // The fetch already has a 12s per-attempt timeout; this covers the full retry cycle.
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    const safetyPromise = new Promise<void>((resolve) => {
      safetyTimer = setTimeout(() => {
        clearSession();
        setUser(null);
        setLoading(false);
        resolve();
      }, 30_000);
    });

    const work = async () => {
      try {
        const me = await client.getMe();
        const next: AuthUser = {
          id: me.id,
          username: me.username,
          full_name: me.full_name,
          role: me.role === "admin" ? "admin" : "user",
          is_active: me.is_active,
        };
        storeSession(token, next);
        setUser(next);
      } catch {
        clearSession();
        setUser(null);
      } finally {
        if (safetyTimer !== null) clearTimeout(safetyTimer);
        setLoading(false);
      }
    };

    await Promise.race([work(), safetyPromise]);
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const onExpired = () => {
      clearSession();
      setUser(null);
      setLoading(false);
    };
    window.addEventListener("kafi:auth-expired", onExpired);
    return () => window.removeEventListener("kafi:auth-expired", onExpired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await client.login({ username, password });
    const next: AuthUser = {
      id: result.user.id,
      username: result.user.username,
      full_name: result.user.full_name,
      role: result.user.role === "admin" ? "admin" : "user",
      is_active: result.user.is_active,
    };
    storeSession(result.token, next);
    setUser(next);
  }, []);

  const logout = useCallback(async () => {
    try {
      await client.logout();
    } catch {
      /* ignore — clear local session anyway */
    }
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAdmin: isAdmin(user),
      login,
      logout,
      refreshMe,
    }),
    [user, loading, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
