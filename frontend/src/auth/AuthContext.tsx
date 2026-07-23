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
  getStoredUser,
  isAdmin,
  storeUser,
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

/** Max wait for session bootstrap before forcing login screen. */
const AUTH_SAFETY_MS = 20_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  // Always verify cookie session on boot (httpOnly cookie isn't readable from JS).
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    const safetyPromise = new Promise<void>((resolve) => {
      safetyTimer = setTimeout(() => {
        clearSession();
        setUser(null);
        setLoading(false);
        resolve();
      }, AUTH_SAFETY_MS);
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
        storeUser(next);
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
    // Cookie is set by the API; we only cache the profile for UI.
    storeUser(next);
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
