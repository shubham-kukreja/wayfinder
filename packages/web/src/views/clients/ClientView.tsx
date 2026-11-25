import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { segmentColor } from "../../components/AllocationBar.js";
import { AumChart } from "../../components/clients/AumChart.js";
import {
  Breadcrumb,
  primaryClass,
  secondaryClass,
  Segmented,
} from "../../components/clients/ui.js";
import { TabRow } from "../../components/ui/TabRow.js";
import { useBook } from "../../hooks/useBook.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";
import { cagr, xirr, type Range } from "../../lib/aum.js";
import { formatRupees, formatRupeesCompact } from "../../lib/backtestFormat.js";
import { basketById } from "../../lib/baskets.js";
import { assetClassOf, clientById, resetOrders } from "../../lib/clients.js";
import { formatPct, formatSignedPct } from "../../lib/format.js";
import { shortFundName } from "./ClientsView.js";
import { ClientHarvest, ClientPnl } from "./ClientTax.js";
import { PlusIcon, RebalanceIcon } from "../../components/clients/icons.js";

// A client: value and returns over a chosen period, value over time, mix
// against the model, holdings and activity, with Invest more and Rebalance
// as the two actions.

type Tab = "overview" | "holdings" | "pnl" | "tax" | "activity";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "holdings", label: "Holdings" },
  { id: "pnl", label: "P&L" },
  { id: "tax", label: "Tax harvesting" },
  { id: "activity", label: "Activity" },
];
const PERIODS = ["1D", "1W", "1M", "1Y", "5Y", "All"] as const;
type Period = (typeof PERIODS)[number];
const toRange = (p: Period): Range => (p === "All" ? "MAX" : p);
const CLASSES = [
  { id: "equity", label: "Equity" },
  { id: "debt", label: "Debt" },
  { id: "metals", label: "Precious Metals" },
] as const;

const fmtDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const signedRupees = (v: number) =>
  `${v >= 0 ? "+" : "−"}${formatRupees(Math.abs(Math.round(v)))}`;
const tone = (v: number | null) =>
  v == null ? "text-ink" : v >= 0 ? "text-brand-800" : "text-danger-500";

