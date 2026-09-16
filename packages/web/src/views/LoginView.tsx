import { useState, type FormEvent } from "react";
import { login } from "../lib/auth.js";

// Sign-in laid out after Altruist's own auth screen: an inset artwork card on
// the left with the statement overlaid at its foot, and a narrow form column on
// the right carrying the wordmark, fields, and legal copy.
//
// Below lg the artwork card is dropped rather than stacked — on a phone it
// would push the form under the fold for purely decorative content.
export function LoginView({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  // Filled grey field with no border — the input reads as a recess rather than
  // an outlined box, which is what keeps the column quiet.
  const field =
    "w-full rounded-sm border border-transparent bg-paper-2 px-3.5 py-3 text-sm text-ink " +
    "placeholder:text-muted transition duration-100 ease-in focus:border-ink focus:bg-paper " +
    "focus:outline-none disabled:opacity-50";

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto flex min-h-screen w-full flex-col gap-8 p-5 lg:h-screen lg:flex-row lg:items-stretch lg:gap-[14%] lg:p-8">
        {/* ---------- left: artwork card ---------- */}
        {/* Inset with its own radius rather than bleeding to the viewport edge,
            so it reads as a plate on the page. */}
        <div className="relative hidden w-[48%] shrink-0 overflow-hidden rounded-lg bg-[#0B1A10] lg:block">
          <img
            src="/guilloche.svg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 h-[150%] w-[150%] max-w-none -translate-x-1/2 -translate-y-1/2 select-none"
          />
          {/* Darkens the foot of the card so the statement stays legible over
              whatever part of the pattern sits behind it. */}
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent"
            aria-hidden="true"
          />

          <div className="relative flex h-full flex-col justify-end p-10">
            <p className="font-display text-[46px] font-extrabold leading-[0.98] tracking-display text-white">
              Make wealth work
              <br />
              alongside you.
            </p>
          </div>
        </div>

        {/* ---------- right: form column ---------- */}
        <div className="flex w-full flex-col self-stretch lg:w-[360px] lg:shrink-0">
          <p className="pt-3 text-right text-[13px] text-ink-2">
            Need access?{" "}
            <span className="font-semibold text-ink underline underline-offset-2">Contact your admin</span>
          </p>

          <main className="flex flex-1 flex-col justify-center py-10">
            <div className="mb-12 flex items-baseline justify-center gap-2">
              <h1 className="font-display text-[38px] font-extrabold leading-none tracking-display text-ink">CORE</h1>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
            </div>

            <form onSubmit={handleSubmit}>
              <div className="space-y-5">
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm text-ink">
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
                    className={field}
                  />
                </div>

                <div>
                  <label htmlFor="password" className="mb-1.5 block text-sm text-ink">
                    Password
                  </label>
                  {/* Show/hide toggle sits inside the field. It is a real button
                      so it is reachable by keyboard, and aria-pressed reports
                      the current state. */}
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      disabled={busy}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${field} pr-16`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-pressed={showPassword}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-2 transition-colors duration-100 ease-in hover:text-ink"
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
              </div>

              {/* role=alert so a failure is announced, not merely displayed. */}
              {error && (
                <p role="alert" className="mt-4 rounded-sm bg-danger-50 px-3 py-2 text-[13px] text-danger-500">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || !email || !password}
                className="mt-8 w-full rounded-sm bg-ink py-3.5 text-sm font-semibold text-paper transition duration-100 ease-in hover:brightness-[1.15] active:brightness-[0.95] disabled:pointer-events-none disabled:opacity-40"
              >
                {busy ? "Signing in…" : "Login"}
              </button>
            </form>
          </main>

          <footer className="pb-6 text-[12px] leading-[1.6] text-muted">
            CORE is an internal research system of Arvia Wealth. Access is limited to authorised personnel and all
            activity is logged. Model outputs are for internal research purposes and are not investment advice.
            <span className="mt-2 block">© {new Date().getFullYear()} Arvia Wealth. All rights reserved.</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
