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

/** If /auth/me hangs (Railway cold start), stop blocking the UI. */
const AUTH_SAFETY_MS = 18_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const cached = getStoredUser();
  const [user, setUser] = useState<AuthUser | null>(() => cached);
  // Only block on "Checking session…" when we have no cached profile.
  const [loading, setLoading] = useState(() => !cached);
  /** Bumped on login/logout so a late /auth/me failure cannot wipe a fresh session. */
  const authEpochRef = useRef(0);

  const refreshMe = useCallback(async () => {
    const epoch = authEpochRef.current;
    const hadCachedUser = Boolean(getStoredUser());
    // Cached users already see the app — never keep the splash for them.
    if (hadCachedUser) {
      setLoading(false);
    }

    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    const safetyPromise = new Promise<void>((resolve) => {
      safetyTimer = setTimeout(() => {
        if (authEpochRef.current !== epoch) {
          resolve();
          return;
        }
        // No cached session and API never answered — show login.
        if (!getStoredUser()) {
          clearSession();
          setUser(null);
        }
        setLoading(false);
        resolve();
      }, AUTH_SAFETY_MS);
    });

    const work = async () => {
      try {
        // Short wake — don't let health retries dominate bootstrap.
        await Promise.race([
          client.wakeBackend(),
          new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 8_000)),
        ]);
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
        // Keep cached user if we already showed the app; only clear when
        // we never had a local profile (cookie-only / first visit).
        if (!hadCachedUser) {
          clearSession();
          setUser(null);
        }
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