export function ClientView() {
  const { id } = useParams();
  const client = clientById(id);
  const basket = basketById(client?.basket);
  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<Period>("1Y");
  const [version, setVersion] = useState(0);
  const one = useMemo(() => (client ? [client] : []), [client]);
  const book = useBook(one, toRange(period), version);
  const { allocation } = useCoreAllocation();
  const me = book.clients[0];

  const holdings = useMemo(
    () =>
      book.holdings
        .filter((h) => h.value > 0.5)
        .map((h) => ({ ...h, gain: h.value - h.invested })),
    [book.holdings],
  );
  const periodXirr = useMemo(() => xirr(book.points), [book.points]);
  const periodCagr = useMemo(() => cagr(book.points), [book.points]);

  if (!client) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-8 py-8 text-sm text-muted">
        No such client.{" "}
        <Link to="/clients" className="font-semibold text-ink underline">
          Clients
        </Link>
      </div>
    );
  }
  const value = me?.value ?? 0;
  const invested = me?.invested ?? 0;
  const gain = value - invested;
  const byClass = CLASSES.map((c) => {
    const v = holdings
      .filter((h) => assetClassOf(h.sleeve) === c.id)
      .reduce((s, h) => s + h.value, 0);
    const model = allocation?.groups.l1.nodes[`l1.${c.id}`]?.final ?? null;
    return { ...c, value: v, share: value > 0 ? v / value : 0, model };
  });
  const placed = me?.orders.some((o) => !o.seed) ?? false;
  const periodLabel =
    period === "All" ? "since first investment" : `over ${period}`;
  const annualNote = "Annualised, from 1 year";

  return (
    <div className="mx-auto w-full max-w-[1440px] px-8 py-8">
      <Breadcrumb
        items={[{ label: "Clients", to: "/clients" }, { label: client.name }]}
      />

      <header className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div>
          {basket && (
            <Link
              to={`/baskets/${basket.id}`}
              className="inline-block rounded-md bg-lilac px-2 py-0.5 text-[12px] font-semibold text-ink transition-colors duration-150 ease-out hover:bg-lilac/70"
            >
              {basket.code} · {basket.name}
            </Link>
          )}
          <h1 className="mt-2 font-display text-[28px] leading-tight text-ink">
            {client.name}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {client.city} · client since {fmtDay(client.since)} · net worth{" "}
            {formatRupeesCompact(client.netWorth)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/clients/${client.id}/rebalance`} className={`${secondaryClass} gap-2`}>
            <RebalanceIcon />
            Rebalance
          </Link>
          <Link to={`/clients/${client.id}/invest`} className={`${primaryClass} gap-2`}>
            <PlusIcon />
            Invest more
          </Link>
        </div>
      </header>

      <div className="mt-6 border-b border-line">
        <TabRow
          options={TABS}
          value={tab}
          onChange={setTab}
          className="border-b-0"
        />
      </div>

      {book.error && (
        <p className="mt-4 text-[13px] text-danger-500">
          Failed to load NAVs: {book.error}
        </p>
      )}

      {tab === "overview" && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-[15px] font-semibold text-ink">Performance</h2>
            <Segmented
              options={PERIODS}
              value={period}
              onChange={setPeriod}
              label="Period"
            />
          </div>
          <dl className="mt-3 grid grid-cols-2 rounded-xl border border-line sm:grid-cols-5 sm:divide-x sm:divide-line">
            <Stat
              label="Value"
              value={book.loading ? "…" : formatRupees(Math.round(value))}
              note={`${formatRupees(Math.round(invested))} invested`}
            />
            <Stat
              label="Total gain"
              value={book.loading ? "…" : signedRupees(gain)}
              note={
                invested > 0
                  ? `${formatSignedPct(gain / invested, 2)} on money invested`
                  : ""
              }
              className={tone(gain)}
            />
            <Stat
              label={`Change ${periodLabel}`}
              value={
                book.change.pct == null
                  ? "–"
                  : formatSignedPct(book.change.pct, 2)
              }
              note={
                book.change.pct == null
                  ? "No history in this period"
                  : `${signedRupees(book.change.amount)}, new money excluded`
              }
              className={tone(book.change.pct)}
            />
            <Stat
              label="XIRR"
              value={periodXirr == null ? "–" : formatSignedPct(periodXirr, 2)}
              note={
                periodXirr == null
                  ? annualNote
                  : `Money-weighted, ${periodLabel}`
              }
              className={tone(periodXirr)}
            />
            <Stat
              label="CAGR"
              value={periodCagr == null ? "–" : formatSignedPct(periodCagr, 2)}
              note={
                periodCagr == null
                  ? annualNote
                  : `Time-weighted, ${periodLabel}`
              }
              className={tone(periodCagr)}
            />
          </dl>

          <section className="mt-6 overflow-hidden rounded-xl border border-line bg-paper">
            <h2 className="px-5 pb-3 pt-4 text-[15px] font-semibold text-ink">
              Value over time
            </h2>
            <AumChart
              points={book.points}
              range={toRange(period)}
              loading={book.loading}
            />
          </section>
          <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-line bg-paper px-5 py-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold text-ink">
                  Mix vs model
                </h2>
                <Link
                  to={`/clients/${client.id}/rebalance`}
                  className="text-[13px] text-muted underline decoration-line underline-offset-4 transition-colors duration-150 ease-out hover:text-ink"
                >
                  Rebalance
                </Link>
              </div>
              <ul className="mt-4 space-y-4">
                {byClass.map((c) => (
                  <li key={c.id}>
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span className="flex items-center gap-2 text-ink-2">
                        <span
                          className="h-2.5 w-2.5"
                          style={{
                            backgroundColor: segmentColor(
                              `l1.${c.id}`,
                              allocation ?? undefined,
                            ),
                          }}
                          aria-hidden="true"
                        />
                        {c.label}
                      </span>
                      <span className="tabular-nums text-ink">
                        {formatPct(c.share, 1)}
                        {c.model != null && (
                          <span className="text-muted">
                            {" "}
                            · model {formatPct(c.model, 1)}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="relative mt-2 h-1.5 rounded-full bg-paper-2">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${c.share * 100}%`,
                          backgroundColor: segmentColor(
                            `l1.${c.id}`,
                            allocation ?? undefined,
                          ),
                        }}
                      />
                      {c.model != null && (
                        <span
                          className="absolute -top-1 h-3.5 w-0.5 bg-ink"
                          style={{ left: `${c.model * 100}%` }}
                          title="Model weight"
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-xl border border-line bg-paper">
              <div className="flex items-baseline justify-between px-5 pb-3 pt-4">
                <h2 className="text-[15px] font-semibold text-ink">
                  Top holdings
                </h2>
                <button
                  type="button"
                  onClick={() => setTab("holdings")}
                  className="text-[13px] text-muted transition-colors duration-150 ease-out hover:text-ink"
                >
                  All {holdings.length}
                </button>
              </div>
              <ul className="divide-y divide-line border-t border-line">
                {holdings.slice(0, 5).map((h) => (
                  <li
                    key={h.schemeCode}
                    className="flex items-center justify-between gap-3 px-5 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0"
                        style={{
                          backgroundColor: segmentColor(
                            h.sleeve,
                            allocation ?? undefined,
                          ),
                        }}
                        aria-hidden="true"
                      />
                      <span
                        className="truncate text-[13px] text-ink"
                        title={h.schemeName}
                      >
                        {shortFundName(h.schemeName)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] tabular-nums text-ink">
                      {formatRupeesCompact(h.value)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}

      {tab === "pnl" && (
        <ClientPnl
          orders={me?.orders ?? []}
          navs={book.navs}
          asOf={book.asOf}
        />
      )}
      {tab === "tax" && (
        <ClientHarvest
          clientId={client.id}
          orders={me?.orders ?? []}
          navs={book.navs}
          asOf={book.asOf}
          onPlaced={() => setVersion((v) => v + 1)}
        />
      )}

      {tab === "holdings" && (
        <section className="mt-6 overflow-x-auto rounded-xl border border-line bg-paper">
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
                <tr
                  key={h.schemeCode}
                  className="border-b border-line last:border-0"
                >
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0"
                        style={{
                          backgroundColor: segmentColor(
                            h.sleeve,
                            allocation ?? undefined,
                          ),
                        }}
                        aria-hidden="true"
                      />
                      <span>
                        <span className="block text-ink">{h.schemeName}</span>
                        <span className="text-[12px] text-muted">
                          {h.label}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-2">
                    {formatRupees(Math.round(h.invested))}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                    {formatRupees(Math.round(h.value))}
                  </td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums ${tone(h.gain)}`}
                  >
                    {formatSignedPct(
                      h.invested > 0 ? h.gain / h.invested : 0,
                      1,
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted">
                    {formatPct(value > 0 ? h.value / value : 0, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "activity" && (
        <section className="mt-6 rounded-xl border border-line bg-paper">
          <ul className="divide-y divide-line">
            {(me?.orders ?? []).map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3"
              >
                <span className="w-28 text-[13px] tabular-nums text-ink-2">
                  {fmtDay(o.date)}
                </span>
                <span className="flex-1 text-[13px] text-muted">
                  {o.kind === "rebalance"
                    ? `Rebalanced toward the model, ${o.lines.length} trades`
                    : o.kind === "harvest"
                      ? `Booked long-term gains and reinvested, ${o.lines.length / 2} fund${o.lines.length === 2 ? "" : "s"}`
                      : `Invested across ${o.lines.length} funds`}
                </span>
                <span className="text-[14px] font-semibold tabular-nums text-ink">
                  {o.kind === "rebalance" || o.kind === "harvest"
                    ? formatRupees(
                        o.lines
                          .filter((l) => l.amount > 0)
                          .reduce((s, l) => s + l.amount, 0),
                      ) + " moved"
                    : formatRupees(o.amount)}
                </span>
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
                className="text-[13px] text-muted transition-colors duration-150 ease-out hover:text-ink"
              >
                Undo orders placed here
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  className = "text-ink",
}: {
  label: string;
  value: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className="border-line px-5 py-4 [&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-t-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd
        className={`mt-1 text-[22px] font-semibold tabular-nums ${className}`}
      >
        {value}
      </dd>
      {note && <dd className="mt-1 text-[12px] text-muted">{note}</dd>}
    </div>
  );
}
