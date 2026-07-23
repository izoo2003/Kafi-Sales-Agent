/** Persist lightweight user profile hint; real auth is the httpOnly session cookie. */

export type AppRole = "admin" | "user";

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: AppRole;
  is_active: boolean;
}

/** Legacy localStorage token — cleared on login/logout; Bearer still sent if present (migration). */
const TOKEN_KEY = "kafi_auth_token";
const USER_KEY = "kafi_auth_user";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed?.id || !parsed?.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Cache display profile only — session lives in httpOnly cookie `kafi_session`. */
export function storeUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  // Drop legacy bearer tokens so cookie auth is the source of truth.
  localStorage.removeItem(TOKEN_KEY);
}

/** @deprecated Prefer storeUser — kept for call sites during migration. */
export function storeSession(_token: string, user: AuthUser): void {
  storeUser(user);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAdmin(user: AuthUser | null | undefined): boolean {
  return user?.role === "admin";
}
