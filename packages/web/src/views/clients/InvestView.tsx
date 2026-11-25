import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { stickyClassTotals } from "../../components/AllocationBar.js";
import { FundPickerPanel } from "../../components/clients/FundPickerPanel.js";
import { Breadcrumb, PrimaryButton, SecondaryButton } from "../../components/clients/ui.js";
import { SleeveAllocation, type SleeveFilter } from "../../components/SleeveAllocation.js";
import { Slider } from "../../components/ui/Slider.js";
import { useInvestmentPlan, type FundSlot, type PlannedLine } from "../../hooks/useInvestmentPlan.js";
import { formatRupees, formatRupeesCompact } from "../../lib/backtestFormat.js";
import { basketById } from "../../lib/baskets.js";
import { assetClassOf, clientById, placeOrder, type FundChoice } from "../../lib/clients.js";
import { formatPct } from "../../lib/format.js";

// Invest more for a client: the amount; the model's sleeves (the Overview
// widget, in the model's order) with one or two funds and the rupees for
// each; and the order, largest amount first, to confirm.

const PRESETS = [1_00_000, 5_00_000, 10_00_000, 25_00_000];
const STEPS = ["Amount", "Funds", "Review"] as const;
type Step = 0 | 1 | 2 | 3; // 3: placed

// The amount slider runs on a log scale from ₹10,000 to ₹1 Cr, so ₹1L and
// ₹25L are both easy to land on, and snaps to round figures.
const MIN_AMOUNT = 10_000;
const MAX_AMOUNT = 1_00_00_000;
const toAmount = (pos: number) => {
  const raw = MIN_AMOUNT * (MAX_AMOUNT / MIN_AMOUNT) ** (pos / 1000);
  const step = raw < 1_00_000 ? 1_000 : raw < 10_00_000 ? 10_000 : 1_00_000;
  return Math.min(MAX_AMOUNT, Math.round(raw / step) * step);
};
const toPos = (amount: number) => (1000 * Math.log(Math.max(MIN_AMOUNT, Math.min(MAX_AMOUNT, amount)) / MIN_AMOUNT)) / Math.log(MAX_AMOUNT / MIN_AMOUNT);

const presetLabel = (v: number) => (v >= 1_00_00_000 ? `₹${v / 1_00_00_000} Cr` : `₹${v / 1_00_000}L`);
const fmtDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

interface Buy {
  sleeve: string;
  label: string;
  color: string;
  slot: FundSlot;
}

