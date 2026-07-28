import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { client } from "../api/client";
import {
  clearSession,
  getStoredUser,
  isAdmin,
  storeSession,
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
const AUTH_SAFETY_MS = 55_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  // Always verify cookie session on boot (httpOnly cookie isn't readable from JS).
  const [loading, setLoading] = useState(true);
  /** Bumped on login/logout so a late /auth/me failure cannot wipe a fresh session. */
  const authEpochRef = useRef(0);

  const refreshMe = useCallback(async () => {
    const epoch = authEpochRef.current;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    const safetyPromise = new Promise<void>((resolve) => {
      safetyTimer = setTimeout(() => {
        if (authEpochRef.current !== epoch) {
          resolve();
          return;
        }
        clearSession();
        setUser(null);
        setLoading(false);
        resolve();
      }, AUTH_SAFETY_MS);
    });

    const work = async () => {
      try {
        // Wake Railway (cold start / idle) before /auth/me so the first
        // authenticated call is less likely to abort mid-hop.
        await client.wakeBackend();
        if (authEpochRef.current !== epoch) return;
        const me = await client.getMe();
        if (authEpochRef.current !== epoch) return;
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
        // Ignore stale bootstrap failures after the user already signed in.
        if (authEpochRef.current !== epoch) return;
        clearSession();
        setUser(null);
      } finally {
        if (safetyTimer !== null) clearTimeout(safetyTimer);
        if (authEpochRef.current === epoch) {
          setLoading(false);
        }
      }
    };

    await Promise.race([work(), safetyPromise]);
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const onExpired = () => {
      authEpochRef.current += 1;
      clearSession();
      setUser(null);
      setLoading(false);
    };
    window.addEventListener("kafi:auth-expired", onExpired);
    return () => window.removeEventListener("kafi:auth-expired", onExpired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    // Invalidate any in-flight /auth/me from page load so it cannot clear this login.
    authEpochRef.current += 1;
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
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    authEpochRef.current += 1;
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
