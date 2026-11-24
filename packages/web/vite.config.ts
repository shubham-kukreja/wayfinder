import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// core-jobs-service (the /v1 API). Its session cookies are SameSite=Strict, so
// the browser must see /v1 on the app's own origin: Vite proxies it here, and
// the production host must do the same (see src/lib/coreApi.ts).
const CORE_API_URL = process.env.CORE_API_URL ?? "http://127.0.0.1:8090";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: CORE_API_URL, changeOrigin: false },
    },
  },
});
