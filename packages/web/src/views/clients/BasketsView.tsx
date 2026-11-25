import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SleeveAllocation, type SleeveFilter } from "../../components/SleeveAllocation.js";
import { AllocationBar, type AllocationDepth } from "../../components/AllocationBar.js";
import { Breadcrumb } from "../../components/clients/ui.js";
import { TabRow } from "../../components/ui/TabRow.js";

const DEPTH_OPTIONS: ReadonlyArray<{ id: AllocationDepth; label: string }> = [
  { id: "overview", label: "Asset classes" },
  { id: "detail", label: "Sleeves" },
];
import { Pill } from "../../components/ui/Pill.js";
import { useBook } from "../../hooks/useBook.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";
import { formatRupees } from "../../lib/backtestFormat.js";
import { BASKETS, basketById, type Basket } from "../../lib/baskets.js";
import { CLIENTS } from "../../lib/clients.js";

// Baskets: the client archetypes the model portfolios are designed for.

const clientsIn = (b: Basket) => CLIENTS.filter((c) => c.basket === b.id);

export function BasketsView() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto w-full max-w-[1440px] px-8 py-8">
      <nav className="text-[13px] text-muted" aria-label="Breadcrumb">
        <Link to="/clients" className="hover:text-ink">
          Clients
        </Link>
        <span className="px-2">/</span>
        <span className="text-ink">Baskets</span>
      </nav>
      <h1 className="mt-4 font-display text-[28px] leading-tight text-ink">Baskets</h1>
      <p className="mt-1 max-w-3xl text-[13px] text-muted">
        Each basket is a client archetype, defined by time horizon, risk capacity, primary goal and liquidity needs. It answers who a model portfolio is for.
      </p>
      <section className="mt-6 overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-muted">
              <th className="px-5 py-2.5 font-normal">Basket</th>
              <th className="px-3 py-2.5 font-normal">Time horizon</th>
              <th className="px-3 py-2.5 font-normal">Risk capacity</th>
              <th className="px-3 py-2.5 font-normal">Primary goal</th>
              <th className="px-3 py-2.5 font-normal">Liquidity needs</th>
              <th className="px-5 py-2.5 text-right font-normal">Clients</th>
            </tr>
          </thead>
          <tbody>
            {BASKETS.map((b) => (
              <tr
                key={b.id}
                onClick={() => navigate(`/baskets/${b.id}`)}
                onKeyDown={(e) => e.key === "Enter" && navigate(`/baskets/${b.id}`)}
                tabIndex={0}
                className="cursor-pointer border-b border-line align-top last:border-0 hover:bg-paper-2 focus:bg-paper-2 focus:outline-none"
              >
                <td className="px-5 py-3.5">
                  <span className="block font-semibold text-ink">
                    {b.code} · {b.name}
                  </span>
                  {b.profile ? (
                    <span className="text-[12px] text-muted">Balanced model for now</span>
                  ) : (
                    <span className="text-[12px] text-muted">Model portfolio not set up yet</span>
                  )}
                </td>
                <td className="px-3 py-3.5 text-ink-2">{b.horizon}</td>
                <td className="px-3 py-3.5 text-ink-2">{b.riskCapacity}</td>
                <td className="max-w-[280px] px-3 py-3.5 text-ink-2">{b.goal}</td>
                <td className="px-3 py-3.5 text-ink-2">{b.liquidity}</td>
                <td className="px-5 py-3.5 text-right tabular-nums text-ink">{clientsIn(b).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// Where an archetype sits on each dimension, 0 (left) to 1 (right).
const HORIZON: Record<string, number> = { short: 0.12, "medium (3": 0.42, "medium (5": 0.5, "medium–long": 0.66, long: 0.9 };
const RISK: Record<string, number> = { low: 0.12, limited: 0.3, medium: 0.5, balanced: 0.66, high: 0.9 };
const LIQUIDITY: Record<string, number> = { "low–medium": 0.3, low: 0.12, "medium–high": 0.7, medium: 0.5, high: 0.9 };
function place(map: Record<string, number>, text: string): number {
  const t = text.toLowerCase();
  const key = Object.keys(map).find((k) => t.startsWith(k));
  return key ? map[key]! : 0.5;
}

export function BasketView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const basket = basketById(id);
  const [filter, setFilter] = useState<SleeveFilter>("all");
  const [depth, setDepth] = useState<AllocationDepth>("overview");
  const members = basket ? clientsIn(basket) : [];
  const book = useBook(members, "MAX");
  const { allocation, data } = useCoreAllocation();

  if (!basket) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-8 py-8 text-sm text-muted">
        No such basket. <Link to="/baskets" className="font-semibold text-ink underline">Baskets</Link>
      </div>
    );
  }
  const others = BASKETS.filter((b) => b.id !== basket.id);
  return (
    <div className="mx-auto w-full max-w-[1440px] px-8 py-8">
      <Breadcrumb items={[{ label: "Clients", to: "/clients" }, { label: "Baskets", to: "/baskets" }, { label: basket.code }]} />

      <header className="mt-4 max-w-3xl">
        <span className="inline-block rounded-md bg-lilac px-2 py-0.5 text-[12px] font-semibold text-ink">{basket.code}</span>
        <h1 className="mt-2 font-display text-[28px] leading-tight text-ink">{basket.name}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-ink-2">{basket.who}</p>
      </header>

      <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-line bg-paper px-6 py-5">
            <h2 className="text-[15px] font-semibold text-ink">Profile</h2>
            <div className="mt-4 grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">
              <Scale label="Time horizon" value={basket.horizon} at={place(HORIZON, basket.horizon)} left="Under 3 years" right="10+ years" />
              <Scale label="Risk capacity" value={basket.riskCapacity} at={place(RISK, basket.riskCapacity)} left="Low" right="High" />
              <Scale label="Liquidity needs" value={basket.liquidity} at={place(LIQUIDITY, basket.liquidity)} left="Lock-in fine" right="Needs access" />
              <div>
                <p className="text-[13px] text-muted">Primary goal</p>
                <p className="mt-1 text-[15px] text-ink">{basket.goal}</p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-line bg-paper px-6 py-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-ink">Model portfolio</h2>
              <p className="text-[13px] text-muted">
                Balanced model for now · {data?.version.kind === "draft" ? "shared draft" : "published"}
                {data ? `, ${new Date(`${data.version.as_of}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}
              </p>
            </div>
            {allocation ? (
              <div className="mt-4">
                <TabRow options={DEPTH_OPTIONS} value={depth} onChange={setDepth} className="mb-5" />
                <AllocationBar allocation={allocation} depth={depth} />
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-muted">Loading the model allocation…</p>
            )}
          </section>

          {allocation && <SleeveAllocation allocation={allocation} filter={filter} onFilter={setFilter} />}
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border border-line bg-paper px-5 py-4">
            <p className="text-[13px] text-muted">In this basket</p>
            <p className="mt-1 text-[15px] tabular-nums text-ink">
              {members.length} client{members.length === 1 ? "" : "s"}
              {members.length > 0 && !book.loading && <span className="text-muted"> · {formatRupees(Math.round(book.total))}</span>}
            </p>
            {members.length > 0 && (
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                {members.map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && ", "}
                    <button type="button" onClick={() => navigate(`/clients/${m.id}`)} className="underline decoration-line underline-offset-4 hover:text-ink">
                      {m.name}
                    </button>
                  </span>
                ))}
              </p>
            )}
          </section>
          <section className="overflow-hidden rounded-xl border border-line bg-paper">
            <h2 className="px-5 pb-3 pt-4 text-[15px] font-semibold text-ink">Other archetypes</h2>
            <ul className="divide-y divide-line border-t border-line">
              {others.map((b) => (
                <li key={b.id}>
                  <Link to={`/baskets/${b.id}`} className="block px-5 py-3 transition-colors duration-150 ease-out hover:bg-paper-2">
                    <span className="block text-[13px] text-ink">
                      {b.code} · {b.name}
                    </span>
                    <span className="text-[12px] text-muted">
                      {b.horizon} · {b.riskCapacity} risk
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Scale({ label, value, at, left, right }: { label: string; value: string; at: number; left: string; right: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] text-muted">{label}</p>
        <p className="text-[14px] text-ink">{value}</p>
      </div>
      <div className="relative mt-3 h-1 rounded-full bg-paper-2">
        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper bg-ink shadow-sm" style={{ left: `${at * 100}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

function Def({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line px-5 py-4 [&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-t-0">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 text-[14px] font-semibold text-ink">{value}</p>
    </div>
  );
}
