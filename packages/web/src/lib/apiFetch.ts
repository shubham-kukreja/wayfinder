import { API_BASE_URL } from "./constants.js";

// The deployed API requires x-api-secret on every mutating request (see
// server/src/index.ts). Vite inlines this at BUILD time, so it must be set
// as VITE_API_SECRET in the deploy environment, not at runtime.
//
// SECURITY: this value ships inside the JS bundle and is readable by anyone
// who opens devtools on the deployed site. It raises the bar against drive-by
// scripts and crawlers; it is NOT protection against a person who looks.
// Anything stronger needs real auth (a login, or an authenticating proxy that
// keeps the secret server-side).
const API_SECRET = import.meta.env.VITE_API_SECRET ?? "";

// Single choke point for API calls so the auth header cannot be forgotten on
// a new endpoint — every write goes through here rather than a bare fetch().
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (API_SECRET) headers.set("x-api-secret", API_SECRET);
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

// Same, for JSON bodies — sets Content-Type alongside the auth header.
export async function apiFetchJson(path: string, method: string, body: unknown): Promise<Response> {
  return apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
