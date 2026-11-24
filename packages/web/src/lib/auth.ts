import { API_BASE_URL } from "./constants.js";
import { CoreApiError, coreAuth } from "./coreApi.js";

// Sign-in is core-jobs-service's (/v1/auth/login): an HttpOnly session
// cookie, checked with GET /v1/me. That session decides whether the app is
// signed in.
//
// Screens not yet moved to /v1 still write to the legacy server, which wants
// its own bearer token. Signing in also fetches that token with the same
// credentials, best effort: if it fails, the /v1 screens work as normal and
// legacy writes report that their session is missing (see apiFetch).
//
// The legacy token lives in localStorage (that server is cross-origin, so a
// cookie is unreliable). The tradeoff is XSS exposure; this app loads no
// third-party scripts and renders no user HTML.
const TOKEN_KEY = "core.session.token";
const EMAIL_KEY = "core.session.email";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** The signed-in user's email (from core), for display. */
export function getEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: survivable, the value just won't persist.
  }
}

/** Drops the legacy token (and the cached email). */
export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Fetches the legacy server's token. Never throws; false when it failed. */
async function legacyLogin(email: string, password: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { token?: string };
    if (!body.token) return false;
    setItem(TOKEN_KEY, body.token);
    return true;
  } catch {
    return false;
  }
}

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let user;
  try {
    user = await coreAuth.login(email.trim(), password);
  } catch (err) {
    if (err instanceof CoreApiError && err.status === 401) return { ok: false, error: "Email or password is incorrect." };
    if (err instanceof CoreApiError && err.status === 429) return { ok: false, error: "Too many attempts. Try again in a few minutes." };
    if (err instanceof CoreApiError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
  setItem(EMAIL_KEY, user.email);
  await legacyLogin(email.trim(), password);
  return { ok: true };
}

/** Signs out of core and drops the legacy token. */
export async function logout(): Promise<void> {
  clearSession();
  await coreAuth.logout().catch(() => undefined);
}

/**
 * Checks the core session on app load: "in", "out", or "unreachable" when
 * core cannot be reached (shown as such, rather than as a login screen).
 */
export async function checkSession(): Promise<"in" | "out" | "unreachable"> {
  try {
    const user = await coreAuth.me();
    setItem(EMAIL_KEY, user.email);
    return "in";
  } catch (err) {
    if (err instanceof CoreApiError && err.status === 401) return "out";
    return "unreachable";
  }
}
