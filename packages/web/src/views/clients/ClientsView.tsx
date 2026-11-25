import { Link } from "react-router-dom";
import { Pill } from "../../components/ui/Pill.js";
import { formatRupeesCompact } from "../../lib/backtestFormat.js";
import { CLIENTS, holdingsOf, loadOrders } from "../../lib/clients.js";

// The client list. Clients are a demo fixture for now (lib/clients.ts).
export function ClientsView() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Clients</p>
        <h1 className="mt-1 font-display text-2xl text-ink">All clients</h1>
        <p className="mt-2 max-w-3xl text-[13px] text-muted">
          Each client sits in a basket. Investing for them splits the amount by the model allocation and picks the best-ranked fund for every sleeve.
        </p>
      </header>
      <section className="border border-line bg-paper">
        <div className="border-b border-line bg-paper-2 px-5 py-3">
          <h2 className="text-[13px] font-semibold text-ink">{CLIENTS.length} clients</h2>
        </div>
        <ul className="divide-y divide-line">
          {CLIENTS.map((c) => {
            const invested = holdingsOf(loadOrders(c.id)).reduce((s, h) => s + h.invested, 0);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5">
                <Link to={`/clients/${c.id}`} className="min-w-0 flex-1 hover:underline">
                  <p className="text-[14px] font-semibold text-ink">{c.name}</p>
                  <p className="text-xs text-muted">{c.basketName} basket</p>
                </Link>
                <Pill tone="neutral">Demo</Pill>
                <div className="flex shrink-0 items-center gap-5 text-xs">
                  <span className="text-right">
                    <span className="block text-muted">Net worth</span>
                    <span className="font-semibold tabular-nums text-ink">{formatRupeesCompact(c.netWorth)}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-muted">Invested with us</span>
                    <span className="font-semibold tabular-nums text-ink">{invested > 0 ? formatRupeesCompact(invested) : "–"}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/clients/${c.id}`} className="border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2">
                    Open
                  </Link>
                  <Link to={`/clients/${c.id}/invest`} className="border border-ink bg-ink px-2.5 py-1 text-[11px] font-semibold text-paper">
                    Invest
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
