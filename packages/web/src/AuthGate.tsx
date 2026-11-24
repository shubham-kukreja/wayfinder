import { useEffect, useState } from "react";
import App from "./App.js";
import { LoginView } from "./views/LoginView.js";
import { checkSession } from "./lib/auth.js";

// Gates the whole app on a core (/v1) session. App is not mounted until then,
// so an unauthenticated visitor triggers no data fetches at all.
//
// This is a convenience boundary, not the security boundary: the API rejects
// unauthorised requests on its own.
export function AuthGate() {
  const [state, setState] = useState<"checking" | "in" | "out" | "unreachable">("checking");

  useEffect(() => {
    if (state !== "checking") return;
    let cancelled = false;
    void checkSession().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [state]);

  // Deliberately blank rather than a spinner: the check is a single request
  // against an already-warm server, and a flashed spinner reads worse than a
  // beat of nothing.
  if (state === "checking") return <div className="min-h-screen bg-paper-2" />;
  if (state === "unreachable") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-2 px-6">
        <div className="max-w-sm text-center">
          <p className="text-sm font-semibold text-ink">Can't reach the CORE data service.</p>
          <p className="mt-1 text-[13px] text-muted">Check that core-jobs-service is running, then try again.</p>
          <button
            type="button"
            onClick={() => setState("checking")}
            className="mt-4 rounded-sm bg-ink px-4 py-2 text-[13px] font-semibold text-paper"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (state === "out") return <LoginView onSuccess={() => setState("in")} />;
  return <App />;
}
