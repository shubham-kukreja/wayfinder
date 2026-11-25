import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { segmentColor } from "../../components/AllocationBar.js";
import { AumChart } from "../../components/clients/AumChart.js";
import { TabRow } from "../../components/ui/TabRow.js";
import { useBook } from "../../hooks/useBook.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";
import type { Range } from "../../lib/aum.js";
import { formatRupees, formatRupeesCompact } from "../../lib/backtestFormat.js";
import { assetClassOf, clientById, resetOrders } from "../../lib/clients.js";
import { formatPct, formatSignedPct } from "../../lib/format.js";
import { shortFundName } from "./ClientsView.js";

// A client: AUM and gain, value over time, holdings, and the activity that
// built them — with "Invest more" as the action that matters.

type Tab = "overview" | "holdings" | "activity";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "holdings", label: "Holdings" },
  { id: "activity", label: "Activity" },
];
const CLASSES = [
  { id: "equity", label: "Equity" },
  { id: "debt", label: "Debt" },
  { id: "metals", label: "Precious Metals" },
] as const;

const fmtDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function ClientView() {
  const { id } = useParams();
  const client = clientById(id);
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<Range>("MAX");
  const [version, setVersion] = useState(0);
  const one = useMemo(() => (client ? [client] : []), [client]);
  const book = useBook(one, range, version);
  const { allocation } = useCoreAllocation();
  const me = book.clients[0];

  // Holdings at the latest NAV, with each fund's gain since bought.
  const holdings = useMemo(() => {
    if (!me || book.points.length === 0) return [];
    return book.holdings.map((h) => ({ ...h, gain: h.value - h.invested }));
  }, [me, book.holdings, book.points.length]);

  if (!client) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-8 text-sm text-muted">
        No such client. <Link to="/clients" className="font-semibold text-ink underline">Clients</Link>
      </div>
    );
  }
  const value = me?.value ?? 0;
  const invested = me?.invested ?? 0;
  const gain = value - invested;
  const byClass = CLASSES.map((c) => {
    const v = holdings.filter((h) => assetClassOf(h.sleeve) === c.id).reduce((s, h) => s + h.value, 0);
    const model = allocation?.groups.l1.nodes[`l1.${c.id}`]?.final ?? null;
    return { ...c, value: v, share: value > 0 ? v / value : 0, model };
  });
  const placed = me?.orders.some((o) => !o.seed) ?? false;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <nav className="text-[13px] text-muted" aria-label="Breadcrumb">
        <Link to="/clients" className="hover:text-ink">
          Clients
        </Link>
        <span className="px-2">/</span>
        <span className="text-ink">{client.name}</span>
      </nav>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div>
          <span className="inline-block bg-lilac px-2 py-0.5 text-[11px] font-bold text-ink">{client.basketName} basket</span>
          <h1 className="mt-2 font-display text-[28px] leading-tight text-ink">{client.name}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {client.city} · client since {fmtDay(client.since)} · net worth {formatRupeesCompact(client.netWorth)}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <dt className="text-[12px] text-muted">AUM</dt>
            <dd className="mt-1 text-[22px] font-semibold tabular-nums text-ink">{book.loading ? "…" : formatRupees(Math.round(value))}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Total gain</dt>
            <dd className={`mt-1 text-[22px] font-semibold tabular-nums ${gain >= 0 ? "text-brand-800" : "text-danger-500"}`}>
              {book.loading ? "…" : `${gain >= 0 ? "+" : "−"}${formatRupees(Math.abs(Math.round(gain)))}`}
              {invested > 0 && !book.loading && <span className="ml-2 text-[14px]">{formatSignedPct(gain / invested, 2)}</span>}
            </dd>
          </div>
        </dl>
      </header>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-line">
        <TabRow options={TABS} value={tab} onChange={setTab} className="border-b-0" />
        <div className="flex items-center gap-2 pb-2.5">
          <Link
            to={`/clients/${client.id}/invest`}
            className="inline-flex items-center rounded-md bg-ink px-5 py-2.5 text-[14px] font-semibold text-paper transition duration-100 ease-in hover:-translate-y-px hover:brightness-[1.06]"
          >
            Invest more
          </Link>
        </div>
      </div>

      {book.error && <p className="mt-4 text-[13px] text-danger-500">Failed to load NAVs: {book.error}</p>}

      {tab === "overview" && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="overflow-hidden border border-line bg-paper">
            <div className="flex items-baseline justify-between px-5 pb-2 pt-4">
              <h2 className="text-[15px] font-semibold text-ink">Value over time</h2>
              {book.change.pct != null && (
                <span className={`text-[13px] font-semibold tabular-nums ${book.change.pct >= 0 ? "text-brand-800" : "text-danger-500"}`}>
                  {formatSignedPct(book.change.pct, 2)} {range === "MAX" ? "since first investment" : `over ${range}`}
                </span>
              )}
            </div>
            <AumChart points={book.points} range={range} onRange={setRange} loading={book.loading} />
          </section>
          <aside className="space-y-6">
            <section className="border border-line bg-paper px-5 py-4">
              <h2 className="text-[15px] font-semibold text-ink">Asset mix vs model</h2>
              <ul className="mt-3 space-y-3">
                {byClass.map((c) => (
                  <li key={c.id}>
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span className="flex items-center gap-2 font-semibold text-ink-2">
                        <span className="h-2.5 w-2.5" style={{ backgroundColor: segmentColor(`l1.${c.id}`, allocation ?? undefined) }} aria-hidden="true" />
                        {c.label}
                      </span>
                      <span className="tabular-nums text-ink">
                        {formatPct(c.share, 1)}
                        {c.model != null && <span className="text-muted"> · model {formatPct(c.model, 1)}</span>}
                      </span>
                    </div>
                    <div className="relative mt-1.5 h-1.5 bg-paper-2">
                      <div className="h-full" style={{ width: `${c.share * 100}%`, backgroundColor: segmentColor(`l1.${c.id}`, allocation ?? undefined) }} />
                      {c.model != null && <span className="absolute -top-1 h-3.5 w-0.5 bg-ink" style={{ left: `${c.model * 100}%` }} title="Model weight" />}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[12px] text-muted">Investing more follows the model, which moves the mix toward it.</p>
            </section>
            <section className="border border-line bg-paper">
              <div className="flex items-center justify-between px-5 pb-2 pt-4">
                <h2 className="text-[15px] font-semibold text-ink">Top holdings</h2>
                <button type="button" onClick={() => setTab("holdings")} className="text-[12px] font-semibold text-muted hover:text-ink">
                  All {holdings.length} ›
                </button>
              </div>
              <ul className="divide-y divide-line border-t border-line">
                {holdings.slice(0, 5).map((h) => (
                  <li key={h.schemeCode} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0 truncate text-[13px] text-ink" title={h.schemeName}>
                      {shortFundName(h.schemeName)}
                    </span>
                    <span className="shrink-0 text-right text-[13px] tabular-nums text-ink">{formatRupeesCompact(h.value)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      )}

      {tab === "holdings" && (
        <section className="mt-6 overflow-x-auto border border-line bg-paper">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-muted">
                <th className="px-5 py-2.5 font-normal">Fund</th>
                <th className="px-3 py-2.5 text-right font-normal">Invested</th>
                <th className="px-3 py-2.5 text-right font-normal">Value</th>
                <th className="px-3 py-2.5 text-right font-normal">Gain</th>
                <th className="px-5 py-2.5 text-right font-normal">Share</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.schemeCode} className="border-b border-line last:border-0">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: segmentColor(h.sleeve, allocation ?? undefined) }} aria-hidden="true" />
                      <span>
                        <span className="block font-semibold text-ink">{h.schemeName}</span>
                        <span className="text-[12px] text-muted">{h.label}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-2">{formatRupees(Math.round(h.invested))}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">{formatRupees(Math.round(h.value))}</td>
                  <td className={`px-3 py-3 text-right tabular-nums ${h.gain >= 0 ? "text-brand-800" : "text-danger-500"}`}>
                    {formatSignedPct(h.invested > 0 ? h.gain / h.invested : 0, 1)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted">{formatPct(value > 0 ? h.value / value : 0, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "activity" && (
        <section className="mt-6 border border-line bg-paper">
          <ul className="divide-y divide-line">
            {(me?.orders ?? []).map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3.5">
                <span className="w-28 text-[13px] text-ink-2">{fmtDay(o.date)}</span>
                <span className="flex-1 text-[13px] text-muted">Invested across {o.lines.length} funds, following the model</span>
                <span className="text-[14px] font-semibold tabular-nums text-ink">{formatRupees(o.amount)}</span>
              </li>
            ))}
          </ul>
          {placed && (
            <div className="border-t border-line px-5 py-3 text-right">
              <button
                type="button"
                onClick={() => {
                  resetOrders(client.id);
                  setVersion((v) => v + 1);
                }}
                className="text-[12px] font-semibold text-muted hover:text-ink"
              >
                Undo investments placed here
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
