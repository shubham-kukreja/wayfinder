import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { stickyClassTotals } from "../../components/AllocationBar.js";
import { FundPickerPanel } from "../../components/clients/FundPickerPanel.js";
import { rankText } from "../../components/clients/FundSwitcher.js";
import { SleeveAllocation, type SleeveFilter } from "../../components/SleeveAllocation.js";
import { AmountInput } from "../../components/ui/AmountInput.js";
import { Pill } from "../../components/ui/Pill.js";
import { useInvestmentPlan, type PlannedLine } from "../../hooks/useInvestmentPlan.js";
import { formatRupees, formatRupeesCompact } from "../../lib/backtestFormat.js";
import { assetClassOf, clientById, placeOrder } from "../../lib/clients.js";
import { formatPct } from "../../lib/format.js";
import { STATUS_LABEL, STATUS_TONE, formatPct as formatReturn } from "../funds/fundFormat.js";

// Invest more for a client, in three steps a distributor can follow on
// screen: the amount; the model's sleeve allocation (the same widget as
// Overview, in the model's order) with the best-ranked fund and the amount
// for every sleeve, each changeable from its Fund Rankings table; and the
// order, largest amount first, to confirm.

const PRESETS = [1_00_000, 5_00_000, 10_00_000, 25_00_000];
const STEPS = ["Amount", "Funds", "Review order"] as const;
type Step = 0 | 1 | 2 | 3; // 3: placed

const presetLabel = (v: number) => (v >= 1_00_00_000 ? `₹${v / 1_00_00_000}Cr` : `₹${v / 1_00_000}L`);
const fmtDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const stagger = (i: number): CSSProperties => ({ animationDelay: `${i * 60}ms` });

