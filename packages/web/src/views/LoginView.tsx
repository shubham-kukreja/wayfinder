import { useState, type FormEvent } from "react";
import { login } from "../lib/auth.js";

// Sign-in screen. The dashboard's restraint carries over — 4px corners, Inter
// Tight display, one accent — but the product name gets the weight here: CORE
// is set at display scale, with the Arvia mark as the quiet endorsement above
// it rather than the hero. A single centred column, no card-on-card nesting.
export function LoginView({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await login(email, password);
    if (result.ok) {
      onSuccess();
    } else {
      setError(result.error);
      setPassword("");
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-md border border-line bg-paper px-3.5 py-2.5 text-sm text-ink placeholder:text-muted " +
    "transition duration-100 ease-in focus:border-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 " +
    "disabled:opacity-50";

  return (
    <div className="flex min-h-screen flex-col bg-paper-2">
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          {/* Endorsement line: the parent brand sits above the product, small
              and quiet, so CORE remains the thing you read first. */}
          <div className="mb-10 flex flex-col items-center">
            <img src="/logo-arvia.svg" alt="Arvia Wealth" className="h-7 w-auto opacity-90" />
            <div className="mt-8 flex items-baseline gap-2.5">
              <h1 className="font-display text-[44px] font-extrabold leading-display tracking-display text-ink">
                CORE
              </h1>
              <span className="h-1.5 w-1.5 shrink-0 translate-y-[-6px] rounded-full bg-brand-500" aria-hidden="true" />
            </div>
            <p className="mt-2.5 text-center text-[13px] leading-relaxed text-muted">
              Capital allocation research
              <br />
              by Arvia Wealth
            </p>
          </div>

          <form onSubmit={handleSubmit} className="rounded-md border border-line bg-paper p-6 shadow-xs">
            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-ink-2">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  autoFocus
                  disabled={busy}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@arviawealth.com"
                  className={field}
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-ink-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className={field}
                />
              </div>
            </div>

            {/* role=alert so the failure is announced, not just shown. */}
            {error && (
              <p role="alert" className="mt-4 rounded-md bg-danger-50 px-3 py-2 text-[13px] text-danger-500">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !email || !password}
              className="mt-6 w-full rounded-md bg-ink px-[22px] py-[11px] text-sm font-semibold text-paper transition duration-100 ease-in hover:brightness-[1.15] active:brightness-[0.95] disabled:pointer-events-none disabled:opacity-40"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-muted">
            Access is limited to authorised Arvia Wealth personnel.
          </p>
        </div>
      </main>

      <footer className="px-6 pb-8 text-center text-[11px] text-muted">
        © {new Date().getFullYear()} Arvia Wealth. All rights reserved.
      </footer>
    </div>
  );
}
