import { Link } from "react-router-dom";
import { Pill } from "../../components/ui/Pill.js";
import { formatRupeesCompact } from "../../lib/backtestFormat.js";
import { CLIENTS } from "../../lib/clients.js";

// The client list. Clients are a demo fixture for now (lib/clients.ts).
export function ClientsView() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">
          Clients
        </p>
        <h1 className="mt-1 font-display text-2xl text-ink">All clients</h1>
        <p className="mt-2 max-w-3xl text-[13px] text-muted">
          Each client sits in a basket; their plan applies the model allocation
          to the amount they invest and picks a fund for every sleeve.
        </p>
      </header>
      <section className="border border-line bg-paper">
        <div className="border-b border-line bg-paper-2 px-5 py-3">
          <h2 className="text-[13px] font-semibold text-ink">
            {CLIENTS.length} clients
          </h2>
        </div>
        <ul className="divide-y divide-line">
          {CLIENTS.map((c) => (
            <li key={c.id}>
              <Link
                to={`/clients/${c.id}`}
                className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 transition-colors duration-100 ease-in hover:bg-paper-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink">{c.name}</p>
                  <p className="text-xs text-muted">{c.basketName} basket</p>
                </div>
                <Pill tone="neutral">Demo</Pill>
                <div className="flex shrink-0 items-center gap-5 text-xs">
                  <span className="text-right">
                    <span className="block text-muted">Net worth</span>
                    <span className="font-semibold tabular-nums text-ink">
                      {formatRupeesCompact(c.netWorth)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-muted">To invest</span>
                    <span className="font-semibold tabular-nums text-ink">
                      {formatRupeesCompact(c.investable)}
                    </span>
                  </span>
                </div>
                <span className="border border-ink px-2.5 py-1 text-[11px] font-semibold text-ink">
                  View plan
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
