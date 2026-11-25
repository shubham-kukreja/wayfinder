import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Breadcrumb, PrimaryButton, SecondaryButton } from "../../components/clients/ui.js";
import { useBook } from "../../hooks/useBook.js";
import { useInvestmentPlan } from "../../hooks/useInvestmentPlan.js";
import { formatRupees } from "../../lib/backtestFormat.js";
import { clientById, placeOrder, type OrderLine } from "../../lib/clients.js";
import { formatPct } from "../../lib/format.js";

// Rebalance a client back to the model: each sleeve's value against the
// model weight × the client's total. Sleeves more than BAND off get trades:
// sells pro rata across the funds held in an overweight sleeve, buys into
// the biggest fund already held in an underweight one (else its top-ranked
// fund). Sells and buys net to zero, so no new money is needed.

const BAND = 0.01; // of the portfolio
const MIN_TRADE = 10_000; // smaller fund-level sells fold into the sleeve's other funds
const round100 = (v: number) => Math.round(v / 100) * 100;

interface Trade extends OrderLine {
  /** Sell is negative. */
  amount: number;
}

interface Row {
  sleeve: string;
  label: string;
  color: string;
  now: number;
  nowShare: number;
  model: number;
  drift: number; // share − model
  trades: Trade[];
}

export function RebalanceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = clientById(id);
  const one = useMemo(() => (client ? [client] : []), [client]);
  const book = useBook(one, "MAX");
  const plan = useInvestmentPlan(1_00_000); // for each sleeve's top-ranked fund
  const [done, setDone] = useState(false);

  const rows: Row[] = useMemo(() => {
    if (!plan.allocation || book.loading) return [];
    const total = book.holdings.reduce((s, h) => s + h.value, 0);
    if (total <= 0) return [];
    const base = plan.lines.map((l) => {
      const held = book.holdings.filter((h) => h.sleeve === l.sleeve && h.value > 0.5);
      const now = held.reduce((s, h) => s + h.value, 0);
      const model = l.weight;
      return { line: l, held, now, model, gap: model * total - now };
    });
    // Only sleeves outside the band trade; scale so sells equal buys.
    const out = base.filter((b) => Math.abs(b.gap) / total >= BAND);
    const sells = out.filter((b) => b.gap < 0).reduce((s, b) => s - b.gap, 0);
    const buys = out.filter((b) => b.gap > 0).reduce((s, b) => s + b.gap, 0);
    const scale = sells > 0 && buys > 0 ? Math.min(sells, buys) : 0;
    return base.map((b) => {
      const trades: Trade[] = [];
      if (scale > 0 && out.includes(b)) {
        const amt = b.gap < 0 ? -(-b.gap / sells) * scale : (b.gap / buys) * scale;
        if (amt < 0) {
          // Pro rata across the funds held, dropping sells under MIN_TRADE and
          // spreading them over the rest.
          let from = b.held.filter((h) => (-amt * h.value) / b.now >= MIN_TRADE);
          if (from.length === 0) from = b.held.slice().sort((x, y) => y.value - x.value).slice(0, 1);
          const base = from.reduce((s, h) => s + h.value, 0);
          for (const h of from) {
            const v = round100((amt * h.value) / base);
            if (v !== 0) trades.push({ sleeve: b.line.sleeve, label: b.line.label, schemeCode: h.schemeCode, schemeName: h.schemeName, amount: v });
          }
        } else {
          const into = b.held.slice().sort((x, y) => y.value - x.value)[0];
          const fund = into ? { schemeCode: into.schemeCode, schemeName: into.schemeName } : b.line.funds[0]?.fund;
          if (fund) trades.push({ sleeve: b.line.sleeve, label: b.line.label, schemeCode: fund.schemeCode, schemeName: fund.schemeName, amount: round100(amt) });
        }
      }
      return {
        sleeve: b.line.sleeve,
        label: b.line.label,
        color: b.line.color,
        now: b.now,
        nowShare: b.now / total,
        model: b.model,
        drift: b.now / total - b.model,
        trades,
      };
    });
  }, [plan.allocation, plan.lines, book.holdings, book.loading]);

  // Rounding can leave the two sides a few hundred rupees apart; the largest
  // buy absorbs it so the order nets to zero.
  const trades = useMemo(() => {
    const all = rows.flatMap((r) => r.trades);
    const net = all.reduce((s, t) => s + t.amount, 0);
    const buy = all.filter((t) => t.amount > 0).sort((a, b) => b.amount - a.amount)[0];
    if (buy && net !== 0) buy.amount -= net;
    return all;
  }, [rows]);

  if (!client) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-8 py-8 text-sm text-muted">
        No such client. <Link to="/clients" className="font-semibold text-ink underline">Clients</Link>
      </div>
    );
  }
  const first = client.name.split(" ")[0];
  const moved = trades.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalDrift = rows.reduce((s, r) => s + Math.abs(r.drift), 0) / 2;
  const loading = book.loading || plan.loading;

  function confirm() {
    placeOrder(client!.id, { id: `reb-${Date.now()}`, date: new Date().toISOString().slice(0, 10), amount: 0, kind: "rebalance", lines: trades });
    setDone(true);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-8 py-8">
      <Breadcrumb items={[{ label: "Clients", to: "/clients" }, { label: client.name, to: `/clients/${client.id}` }, { label: "Rebalance" }]} />
      <header className="mt-4">
        <h1 className="font-display text-[28px] leading-tight text-ink">Rebalance {first} to the model</h1>
        <p className="mt-1 max-w-3xl text-[13px] text-muted">
          Sleeves more than {formatPct(BAND, 0)} of the portfolio away from the model are traded back. Sells and buys net to zero, so no new money is
          needed
        </p>
      </header>

      {done ? (
        <section className="mt-8 rounded-xl border border-line bg-paper px-6 py-12 text-center">
          <h2 className="text-[22px] font-semibold tabular-nums text-ink">{formatRupees(moved)} moved for {first}</h2>
          <p className="mt-2 text-[13px] text-muted">{trades.length} trades, now in {first}'s holdings and activity</p>
          <div className="mt-6 flex justify-center">
            <PrimaryButton onClick={() => navigate(`/clients/${client.id}`)}>Back to {first}</PrimaryButton>
          </div>
        </section>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-1 rounded-xl border border-line sm:grid-cols-3 sm:divide-x sm:divide-line">
            <Fig label="Off the model" value={loading ? "…" : formatPct(totalDrift, 1)} note="Share of the portfolio in the wrong sleeves" />
            <Fig label="To move" value={loading ? "…" : formatRupees(moved)} note={`${trades.filter((t) => t.amount < 0).length} sells, ${trades.filter((t) => t.amount > 0).length} buys`} />
            <Fig label="Portfolio" value={loading ? "…" : formatRupees(Math.round(book.holdings.reduce((s, h) => s + h.value, 0)))} note="At the latest NAVs" />
          </dl>

          <section className="mt-6 overflow-x-auto rounded-xl border border-line bg-paper">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-normal">Sleeve</th>
                  <th className="px-3 py-2.5 text-right font-normal">Now</th>
                  <th className="px-3 py-2.5 text-right font-normal">Model</th>
                  <th className="px-3 py-2.5 text-right font-normal">Drift</th>
                  <th className="px-5 py-2.5 text-right font-normal">Trade</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-muted">
                      Comparing holdings with the model…
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <RowView key={r.sleeve} row={r} />
                ))}
              </tbody>
            </table>
          </section>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <SecondaryButton onClick={() => navigate(`/clients/${client.id}`)}>Cancel</SecondaryButton>
            <PrimaryButton disabled={loading || trades.length === 0} onClick={confirm}>
              {trades.length === 0 && !loading ? "Already within the band" : "Confirm rebalance"}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}