export function InvestView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = clientById(id);
  const [amount, setAmount] = useState(client?.investable ?? 0);
  const [step, setStep] = useState<Step>(0);
  const [filter, setFilter] = useState<SleeveFilter>("all");
  const [choosing, setChoosing] = useState<string | null>(null);
  const plan = useInvestmentPlan(amount);
  const bySleeve = useMemo(() => new Map(plan.lines.map((l) => [l.sleeve, l])), [plan.lines]);

  if (!client) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-8 text-sm text-muted">
        No such client. <Link to="/clients" className="font-semibold text-ink underline">Clients</Link>
      </div>
    );
  }
  const first = client.name.split(" ")[0];
  const total = plan.lines.reduce((s, l) => s + l.amount, 0);
  const missing = plan.lines.filter((l) => !l.fund).length;
  const ordered = [...plan.lines].sort((a, b) => b.amount - a.amount);
  const choosingLine = choosing ? bySleeve.get(choosing) ?? null : null;

  function confirm() {
    placeOrder(client!.id, {
      id: `ord-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      amount: total,
      lines: plan.lines
        .filter((l) => l.fund)
        .map((l) => ({ sleeve: l.sleeve, label: l.label, schemeCode: l.fund!.schemeCode, schemeName: l.fund!.schemeName, amount: l.amount })),
    });
    setStep(3);
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <nav className="text-[13px] text-muted" aria-label="Breadcrumb">
        <Link to="/clients" className="hover:text-ink">
          Clients
        </Link>
        <span className="px-2">/</span>
        <Link to={`/clients/${client.id}`} className="hover:text-ink">
          {client.name}
        </Link>
        <span className="px-2">/</span>
        <span className="text-ink">Invest more</span>
      </nav>
      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] leading-tight text-ink">Invest more for {first}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {client.basketName} basket · split by the model allocation into the best-ranked fund for every sleeve
          </p>
        </div>
        {step < 3 && <Stepper step={step} onGo={(s) => s < step && setStep(s)} />}
      </header>

      {plan.error && <p className="mt-6 text-[13px] text-danger-500">Failed to load the model allocation: {plan.error}</p>}

      {step === 0 && (
        <section className="mt-6 border border-line bg-paper px-6 py-8 animate-rise-in">
          <label htmlFor="invest-amount" className="text-[15px] font-semibold text-ink">
            How much is {first} investing?
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <AmountInput value={amount} onChange={(v) => setAmount(Math.max(0, Math.round(v)))} className="w-56" />
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                aria-pressed={amount === p}
                className={`h-9 rounded-sm border px-3 text-[13px] font-semibold transition-colors duration-100 ease-in ${
                  amount === p ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paper-2"
                }`}
              >
                {presetLabel(p)}
              </button>
            ))}
          </div>
          {plan.allocation && plan.lines.length > 0 ? (
            <>
              <p className="mt-6 text-[13px] text-muted">
                Following the {client.basketName} model, {formatRupees(total)} goes into {plan.lines.length} funds:
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {stickyClassTotals(plan.allocation).map((c) => {
                  const amt = plan.lines.filter((l) => assetClassOf(l.sleeve) === c.id).reduce((s, l) => s + l.amount, 0);
                  return (
                    <div key={c.id} className="flex items-center justify-between gap-3 bg-paper-2 px-4 py-3">
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
                        <span className="h-2.5 w-2.5" style={{ backgroundColor: c.color }} aria-hidden="true" />
                        {c.label.replace(" Segments", "").replace(" Buckets", "")}
                        <span className="font-normal tabular-nums text-muted">{formatPct(c.weight, 1)}</span>
                      </span>
                      <span className="text-[15px] font-semibold tabular-nums text-ink">{formatRupeesCompact(amt)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="mt-4 text-[13px] text-muted">Loading the model allocation…</p>
          )}
          <div className="mt-8 flex justify-end">
            <PrimaryButton disabled={amount < 1000 || plan.lines.length === 0} onClick={() => setStep(1)}>
              Show best funds →
            </PrimaryButton>
          </div>
        </section>
      )}

      {step === 1 && plan.allocation && (
        <div className="mt-6 animate-rise-in">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-line bg-paper px-5 py-4 text-[13px] text-ink-2">
            <Flow value={formatRupees(total)} label="to invest" />
            <Arrow />
            <Flow value={String(stickyClassTotals(plan.allocation).length)} label="asset classes" />
            <Arrow />
            <Flow value={String(plan.lines.length)} label="sleeves" />
            <Arrow />
            <Flow value={String(plan.lines.filter((l) => l.fund).length)} label="best-ranked funds" />
            {plan.version && (
              <span className="ml-auto text-[12px] text-muted">
                Model {plan.version.kind === "draft" ? "draft" : "published"}, as of {fmtDay(plan.version.as_of)}
              </span>
            )}
          </div>

          <SleeveAllocation
            className="mt-6"
            allocation={plan.allocation}
            filter={filter}
            onFilter={setFilter}
            title={`Where ${formatRupees(total)} goes`}
            subtitle={<>{plan.lines.length} sleeves in the model's order · one fund each, picked from Fund Rankings</>}
            renderDetail={(sleeve) => {
              const line = bySleeve.get(sleeve);
              if (!line) return null;
              const index = plan.lines.indexOf(line);
              return <FundLine line={line} index={index} facts={factsFor(plan.rankingFor(sleeve), line)} loading={plan.loading} onChange={() => setChoosing(sleeve)} />;
            }}
          />

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => setStep(0)} className="text-[13px] font-semibold text-muted hover:text-ink">
              ← Change amount
            </button>
            <div className="flex items-center gap-3">
              {missing > 0 && <span className="text-[12px] text-danger-500">{missing} sleeve{missing === 1 ? "" : "s"} without a fund</span>}
              <PrimaryButton disabled={plan.loading || missing > 0} onClick={() => setStep(2)}>
                Review order →
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <section className="mt-6 border border-line bg-paper animate-rise-in">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-paper-2 px-5 py-3">
            <h2 className="text-[13px] font-semibold text-ink">Order for {client.name} · largest amount first</h2>
            <p className="text-[12px] text-muted">{plan.lines.length} purchases</p>
          </div>
          <ol className="divide-y divide-line">
            {ordered.map((l, i) => (
              <li key={l.sleeve} className="grid grid-cols-[28px_1fr_auto] items-center gap-x-4 px-5 py-3 animate-rise-in" style={stagger(i)}>
                <span className="font-display text-lg tabular-nums text-muted">{i + 1}</span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-ink">{l.fund?.schemeName ?? "No fund picked"}</p>
                  <p className="text-[12px] text-muted">
                    {l.label} · {formatPct(l.weight, 1)} of the plan
                  </p>
                </div>
                <span className="text-[15px] font-semibold tabular-nums text-ink">{formatRupees(l.amount)}</span>
              </li>
            ))}
          </ol>
          <div className="flex items-center justify-between border-t border-line px-5 py-4">
            <span className="text-[13px] font-semibold text-ink">Total</span>
            <span className="font-display text-2xl tabular-nums text-ink">{formatRupees(total)}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
            <button type="button" onClick={() => setStep(1)} className="text-[13px] font-semibold text-muted hover:text-ink">
              ← Back to funds
            </button>
            <PrimaryButton disabled={missing > 0} onClick={confirm}>
              Confirm investment
            </PrimaryButton>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="mt-8 border border-line bg-paper px-6 py-10 text-center animate-rise-in">
          <span className="mx-auto flex h-12 w-12 items-center justify-center bg-brand-50 text-brand-800" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <h2 className="mt-4 font-display text-2xl text-ink">
            {formatRupees(total)} invested for {first}
          </h2>
          <p className="mt-2 text-[13px] text-muted">
            {plan.lines.length} funds, following the {client.basketName} model. It now shows in {first}'s holdings and activity.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <PrimaryButton onClick={() => navigate(`/clients/${client.id}`)}>Back to {first}</PrimaryButton>
            <button
              type="button"
              onClick={() => setStep(0)}
              className="rounded-md border border-line px-[22px] py-[11px] text-sm font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
            >
              Invest more
            </button>
          </div>
        </section>
      )}

      {choosingLine && (
        <FundPickerPanel
          sleeveLabel={choosingLine.label}
          weight={choosingLine.weight}
          amount={choosingLine.amount}
          ranking={plan.rankingFor(choosingLine.sleeve)}
          current={choosingLine.fund}
          fallback={choosingLine.fallback}
          overridden={choosingLine.overridden}
          onPick={(f) => plan.pick(choosingLine.sleeve, f)}
          onReset={() => plan.reset(choosingLine.sleeve)}
          onClose={() => setChoosing(null)}
        />
      )}
    </div>
  );
}

interface Facts {
  rolling10: number | null;
  trailing3: number | null;
  expense: number | null;
}

function factsFor(ranking: ReturnType<ReturnType<typeof useInvestmentPlan>["rankingFor"]>, line: PlannedLine): Facts | null {
  const f = ranking?.funds.find((x) => x.scheme_code === line.fund?.schemeCode);
  if (!f) return null;
  return { rolling10: f.metrics["rolling_return_10y"] ?? null, trailing3: f.facts.returns["3y"] ?? null, expense: f.facts.ter_direct };
}

function FundLine({ line, index, facts, loading, onChange }: { line: PlannedLine; index: number; facts: Facts | null; loading: boolean; onChange: () => void }) {
  const f = line.fund;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-l-2 border-line bg-paper-2/60 py-2.5 pl-4 pr-3 animate-rise-in" style={stagger(index)}>
      <div className="min-w-0 flex-1">
        {f ? (
          <>
            <p className="truncate text-[14px] font-semibold text-ink" title={f.schemeName}>
              {f.schemeName}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
              {f.source === "ranking" && f.status && (
                <Pill tone={STATUS_TONE[f.status]} className="py-0.5">
                  {f.status === "shortlist" && f.rank === 1 && !line.overridden ? "Top pick" : STATUS_LABEL[f.status]}
                </Pill>
              )}
              <span>{rankText(f)}</span>
              {facts && (
                <>
                  {facts.rolling10 != null && <Fact label="10Y rolling" value={formatReturn(facts.rolling10)} />}
                  {facts.trailing3 != null && <Fact label="3Y return" value={formatReturn(facts.trailing3)} />}
                  {facts.expense != null && <Fact label="Expense" value={`${facts.expense.toFixed(2)}%`} />}
                </>
              )}
              {line.overridden && <span className="font-semibold text-ink-2">· your pick</span>}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-muted">{loading ? "Finding a fund…" : "No fund available; change to pick one."}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 rounded-sm border border-line bg-paper px-3 py-1.5 text-[12px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
      >
        Change fund
      </button>
      <span className="w-28 shrink-0 text-right text-[16px] font-semibold tabular-nums text-ink">{formatRupees(line.amount)}</span>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      · {label} <span className="font-semibold tabular-nums text-ink-2">{value}</span>
    </span>
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
              className={`flex items-center gap-2 text-[13px] font-semibold ${state === "next" ? "text-muted" : "text-ink"} ${state === "done" ? "hover:underline" : ""}`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center text-[12px] tabular-nums ${
                  state === "current" ? "bg-ink text-paper" : state === "done" ? "bg-brand-50 text-brand-800" : "border border-line text-muted"
                }`}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-8 bg-line" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

function Flow({ value, label }: { value: string; label: string }) {
  return (
    <span>
      <span className="font-semibold tabular-nums text-ink">{value}</span> {label}
    </span>
  );
}

function Arrow() {
  return (
    <span className="text-muted" aria-hidden="true">
      →
    </span>
  );
}

function PrimaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center rounded-md bg-ink px-[22px] py-[11px] text-sm font-semibold text-paper transition duration-100 ease-in hover:-translate-y-px hover:brightness-[1.06] active:translate-y-0 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
