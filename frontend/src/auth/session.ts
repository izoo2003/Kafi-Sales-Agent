/** Persist lightweight user profile; session cookie is primary, Bearer token is backup. */

export type AppRole = "admin" | "user";

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: AppRole;
  is_active: boolean;
}

/** Bearer backup when httpOnly cookie is missing (some proxy / browser edge cases). */
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

/** Cache display profile only. */
export function storeUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** Persist profile + Bearer token from /auth/login (cookie is still set by the API). */
export function storeSession(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAdmin(user: AuthUser | null | undefined): boolean {
  return user?.role === "admin";
}