function RowView({ row }: { row: Row }) {
  const net = row.trades.reduce((s, t) => s + t.amount, 0);
  return (
    <>
      <tr className="border-b border-line">
        <td className="px-5 py-3">
          <span className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: row.color }} aria-hidden="true" />
            <span className="text-ink">{row.label}</span>
          </span>
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-ink">
          {formatPct(row.nowShare, 1)}
          <span className="block text-[12px] text-muted">{formatRupees(Math.round(row.now))}</span>
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-ink-2">{formatPct(row.model, 1)}</td>
        <td className={`px-3 py-3 text-right tabular-nums ${Math.abs(row.drift) < BAND ? "text-muted" : "text-ink"}`}>
          {row.drift >= 0 ? "+" : "−"}
          {formatPct(Math.abs(row.drift), 1)}
        </td>
        <td className="px-5 py-3 text-right tabular-nums">
          {row.trades.length === 0 ? (
            <span className="text-muted">Within band</span>
          ) : (
            <span className={net < 0 ? "text-ink" : "font-semibold text-brand-800"}>
              {net < 0 ? "Sell" : "Buy"} {formatRupees(Math.abs(net))}
            </span>
          )}
        </td>
      </tr>
      {row.trades.map((t) => (
        <tr key={t.schemeCode} className="border-b border-line bg-paper-2/50 text-[12px]">
          <td className="py-2 pl-10 pr-3 text-ink-2" colSpan={4}>
            {t.schemeName}
          </td>
          <td className="px-5 py-2 text-right tabular-nums text-ink-2">
            {t.amount < 0 ? "Sell" : "Buy"} {formatRupees(Math.abs(t.amount))}
          </td>
        </tr>
      ))}
    </>
  );
}

function Fig({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-line px-5 py-4 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="mt-1 text-[22px] font-semibold tabular-nums text-ink">{value}</dd>
      <dd className="mt-1 text-[12px] text-muted">{note}</dd>
    </div>
  );
}
