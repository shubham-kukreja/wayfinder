import { getEmail, logout } from "../../lib/auth.js";
import { GlobalSearch } from "./GlobalSearch.js";

// Global utility bar: a single search field, sticky so it stays reachable
// while a long view scrolls.
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-line bg-paper/95 px-8 py-4 backdrop-blur">
      <GlobalSearch />

      {/* Signed-in identity and the way out. Quiet by design — the account is
          not something the user needs to think about while working. */}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <span className="hidden text-[13px] text-muted lg:inline" title={getEmail() ?? undefined}>
          {getEmail()}
        </span>
        <button
          type="button"
          onClick={() => {
            void logout().then(() => window.location.reload());
          }}
          className="rounded-md px-3 py-1.5 text-[13px] font-semibold text-ink-2 transition duration-100 ease-in hover:bg-paper-2 hover:text-ink"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
