import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AumChart } from "../../components/clients/AumChart.js";
import { useBook, type ClientBook } from "../../hooks/useBook.js";
import { segmentColor } from "../../components/AllocationBar.js";
import type { Range } from "../../lib/aum.js";
import { formatRupees } from "../../lib/backtestFormat.js";
import { CLIENTS } from "../../lib/clients.js";
import { coreAuth } from "../../lib/coreApi.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";
import { formatSignedPct } from "../../lib/format.js";

// The distributor's home: total AUM and its change, AUM over time, top
// holdings across the book, and every client's account below.

const fmtDay = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "–";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning," : h < 17 ? "Good afternoon," : "Good evening,";
}

/** "HDFC Large Cap Fund - Direct Plan - Growth" → "HDFC Large Cap". */
export function shortFundName(name: string): string {
  return name
    .replace(/\s*[-–(].*$/, "")
    .replace(/\s+Fund(\s+of\s+Funds?)?$/i, "")
    .replace(/\s+FOF$/i, "")
    .trim();
}

type Tab = "all" | "recent" | "largest";

export function ClientsView() {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>("1Y");
  const [tab, setTab] = useState<Tab>("all");
  const [name, setName] = useState<string | null>(null);
  const book = useBook(CLIENTS, range);
  const { allocation } = useCoreAllocation();

  useEffect(() => {
    coreAuth
      .me()
      .then((u) => setName(u.name ?? u.email.split("@")[0] ?? null))
      .catch(() => setName(null));
  }, []);

  const rows = useMemo(() => {
    const list = [...book.clients];
    if (tab === "recent") return list.sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "")).slice(0, 5);
    if (tab === "largest") return list.sort((a, b) => b.value - a.value).slice(0, 5);
    return list.sort((a, b) => b.value - a.value);
  }, [book.clients, tab]);

  const pct = book.change.pct;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <h1 className="font-display text-[28px] leading-tight text-ink">
          {greeting()}
          <br />
          <span className="text-muted">{name ?? " "}</span>
        </h1>
        <dl className="flex flex-wrap items-start gap-x-10 gap-y-3">
          <HeadStat label="Clients" value={String(CLIENTS.length)} />
          <HeadStat label="Total AUM" value={book.loading ? "…" : formatRupees(Math.round(book.total))} title="Current value of every client's holdings, at the latest NAVs" />
          <HeadStat
            label="Total Change"
            value={pct == null ? "–" : formatSignedPct(pct, 2)}
            tone={pct == null ? undefined : pct >= 0 ? "up" : "down"}
            title={`Growth over ${range === "MAX" ? "all time" : range}, excluding new money (${formatRupees(Math.round(book.change.amount))})`}
          />
        </dl>
      </header>

      {book.error && <p className="mt-4 text-[13px] text-danger-500">Failed to load NAVs: {book.error}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <section className="overflow-hidden border border-line bg-paper">
            <AumChart points={book.points} range={range} onRange={setRange} loading={book.loading} />
          </section>

          <section className="border border-line bg-paper">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
              <h2 className="text-lg font-semibold text-ink">Accounts</h2>
              <div className="flex items-center divide-x divide-line text-[13px]">
                {(
                  [
                    ["all", `All (${CLIENTS.length})`],
                    ["recent", "Recently active"],
                    ["largest", "Largest"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    aria-pressed={tab === id}
                    className={`px-4 first:pl-0 last:pr-0 ${tab === id ? "font-semibold text-ink" : "text-muted hover:text-ink"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-y border-line text-left text-[12px] text-muted">
                    <th className="px-5 py-2.5 font-normal">Client</th>
                    <th className="px-3 py-2.5 font-normal">Basket</th>
                    <th className="px-3 py-2.5 font-normal">Client since</th>
                    <th className="px-3 py-2.5 font-normal">Last activity</th>
                    <th className="px-5 py-2.5 text-right font-normal">AUM</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <AccountRow key={b.client.id} book={b} onOpen={() => navigate(`/clients/${b.client.id}`)} />
                  ))}
                  {book.loading && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-muted">
                        Loading accounts…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="border border-line bg-paper lg:self-start">
          <h2 className="px-5 pb-3 pt-5 text-lg font-semibold text-ink">Top Holdings</h2>
          <ul className="divide-y divide-line border-t border-line">
            {book.holdings.slice(0, 10).map((h) => (
              <li key={h.schemeCode} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: segmentColor(h.sleeve, allocation ?? undefined) }} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate bg-paper-2 px-2 py-1 text-[12px] font-semibold text-ink" title={h.schemeName}>
                      {shortFundName(h.schemeName)}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[13px] tabular-nums text-ink">{formatRupees(Math.round(h.value))}</span>
                  {h.navChange != null && (
                    <span className={`block text-[12px] tabular-nums ${h.navChange >= 0 ? "text-brand-800" : "text-danger-500"}`}>
                      {formatSignedPct(h.navChange, 2)}
                    </span>
                  )}
                </span>
              </li>
            ))}
            {book.loading && <li className="px-5 py-6 text-[13px] text-muted">Loading holdings…</li>}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function HeadStat({ label, value, tone, title }: { label: string; value: string; tone?: "up" | "down"; title?: string }) {
  return (
    <div title={title}>
      <dt className={`text-[12px] text-muted ${title ? "underline decoration-dotted underline-offset-4" : ""}`}>{label}</dt>
      <dd className={`mt-1 text-[22px] font-semibold tabular-nums ${tone === "up" ? "text-brand-800" : tone === "down" ? "text-danger-500" : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}

function AccountRow({ book, onOpen }: { book: ClientBook; onOpen: () => void }) {
  const gain = book.invested > 0 ? book.value / book.invested - 1 : null;
  return (
    <tr
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      tabIndex={0}
      className="cursor-pointer border-b border-line last:border-0 hover:bg-paper-2 focus:bg-paper-2 focus:outline-none"
    >
      <td className="px-5 py-3.5">
        <span className="block font-semibold text-ink">{book.client.name}</span>
        <span className="text-[12px] text-muted">{book.client.city}</span>
      </td>
      <td className="px-3 py-3.5 text-ink-2">{book.client.basketName}</td>
      <td className="px-3 py-3.5 text-ink-2">{fmtDay(book.client.since)}</td>
      <td className="px-3 py-3.5 text-ink-2">{fmtDay(book.lastActivity)}</td>
      <td className="px-5 py-3.5 text-right">
        <span className="block font-semibold tabular-nums text-ink">{formatRupees(Math.round(book.value))}</span>
        {gain != null && <span className={`text-[12px] tabular-nums ${gain >= 0 ? "text-brand-800" : "text-danger-500"}`}>{formatSignedPct(gain, 1)} all time</span>}
      </td>
    </tr>
  );
}
