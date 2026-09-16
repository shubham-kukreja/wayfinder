import "dotenv/config";

export interface AppConfig {
  fredApiKey: string | undefined;
  metalsDevApiKey: string | undefined;
  dbPath: string;
  // playwright-core ships no browser; point this at an existing Chromium
  // install (needed by the RBI and NSE adapters). Leave unset to use
  // Playwright's default resolution (requires `npx playwright install
  // chromium` to have been run first).
  chromiumExecutablePath: string | undefined;
  // Shared secret required on every mutating request (POST/PUT/PATCH/
  // DELETE) once set. Left unset, the API stays fully open — fine for
  // local dev, never for a public deployment, where anyone could
  // otherwise call DELETE /api/snapshots/:id or rewrite /api/params.
  apiSecret: string | undefined;
  // Comma-separated exact origins allowed to call the API from a browser.
  // Unset means "reflect any origin", which is only safe locally.
  allowedOrigins: string[] | undefined;
  // HMAC key for signing session tokens. Unset disables login entirely
  // (/api/login returns 503), so the API_SECRET header stays the only way in.
  // Rotating this invalidates every issued token.
  authTokenSecret: string | undefined;
}

export function loadConfig(): AppConfig {
  const origins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    fredApiKey: process.env.FRED_API_KEY || undefined,
    metalsDevApiKey: process.env.METALS_DEV_API_KEY || undefined,
    dbPath: process.env.DB_PATH || "./data/wayfinder.db",
    chromiumExecutablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    apiSecret: process.env.API_SECRET || undefined,
    allowedOrigins: origins.length > 0 ? origins : undefined,
    authTokenSecret: process.env.AUTH_TOKEN_SECRET || undefined,
  };
}
