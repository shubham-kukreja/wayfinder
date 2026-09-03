import "dotenv/config";

export interface AppConfig {
  fredApiKey: string | undefined;
  metalsDevApiKey: string | undefined;
  dbPath: string;
}

export function loadConfig(): AppConfig {
  return {
    fredApiKey: process.env.FRED_API_KEY || undefined,
    metalsDevApiKey: process.env.METALS_DEV_API_KEY || undefined,
    dbPath: process.env.DB_PATH || "./data/wayfinder.db",
  };
}
