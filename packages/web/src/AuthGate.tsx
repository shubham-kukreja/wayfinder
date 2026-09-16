import { useEffect, useState } from "react";
import App from "./App.js";
import { LoginView } from "./views/LoginView.js";
import { checkSession, getToken } from "./lib/auth.js";

// Gates the whole app on a valid session. App is not mounted until then, so an
// unauthenticated visitor triggers no data fetches at all.
//
// This is a convenience boundary, not the security boundary — the server
// rejects unauthorised writes on its own. Rendering the dashboard shell to
// someone without a session would simply show empty, failing panels.
export function AuthGate() {
  const [state, setState] = useState<"checking" | "in" | "out">(() => (getToken() ? "checking" : "out"));

  useEffect(() => {
    if (state !== "checking") return;
    let cancelled = false;
    void checkSession().then((ok) => {
      if (!cancelled) setState(ok ? "in" : "out");
    });
    return () => {
      cancelled = true;
    };
  }, [state]);

  // Deliberately blank rather than a spinner: the check is a single request
  // against an already-warm server, and a flashed spinner reads worse than a
  // beat of nothing.
  if (state === "checking") return <div className="min-h-screen bg-paper-2" />;
  if (state === "out") return <LoginView onSuccess={() => setState("in")} />;
  return <App />;
}
