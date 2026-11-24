import { API_BASE_URL } from "./constants.js";
import { coreAuth } from "./coreApi.js";

// The session token lives in localStorage rather than a cookie because the
// API is on a different origin (Railway) from the app (Netlify), and
// third-party cookies are unreliable across browsers. The tradeoff is XSS
// exposure: any script running on the page can read it. That is acceptable
// here — this app loads no third-party scripts and renders no user HTML.
const TOKEN_KEY = "core.session.token";
const EMAIL_KEY = "core.session.email";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

function store(token: string, email: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    // Private mode or blocked storage: the session simply won't persist
    // across reloads, which is survivable.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* nothing to clear */
  }
}

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // One sign-in for both backends while screens move to core-jobs-service:
  // the same credentials also open a core (/v1) session. That half is best
  // effort; a screen that needs it asks again if it failed.
  const core = coreAuth.login(email, password).catch(() => null);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `Sign in failed (${res.status}).` };
  }

  const body = (await res.json()) as { token: string; email: string };
  store(body.token, body.email);
  await core;
  return { ok: true };
}

/** Signs out of both backends. */
export async function logout(): Promise<void> {
  clearSession();
  await coreAuth.logout().catch(() => undefined);
}

// Validates a stored token against the server on app load, so an expired or
// revoked session lands on the login screen rather than failing later on the
// first write the user attempts.
export async function checkSession(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      clearSession();
      return false;
    }
    return true;
  } catch {
    // A network blip should not log the user out; treat the stored token as
    // good and let the next real request surface any problem.
    return true;
  }
}
