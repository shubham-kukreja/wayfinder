import { useEffect, useState, type ReactNode } from "react";
import { CoreApiError, coreAuth } from "../lib/coreApi.js";
import { CoreSignIn } from "../views/funds/CoreSignIn.js";

// Screens that read core-jobs-service (/v1) render inside this gate. The main
// login signs in to core as well, so this only asks when that session is
// missing or expired (or the account differs between the two backends).
type State = "checking" | "in" | "out";

let known: State = "checking";

export function CoreSessionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(known);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "checking") return;
    const ac = new AbortController();
    coreAuth
      .me(ac.signal)
      .then(() => setState((known = "in")))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        if (!(e instanceof CoreApiError && e.status === 401)) {
          setError(`Could not reach the data service: ${e instanceof Error ? e.message : String(e)}`);
        }
        setState((known = "out"));
      });
    return () => ac.abort();
  }, [state]);

  if (state === "checking") return <div className="px-6 py-10 text-sm text-muted">Loading…</div>;
  if (state === "out") return <CoreSignIn error={error} onSignedIn={() => setState((known = "in"))} />;
  return <>{children}</>;
}

/** Forget the cached session state (after sign-out, or a 401 mid-session). */
export function resetCoreSession() {
  known = "checking";
}
