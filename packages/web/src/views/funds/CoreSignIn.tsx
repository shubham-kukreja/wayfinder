import { useState, type FormEvent } from "react";
import { CoreApiError, coreAuth, type CoreUser } from "../../lib/coreApi.js";

// Fund rankings come from core-jobs-service, which has its own accounts and
// cookie session (separate from the legacy server's login).
export function CoreSignIn({ error, onSignedIn }: { error: string | null; onSignedIn: (u: CoreUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      onSignedIn(await coreAuth.login(email.trim(), password));
    } catch (err) {
      setMessage(
        err instanceof CoreApiError && err.status === 401
          ? "Email or password is incorrect."
          : err instanceof CoreApiError && err.status === 429
            ? "Too many attempts. Try again later."
            : `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex justify-center px-4 py-16">
      <form onSubmit={submit} className="w-full max-w-sm rounded-sm border border-line bg-paper p-6 shadow-md">
        <p className="text-xs font-semibold uppercase tracking-eyebrow text-muted">Funds</p>
        <h1 className="font-display text-xl font-semibold text-ink">Sign in to the data service</h1>
        <p className="mt-1 text-[13px] text-ink-2">Fund rankings use your core-jobs-service account.</p>
        {error && <p className="mt-3 text-[13px] text-danger-500">{error}</p>}
        <label className="mt-5 block text-xs font-semibold text-ink">
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-sm border border-line px-3 py-2 text-sm font-normal focus:border-ink focus:outline-none"
          />
        </label>
        <label className="mt-3 block text-xs font-semibold text-ink">
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-sm border border-line px-3 py-2 text-sm font-normal focus:border-ink focus:outline-none"
          />
        </label>
        {message && <p className="mt-3 text-[13px] text-danger-500">{message}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-sm bg-ink px-4 py-2 text-sm font-semibold text-paper transition-opacity duration-100 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
