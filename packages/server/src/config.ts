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
}

export function loadConfig(): AppConfig {
  return {
    fredApiKey: process.env.FRED_API_KEY || undefined,
    metalsDevApiKey: process.env.METALS_DEV_API_KEY || undefined,
    dbPath: process.env.DB_PATH || "./data/wayfinder.db",
    chromiumExecutablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  };
}
