import { API_BASE_URL } from "./constants.js";
import { clearSession, getToken } from "./auth.js";

// Every write carries the session token from POST /api/login. This replaced an
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

  // An expired or invalidated token should return the user to the login
  // screen rather than surfacing as a confusing failure on a save button.
  if (res.status === 401) {
    clearSession();
    window.location.reload();
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
