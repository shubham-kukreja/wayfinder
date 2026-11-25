import { useMemo, useState } from "react";
import { segmentColor } from "../../components/AllocationBar.js";
import { CheckIcon } from "../../components/clients/icons.js";
import { PrimaryButton } from "../../components/clients/ui.js";
import type { NavMap } from "../../lib/aum.js";
import { formatRupees } from "../../lib/backtestFormat.js";
import { placeOrder, type Order } from "../../lib/clients.js";
import { formatSignedPct } from "../../lib/format.js";
import {
  EQUITY_LTCG_RATE,
  EQUITY_STCG_RATE,
  LTCG_EXEMPTION,
  fyStart,
  harvestGains,
  harvestLosses,
  lotsFifo,
  type OpenLot,
} from "../../lib/tax.js";

// P&L and tax harvesting for one client, from their orders and real NAVs,
// lot by lot (lib/tax.ts). Tax figures are estimates under the post-July-2024
// rules, not tax advice.

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${formatRupees(Math.abs(Math.round(v)))}`;
const tone = (v: number) => (v >= 0 ? "text-brand-800" : "text-danger-500");
const fyLabel = (start: string) => {
  const y = Number(start.slice(0, 4));
  return `FY ${y}–${String(y + 1).slice(2)}`;
};

function useTax(orders: Order[], navs: NavMap | null, asOf: string | null) {
  return useMemo(() => (navs && asOf ? { ...lotsFifo(orders, navs, asOf), asOf } : null), [orders, navs, asOf]);
}

export function ClientPnl({ orders, navs, asOf }: { orders: Order[]; navs: NavMap | null; asOf: string | null }) {
  const tax = useTax(orders, navs, asOf);
  if (!tax) return <p className="mt-6 text-[13px] text-muted">Loading lots</p>;
  const fy = fyStart(tax.asOf);
  const open = tax.open;
  const cost = open.reduce((s, l) => s + l.cost, 0);
  const value = open.reduce((s, l) => s + l.value, 0);
  const ltOpen = open.filter((l) => l.longTerm).reduce((s, l) => s + l.gain, 0);
  const stOpen = open.filter((l) => !l.longTerm).reduce((s, l) => s + l.gain, 0);
  const thisYear = tax.realised.filter((r) => r.sold >= fy);
  const ltReal = thisYear.filter((r) => r.longTerm).reduce((s, r) => s + r.gain, 0);
  const stReal = thisYear.filter((r) => !r.longTerm).reduce((s, r) => s + r.gain, 0);
  const eqLt = thisYear.filter((r) => r.cls === "equity" && r.longTerm).reduce((s, r) => s + r.gain, 0);
  const eqSt = thisYear.filter((r) => r.cls === "equity" && !r.longTerm).reduce((s, r) => s + r.gain, 0);
  const estTax = Math.max(0, eqLt - LTCG_EXEMPTION) * EQUITY_LTCG_RATE + Math.max(0, eqSt) * EQUITY_STCG_RATE;

  const byFund = new Map<string, { name: string; sleeve: string; cost: number; value: number; lt: number; st: number }>();
  for (const l of open) {
    const f = byFund.get(l.schemeCode) ?? { name: l.schemeName, sleeve: l.sleeve, cost: 0, value: 0, lt: 0, st: 0 };
    f.cost += l.cost;
    f.value += l.value;
    if (l.longTerm) f.lt += l.gain;
    else f.st += l.gain;
    byFund.set(l.schemeCode, f);
  }
  const funds = [...byFund.values()].sort((a, b) => b.value - a.value);

  return (
    <>
      <dl className="mt-6 grid grid-cols-2 rounded-xl border border-line sm:grid-cols-4 sm:divide-x sm:divide-line">
        <Cell label="Cost of holdings" value={formatRupees(Math.round(cost))} note={`Value ${formatRupees(Math.round(value))}`} />
        <Cell label="Unrealised gain" value={signed(value - cost)} note={`${signed(ltOpen)} long-term, ${signed(stOpen)} short-term`} className={tone(value - cost)} />
        <Cell label={`Realised in ${fyLabel(fy)}`} value={signed(ltReal + stReal)} note={`${signed(ltReal)} long-term, ${signed(stReal)} short-term`} className={tone(ltReal + stReal)} />
        <Cell label="Estimated equity tax this year" value={formatRupees(Math.round(estTax))} note={`LTCG 12.5% above ₹1.25 lakh, STCG 20%`} />
      </dl>
      <section className="mt-6 overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-muted">
              <th className="px-5 py-2.5 font-normal">Fund</th>
              <th className="px-3 py-2.5 text-right font-normal">Cost</th>
              <th className="px-3 py-2.5 text-right font-normal">Value</th>
              <th className="px-3 py-2.5 text-right font-normal">Long-term gain</th>
              <th className="px-3 py-2.5 text-right font-normal">Short-term gain</th>
              <th className="px-5 py-2.5 text-right font-normal">Return</th>
            </tr>
          </thead>
          <tbody>
            {funds.map((f) => (
              <tr key={f.name} className="border-b border-line last:border-0">
                <td className="px-5 py-3">
                  <span className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: segmentColor(f.sleeve) }} aria-hidden="true" />
                    <span className="text-ink">{f.name}</span>
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-2">{formatRupees(Math.round(f.cost))}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">{formatRupees(Math.round(f.value))}</td>
                <td className={`px-3 py-3 text-right tabular-nums ${f.lt === 0 ? "text-muted" : tone(f.lt)}`}>{f.lt === 0 ? "–" : signed(f.lt)}</td>
                <td className={`px-3 py-3 text-right tabular-nums ${f.st === 0 ? "text-muted" : tone(f.st)}`}>{f.st === 0 ? "–" : signed(f.st)}</td>
                <td className={`px-5 py-3 text-right tabular-nums ${tone(f.value - f.cost)}`}>{formatSignedPct(f.cost > 0 ? f.value / f.cost - 1 : 0, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="mt-3 text-[12px] text-muted">
        Lots are matched first in, first out. Equity funds turn long-term after 12 months; gold, silver and international fund-of-funds after 24; debt funds
        bought from April 2023 are taxed at the slab rate. Estimates, not tax advice
      </p>
    </>
  );
}

export function ClientHarvest({
  clientId,
  orders,
  navs,
  asOf,
  onPlaced,
}: {
  clientId: string;
  orders: Order[];
  navs: NavMap | null;
  asOf: string | null;
  onPlaced: () => void;
}) {
  const tax = useTax(orders, navs, asOf);
  const [placed, setPlaced] = useState<number | null>(null);
  if (!tax) return <p className="mt-6 text-[13px] text-muted">Loading lots</p>;
  const fy = fyStart(tax.asOf);
  const used = tax.realised.filter((r) => r.sold >= fy && r.cls === "equity" && r.longTerm).reduce((s, r) => s + r.gain, 0);
  const gains = harvestGains(tax.open, used);
  const losses = harvestLosses(tax.open);
  const saved = gains.gain * EQUITY_LTCG_RATE;

  function place() {
    const today = new Date().toISOString().slice(0, 10);
    placeOrder(clientId, {
      id: `hv-${Date.now()}`,
      date: today,
      amount: 0,
      kind: "harvest",
      lines: gains.lines.flatMap((h) => [
        { sleeve: h.sleeve, label: h.label, schemeCode: h.schemeCode, schemeName: h.schemeName, amount: -h.amount },
        { sleeve: h.sleeve, label: h.label, schemeCode: h.schemeCode, schemeName: h.schemeName, amount: h.amount },
      ]),
    });
    setPlaced(gains.gain);
    onPlaced();
  }

  return (
    <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-line bg-paper">
        <div className="px-5 pb-3 pt-5">
          <h2 className="text-[15px] font-semibold text-ink">Book tax-free long-term gains</h2>
          <p className="mt-1 text-[13px] text-muted">
            Equity long-term gains up to {formatRupees(LTCG_EXEMPTION)} a year are tax-free. Redeeming and reinvesting the same day books them and resets the
            cost higher
          </p>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-line border-y border-line">
          <Cell label={`Used in ${fyLabel(fy)}`} value={formatRupees(Math.round(used))} />
          <Cell label="Room left" value={formatRupees(Math.round(gains.room))} />
          <Cell label="Future tax saved" value={formatRupees(Math.round(saved))} note="At 12.5%" className={saved > 0 ? "text-brand-800" : "text-ink"} />
        </dl>
        {placed != null ? (
          <p className="flex items-center gap-2 px-5 py-4 text-[13px] text-ink">
            <CheckIcon className="h-4 w-4 text-brand-800" />
            {formatRupees(Math.round(placed))} of gains booked and reinvested
          </p>
        ) : gains.lines.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-muted">
            {gains.room <= 0 ? "This year's exemption is used up" : "No long-term equity gains to book yet"}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {gains.lines.map((h) => (
                <li key={h.schemeCode} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-ink">{h.schemeName}</span>
                    <span className="text-[12px] text-muted">Redeem and reinvest {formatRupees(h.amount)}</span>
                  </span>
                  <span className="text-[14px] tabular-nums text-brand-800">{signed(h.gain)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end border-t border-line px-5 py-4">
              <PrimaryButton onClick={place}>Book {formatRupees(Math.round(gains.gain))} of gains</PrimaryButton>
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-line bg-paper">
        <div className="px-5 pb-3 pt-5">
          <h2 className="text-[15px] font-semibold text-ink">Losses that could offset gains</h2>
          <p className="mt-1 text-[13px] text-muted">
            A short-term loss offsets any gain; a long-term loss offsets long-term gains. Unused losses carry forward eight years
          </p>
        </div>
        {losses.length === 0 ? (
          <p className="border-t border-line px-5 py-4 text-[13px] text-muted">No fund is below its cost</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {losses.map((h) => (
              <li key={h.schemeCode} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-5 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-ink">{h.schemeName}</span>
                  <span className="text-[12px] text-muted">
                    {h.longTerm ? "Long-term" : "Short-term"} loss on {formatRupees(h.amount)} held
                  </span>
                </span>
                <span className="text-[14px] tabular-nums text-danger-500">{signed(h.gain)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Cell({ label, value, note, className = "text-ink" }: { label: string; value: string; note?: string; className?: string }) {
  return (
    <div className="border-line px-5 py-4 [&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-t-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className={`mt-1 text-[20px] font-semibold tabular-nums ${className}`}>{value}</dd>
      {note && <dd className="mt-1 text-[12px] text-muted">{note}</dd>}
    </div>
  );
}

export type { OpenLot };
