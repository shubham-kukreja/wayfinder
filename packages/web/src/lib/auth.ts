import { CoreApiError, coreAuth } from "./coreApi.js";

// Sign-in is core-jobs-service's (/v1/auth/login): an HttpOnly session
// cookie, checked with GET /v1/me. That session decides whether the app is
// signed in. Only the user's email is kept locally, for display.
const LEGACY_TOKEN_KEY = "core.session.token"; // from the retired legacy server; cleared on sign-out
const EMAIL_KEY = "core.session.email";

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

/** Drops the cached email (and any legacy token left behind). */
export function clearSession(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* nothing to clear */
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
  return { ok: true };
}

/** Signs out of core. */
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
