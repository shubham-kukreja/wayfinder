import { useState, type FormEvent } from "react";
import { login } from "../lib/auth.js";

// Split sign-in: guilloche artwork on the left, the form on the right.
//
// Below lg the panel is dropped entirely rather than stacked: on a phone it
// would push the form below the fold for purely decorative content.
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
    <div className="flex min-h-screen bg-paper">
      {/* ---------- left: artwork ---------- */}
      {/* Guilloche rosette on a deep green ground — the engraved line-work of a
          share certificate, which is Arvia's own visual language. Generated as
          vector rather than cropped from the site's banknote photograph: that
          image is landscape, and squeezing it into a tall panel stretched the
          engraving badly. This stays sharp at any panel size and costs 20KB
          instead of 7.7MB. */}
      <div className="relative hidden w-1/2 shrink-0 overflow-hidden bg-[#0B1A10] lg:block">
        {/* Anchored so its centre sits on the panel's top-left corner: only the
            lower-right quadrant of the rosette is on screen, reading as a
            detail the frame happens to crop rather than a motif centred in the
            panel. Oversized so that quarter still fills the corner. */}
        <img
          src="/guilloche.svg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 h-[150%] w-[150%] -translate-x-1/2 -translate-y-1/2 select-none"
        />
        {/* Fades the pattern out toward the bottom-right so it never competes
            with the headline sitting there. */}
        <div
          className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,transparent_20%,rgba(11,26,16,0.85)_70%)]"
          aria-hidden="true"
        />

        <div className="relative flex h-full flex-col justify-between p-12">
          <img
            src="/logo-arvia-dark.svg"
            alt="Arvia Wealth"
            className="h-10 w-auto self-start brightness-0 invert"
          />

          <div>
            <p className="font-display text-[40px] font-bold leading-[1.12] tracking-display text-white">
              Make wealth work
              <br />
              alongside you.
            </p>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/60">
              CORE is Arvia Wealth&rsquo;s internal research system for capital allocation: signals,
              scoring and model versions in one place.
            </p>
          </div>
        </div>
      </div>

      {/* ---------- right: form ---------- */}
      <div className="flex w-full flex-col lg:w-1/2">
        {/* On small screens the artwork is gone, so the logo moves here to keep
            the brand present. */}
        <header className="px-8 pt-8 lg:hidden">
          <img src="/logo-arvia.svg" alt="Arvia Wealth" className="h-8 w-auto" />
        </header>

        <main className="flex flex-1 items-center justify-center px-8 py-12 lg:px-16">
          <div className="w-full max-w-[360px]">
            <div className="mb-8">
              <div className="flex items-baseline gap-2">
                <h1 className="font-display text-[40px] font-extrabold leading-display tracking-display text-ink">
                  CORE
                </h1>
                <span
                  className="h-1.5 w-1.5 shrink-0 translate-y-[-5px] rounded-full bg-brand-500"
                  aria-hidden="true"
                />
              </div>
              <p className="mt-2 text-sm text-muted">Sign in to continue.</p>
            </div>

            <form onSubmit={handleSubmit}>
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

              {/* role=alert so a failure is announced, not merely displayed. */}
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

            <p className="mt-8 text-[12px] leading-relaxed text-muted">
              Access is limited to authorised Arvia Wealth personnel.
            </p>
          </div>
        </main>

        <footer className="px-8 pb-8 text-[11px] text-muted lg:text-right">
          © {new Date().getFullYear()} Arvia Wealth. All rights reserved.
        </footer>
      </div>
    </div>
  );
}
