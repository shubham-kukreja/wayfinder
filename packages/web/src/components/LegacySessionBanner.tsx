import { useEffect, useState } from "react";
import { LEGACY_SESSION_MISSING } from "../lib/apiFetch.js";
import { logout } from "../lib/auth.js";

// Shown when the legacy server rejects a save: pages not yet moved to core
// need that server's session, which sign-in fetches with the same password.
export function LegacySessionBanner() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const on = () => setShown(true);
    window.addEventListener(LEGACY_SESSION_MISSING, on);
    return () => window.removeEventListener(LEGACY_SESSION_MISSING, on);
  }, []);
  if (!shown) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warn-200 bg-warn-50 px-6 py-2 text-xs text-warn-800">
      <span>That change was not saved: this page still runs on the old server, and its session is missing or expired.</span>
      <button type="button" onClick={() => void logout().then(() => window.location.reload())} className="font-semibold underline">
        Sign in again
      </button>
      <button type="button" onClick={() => setShown(false)} className="text-warn-600" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
