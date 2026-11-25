import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { segmentColor } from "../../components/AllocationBar.js";
import { Pill } from "../../components/ui/Pill.js";
import { SegmentedBar } from "../../components/ui/SegmentedBar.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";
import { formatRupees, formatRupeesCompact } from "../../lib/backtestFormat.js";
import { assetClassOf, clientById, holdingsOf, loadOrders, resetOrders } from "../../lib/clients.js";
import { formatPct } from "../../lib/format.js";

// A client: who they are, the one action that matters (invest more,
// following the model), what they hold with us and what was invested when.

const CLASS_LABEL = { equity: "Equity", debt: "Debt", metals: "Precious Metals" } as const;

const formatDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function ClientView() {
  const { id } = useParams();
  const client = clientById(id);
  const { allocation } = useCoreAllocation();
  const [version, setVersion] = useState(0); // bumps after clearing demo orders
  const orders = useMemo(() => (client ? loadOrders(client.id) : []), [client, version]);
  const holdings = useMemo(() => holdingsOf(orders), [orders]);
  const invested = holdings.reduce((s, h) => s + h.invested, 0);

  if (!client) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-6 py-8 text-sm text-muted">
        No such client. <Link to="/clients" className="font-semibold text-ink underline">All clients</Link>
      </div>
    );
  }
  const first = client.name.split(" ")[0];
  const color = (sleeve: string) => segmentColor(sleeve, allocation ?? undefined);
  const byClass = (["equity", "debt", "metals"] as const)
    .map((k) => ({ id: k, label: CLASS_LABEL[k], amount: holdings.filter((h) => assetClassOf(h.sleeve) === k).reduce((s, h) => s + h.invested, 0) }))
    .filter((c) => c.amount > 0);
  const hasPlaced = orders.some((o) => !o.seed);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8">
      <Link to="/clients" className="text-[13px] text-muted hover:text-ink">
        ← All clients
      </Link>

      {/* Who, and the one thing to do next. */}
      <section className="mt-3 flex flex-wrap items-center justify-between gap-6 border border-line bg-paper px-6 py-6">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center bg-ink font-display text-lg text-paper" aria-hidden="true">
            {client.name
              .split(" ")
              .map((p) => p[0])
              .join("")}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl text-ink">{client.name}</h1>
              <Pill tone="neutral">Demo</Pill>
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {client.basketName} basket · client since {formatDay(client.since)}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <Link
            to={`/clients/${client.id}/invest`}
            className="inline-flex items-center gap-2 rounded-md bg-ink px-6 py-3 text-[15px] font-semibold text-paper transition duration-100 ease-in hover:-translate-y-px hover:brightness-[1.06] active:translate-y-0"
          >
            Invest for {first} →
          </Link>
          <span className="text-[12px] text-muted">Split by the model into the best-ranked funds</span>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-2 border border-line sm:grid-cols-4 sm:divide-x sm:divide-line">
        <Stat label="Net worth" value={formatRupeesCompact(client.netWorth)} />
        <Stat label="Invested with us" value={formatRupeesCompact(invested)} />
        <Stat label="Share of net worth" value={client.netWorth > 0 ? formatPct(invested / client.netWorth, 0) : "–"} />
        <Stat label="Last investment" value={orders[0] ? formatDay(orders[0].date) : "–"} />
      </div>

      {holdings.length === 0 ? (
        <section className="mt-6 border border-line bg-paper px-6 py-12 text-center">
          <p className="text-[15px] font-semibold text-ink">{first} has no investments yet.</p>
          <p className="mt-1 text-[13px] text-muted">Start with an amount; the model picks the funds.</p>
          <Link
            to={`/clients/${client.id}/invest`}
            className="mt-5 inline-flex items-center rounded-md bg-ink px-[22px] py-[11px] text-sm font-semibold text-paper transition duration-100 ease-in hover:-translate-y-px hover:brightness-[1.06]"
          >
            Make the first investment →
          </Link>
        </section>
      ) : (
        <>
          <section className="mt-6 border border-line bg-paper">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper-2 px-5 py-3">
              <h2 className="text-[13px] font-semibold text-ink">Holdings · {holdings.length} funds</h2>
              <div className="flex flex-wrap items-center gap-4 text-[12px]">
                {byClass.map((c) => (
                  <span key={c.id} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5" style={{ backgroundColor: color(`l1.${c.id}`) }} />
                    <span className="font-semibold text-ink-2">{c.label}</span>
                    <span className="tabular-nums text-muted">{formatPct(c.amount / invested, 0)}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="px-5 pt-4">
              <SegmentedBar
                segments={holdings.map((h) => ({ id: h.schemeCode, label: h.schemeName, weight: h.invested / invested, color: color(h.sleeve) }))}
                legend={false}
              />
            </div>
            <ul className="divide-y divide-line">
              {holdings.map((h) => (
                <li key={h.schemeCode} className="flex items-center gap-4 px-5 py-3">
                  <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: color(h.sleeve) }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-ink">{h.schemeName}</p>
                    <p className="text-[12px] text-muted">{h.label}</p>
                  </div>
                  <span className="w-14 text-right text-[12px] tabular-nums text-muted">{formatPct(h.invested / invested, 1)}</span>
                  <span className="w-28 text-right text-[14px] font-semibold tabular-nums text-ink">{formatRupees(h.invested)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6 border border-line bg-paper">
            <div className="flex items-center justify-between border-b border-line bg-paper-2 px-5 py-3">
              <h2 className="text-[13px] font-semibold text-ink">Investments</h2>
              {hasPlaced && (
                <button
                  type="button"
                  onClick={() => {
                    resetOrders(client.id);
                    setVersion((v) => v + 1);
                  }}
                  className="text-[12px] font-semibold text-muted hover:text-ink"
                >
                  Clear demo orders
                </button>
              )}
            </div>
            <ul className="divide-y divide-line">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3">
                  <span className="w-28 text-[13px] text-ink-2">{formatDay(o.date)}</span>
                  <span className="flex-1 text-[13px] text-muted">
                    {o.lines.length} funds{o.seed ? " · opening investment" : " · following the model"}
                  </span>
                  <span className="text-[14px] font-semibold tabular-nums text-ink">{formatRupees(o.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line px-5 py-4 [&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-t-0">
      <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl tabular-nums text-ink">{value}</p>
    </div>
  );
}
