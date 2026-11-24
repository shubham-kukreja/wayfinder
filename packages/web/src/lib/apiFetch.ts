import { API_BASE_URL } from "./constants.js";
import { getToken } from "./auth.js";

/** Fired when the legacy server rejects its token (see LegacySessionBanner). */
export const LEGACY_SESSION_MISSING = "core:legacy-session-missing";

// Every write to the legacy server carries its token from POST /api/login
// (fetched at sign-in alongside the core session; see lib/auth.ts). This replaced an
// earlier VITE_API_SECRET that was inlined into the bundle — that value was
// readable by anyone who opened devtools, whereas a token is per-user, expires,
// and never exists at build time.
//
// Single choke point so a new endpoint cannot silently skip authentication.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  // The core session decides sign-in now, so a rejected legacy token must
  // not log the user out or reload away their work. Say so instead; the
  // caller still sees the 401 and reports the failed save.
  if (res.status === 401) {
    window.dispatchEvent(new Event(LEGACY_SESSION_MISSING));
  }

  return res;
}

export async function apiFetchJson(path: string, method: string, body: unknown): Promise<Response> {
  return apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