export function InvestView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = clientById(id);
  const basket = basketById(client?.basket);
  const [amount, setAmountRaw] = useState(client?.investable ?? 0);
  // The slider keeps its own position: the amount snaps to round figures, and
  // deriving the position back from it would stall small moves.
  const [pos, setPos] = useState(() => toPos(client?.investable ?? MIN_AMOUNT));
  const setAmount = (v: number) => {
    setAmountRaw(v);
    setPos(toPos(v));
  };
  const [step, setStep] = useState<Step>(0);
  const [filter, setFilter] = useState<SleeveFilter>("all");
  const [choosing, setChoosing] = useState<{ sleeve: string; slot: number } | null>(null);
  const plan = useInvestmentPlan(amount);
  const bySleeve = useMemo(() => new Map(plan.lines.map((l) => [l.sleeve, l])), [plan.lines]);
  const buys: Buy[] = useMemo(
    () => plan.lines.flatMap((l) => l.funds.map((slot) => ({ sleeve: l.sleeve, label: l.label, color: l.color, slot }))),
    [plan.lines],
  );

  if (!client) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-8 py-8 text-sm text-muted">
        No such client. <Link to="/clients" className="font-semibold text-ink underline">Clients</Link>
      </div>
    );
  }
  const first = client.name.split(" ")[0];
  const total = plan.lines.reduce((s, l) => s + l.amount, 0);
  const missing = buys.filter((b) => !b.slot.fund).length;
  const ordered = [...buys].sort((a, b) => b.slot.amount - a.slot.amount);
  const choosingLine = choosing ? bySleeve.get(choosing.sleeve) ?? null : null;
  const choosingSlot = choosingLine?.funds[choosing!.slot] ?? null;

  function confirm() {
    placeOrder(client!.id, {
      id: `ord-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      amount: total,
      kind: "invest",
      lines: buys
        .filter((b) => b.slot.fund)
        .map((b) => ({ sleeve: b.sleeve, label: b.label, schemeCode: b.slot.fund!.schemeCode, schemeName: b.slot.fund!.schemeName, amount: b.slot.amount })),
    });
    setStep(3);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-8 py-8">
      <Breadcrumb items={[{ label: "Clients", to: "/clients" }, { label: client.name, to: `/clients/${client.id}` }, { label: "Invest more" }]} />
      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] leading-tight text-ink">Invest more for {first}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {basket ? (
              <Link to={`/baskets/${basket.id}`} className="underline decoration-line underline-offset-4 transition-colors duration-150 ease-out hover:text-ink">
                {basket.code} · {basket.name}
              </Link>
            ) : (
              client.basketName
            )}{" "}
            · the model portfolio, split into funds from Fund Rankings
          </p>
        </div>
        {step < 3 && <Stepper step={step} onGo={(s) => s < step && setStep(s)} />}
      </header>

      {plan.error && <p className="mt-6 text-[13px] text-danger-500">Failed to load the model allocation: {plan.error}</p>}

      {step === 0 && (
        <section className="mt-8 rounded-xl border border-line bg-paper p-6 animate-rise-in">
          <label htmlFor="invest-amount" className="text-[15px] font-semibold text-ink">
            How much is {first} investing?
          </label>
          <p className="mt-3 text-[32px] font-semibold leading-tight tabular-nums text-ink">{formatRupees(amount)}</p>
          <Slider
            id="invest-amount"
            min={0}
            max={1000}
            step={1}
            value={pos}
            onChange={(e) => {
              const p = Number(e.target.value);
              setPos(p);
              setAmountRaw(toAmount(p));
            }}
            aria-valuetext={formatRupees(amount)}
            className="mt-4 w-full"
          />
          <div className="mt-1 flex justify-between text-[12px] tabular-nums text-muted">
            <span>₹10,000</span>
            <span>₹1 Cr</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                aria-pressed={amount === p}
                className={`h-9 rounded-md border px-3 text-[13px] font-semibold tabular-nums transition-colors duration-150 ease-out ${
                  amount === p ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paper-2"
                }`}
              >
                {presetLabel(p)}
              </button>
            ))}
          </div>
          {plan.allocation && plan.lines.length > 0 ? (
            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {stickyClassTotals(plan.allocation).map((c) => {
                const amt = plan.lines.filter((l) => assetClassOf(l.sleeve) === c.id).reduce((s, l) => s + l.amount, 0);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-md bg-paper-2 px-4 py-3">
                    <span className="flex items-center gap-2 text-[13px] text-ink-2">
                      <span className="h-2.5 w-2.5" style={{ backgroundColor: c.color }} aria-hidden="true" />
                      {c.label.replace(" Segments", "").replace(" Buckets", "")}
                      <span className="tabular-nums text-muted">{formatPct(c.weight, 1)}</span>
                    </span>
                    <span className="text-[15px] font-semibold tabular-nums text-ink">{formatRupeesCompact(amt)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-[13px] text-muted">Loading the model allocation…</p>
          )}
          <div className="mt-8 flex justify-end">
            <PrimaryButton disabled={amount < 1000 || plan.lines.length === 0} onClick={() => setStep(1)}>
              Show funds
            </PrimaryButton>
          </div>
        </section>
      )}

      {step === 1 && plan.allocation && (
        <div className="mt-8 animate-rise-in">
          <SleeveAllocation
            allocation={plan.allocation}
            filter={filter}
            onFilter={setFilter}
            title={`${formatRupees(total)} across ${plan.lines.length} sleeves`}
            subtitle={
              <>
                {buys.length} funds · model {plan.version?.kind === "draft" ? "draft" : "published"}
                {plan.version ? `, ${fmtDay(plan.version.as_of)}` : ""}
              </>
            }
            renderValue={(sleeve, weight) => {
              const line = bySleeve.get(sleeve);
              return (
                <>
                  <span className="mr-3 text-[13px] font-normal text-muted">{formatPct(weight, 1)}</span>
                  {line ? formatRupees(line.amount) : formatPct(weight, 1)}
                </>
              );
            }}
            renderDetail={(sleeve) => {
              const line = bySleeve.get(sleeve);
              return line ? <FundRows line={line} loading={plan.loading} onChange={(slot) => setChoosing({ sleeve, slot })} /> : null;
            }}
          />

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => setStep(0)} className="text-[13px] font-semibold text-muted transition-colors duration-150 ease-out hover:text-ink">
              Change amount
            </button>
            <div className="flex items-center gap-3">
              {missing > 0 && <span className="text-[12px] text-danger-500">{missing} without a fund</span>}
              <PrimaryButton disabled={plan.loading || missing > 0} onClick={() => setStep(2)}>
                Review order
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <section className="mt-8 rounded-xl border border-line bg-paper animate-rise-in">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pb-3 pt-5">
            <h2 className="text-lg font-semibold text-ink">Order for {client.name}</h2>
            <p className="text-[13px] text-muted">{buys.length} purchases, largest first</p>
          </div>
          <ol className="divide-y divide-line border-t border-line">
            {ordered.map((b, i) => (
              <li key={`${b.sleeve}:${b.slot.slot}`} className="grid grid-cols-[24px_12px_minmax(0,1fr)_auto] items-center gap-x-3 px-6 py-3">
                <span className="text-[13px] tabular-nums text-muted">{i + 1}</span>
                <span className="h-2.5 w-2.5" style={{ backgroundColor: b.color }} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-ink">{b.slot.fund?.schemeName ?? "No fund picked"}</span>
                  <span className="text-[12px] text-muted">{b.label}</span>
                </span>
                <span className="text-[14px] font-semibold tabular-nums text-ink">{formatRupees(b.slot.amount)}</span>
              </li>
            ))}
          </ol>
          <div className="flex items-center justify-between border-t border-line px-6 py-4">
            <span className="text-[14px] text-ink-2">Total</span>
            <span className="text-[22px] font-semibold tabular-nums text-ink">{formatRupees(total)}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
            <button type="button" onClick={() => setStep(1)} className="text-[13px] font-semibold text-muted transition-colors duration-150 ease-out hover:text-ink">
              Back to funds
            </button>
            <PrimaryButton disabled={missing > 0} onClick={confirm}>
              Confirm investment
            </PrimaryButton>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="mt-8 rounded-xl border border-line bg-paper px-6 py-12 text-center animate-rise-in">
          <h2 className="text-[22px] font-semibold tabular-nums text-ink">{formatRupees(total)} invested for {first}</h2>
          <p className="mt-2 text-[13px] text-muted">
            {buys.length} funds across {plan.lines.length} sleeves. Now in {first}'s holdings and activity
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <PrimaryButton onClick={() => navigate(`/clients/${client.id}`)}>Back to {first}</PrimaryButton>
            <SecondaryButton onClick={() => setStep(0)}>Invest more</SecondaryButton>
          </div>
        </section>
      )}

      {choosingLine && choosingSlot && (
        <FundPickerPanel
          sleeveLabel={choosingLine.funds.length > 1 ? `${choosingLine.label}, fund ${choosingSlot.slot + 1} of ${choosingLine.funds.length}` : choosingLine.label}
          weight={choosingLine.weight * (choosingSlot.amount / Math.max(1, choosingLine.amount))}
          amount={choosingSlot.amount}
          ranking={plan.rankingFor(choosingLine.sleeve)}
          current={choosingSlot.fund}
          fallback={choosingLine.fallback}
          overridden={choosingSlot.overridden}
          onPick={(f: FundChoice) => plan.pick(choosingLine.sleeve, choosingSlot.slot, f)}
          onReset={() => plan.reset(choosingLine.sleeve, choosingSlot.slot)}
          onClose={() => setChoosing(null)}
        />
      )}
    </div>
  );
}

function meta(f: FundChoice): string {
  if (f.source !== "ranking") return f.source === "default" ? "Default for this sleeve" : "Picked by search";
  if (f.status === "incomplete") return "Not scored, under 10 years";
  return `#${f.rank ?? "–"} of ${f.rankedOf ?? "–"}${f.composite != null ? ` · score ${Math.round(f.composite)}` : ""}`;
}

function FundRows({ line, loading, onChange }: { line: PlannedLine; loading: boolean; onChange: (slot: number) => void }) {
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {line.funds.map((s) => (
        <li key={s.slot} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 px-4 py-2.5">
          <span className="min-w-0">
            <span className="block truncate text-[14px] text-ink" title={s.fund?.schemeName}>
              {s.fund?.schemeName ?? (loading ? "Finding a fund…" : "No fund available")}
            </span>
            {s.fund && (
              <span className="text-[12px] tabular-nums text-muted">
                {meta(s.fund)}
                {s.overridden && " · chosen by you"}
              </span>
            )}
          </span>
          <span className="text-[14px] tabular-nums text-ink-2">{formatRupees(s.amount)}</span>
          <button
            type="button"
            onClick={() => onChange(s.slot)}
            className="text-[13px] font-semibold text-muted underline decoration-line underline-offset-4 transition-colors duration-150 ease-out hover:text-ink"
          >
            Change
          </button>
        </li>
      ))}
    </ul>
  );
}

function Stepper({ step, onGo }: { step: Step; onGo: (s: Step) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Steps">
      {STEPS.map((label, i) => {
        const state = i < step ? "done" : i === step ? "current" : "next";
        return (
          <li key={label} className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onGo(i as Step)}
              disabled={state !== "done"}
              aria-current={state === "current" ? "step" : undefined}
              className={`flex items-center gap-2 text-[13px] ${state === "current" ? "font-semibold text-ink" : state === "done" ? "text-ink-2 hover:text-ink" : "text-muted"}`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] tabular-nums ${
                  state === "current" ? "bg-ink text-paper" : state === "done" ? "bg-paper-2 text-ink" : "border border-line text-muted"
                }`}
              >
                {i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-line" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
