import { useState } from "react";
import type { Snapshot } from "@wayfinder/engine";
import { GROUP_LABELS, L1_SIGNALS, EQUITY_SIGNALS, DEBT_SIGNALS, METALS_SIGNALS } from "@wayfinder/engine";
import { formatPct } from "../lib/format.js";

// §24-26 of the UX spec ("Methodology screen" / "Standing framework
// rules"): explanatory, philosophy-first content — expandable "How X is
// scored" sections with the model's real configured weights and tilt
// caps, plus the governance rules that apply between reviews. This is
// deliberately READ-ONLY; the editable weights/caps UI lives at
// /model/parameters (ParametersView) — this page explains WHY those
// numbers exist, not how to change them ("explain philosophy, not
// expose spreadsheet plumbing by default," per the spec).
const SIGNAL_LABELS: Record<string, string> = {
  valuation: "Valuation / Carry",
  macro: "Macro / Cycle",
  fundamentals: "Fundamentals",
  flows: "Flows & Sentiment",
  momentum: "Momentum",
  relvalue: "Relative value vs segments",
  revisions: "Earnings revision breadth",
  growth_diff: "Earnings growth differential",
  margin_cycle: "Margin / cycle position",
  carry: "Carry vs history",
  rate_cycle: "Rate-cycle duration benefit",
  spread_cushion: "Credit spread cushion",
  liquidity: "Liquidity / redemption safety",
  ratio_position: "Gold/Silver ratio positioning",
  real_rates: "Real-rates trend benefit",
  industrial: "Industrial demand cycle",
};

const STANDING_RULES = [
  "No tilt changes between reviews on news or price alone. Wait for the appropriate scheduled review, or a veto trigger.",
  "Vetoes block overweights; they do not force underweights.",
  "The sector satellite sleeve is empty by default.",
  "A sector exits the sleeve when its composite falls below the qualification threshold at a quarterly review.",
  "A sector exits after 4 consecutive quarters in the sleeve regardless of score, rotate out or re-underwrite from scratch.",
  "Precious metals are a diversifier, not a directional bet.",
  "Precious metals use neutral plus or minus tilt and never exceed 2x neutral weight.",
  "Extreme scores (above 80 or below 20) held for two consecutive reviews may use the full allowed tilt cap.",
];

// Source spreadsheet's "Weights & Rules" sheet, rows 54-61 ("Veto gates
// (block overweights only)") — not covered by the UX spec's own §24-26
// Methodology text, but real governance data that belongs alongside the
// standing rules above (vetoes are a named part of the framework, and
// this is the exact trigger table the engine's veto logic implements).
const VETO_GATES = [
  { gate: "Flow froth", trigger: "Category flows in the top decile for 3+ months", appliesTo: "Any bucket" },
  { gate: "Liquidity", trigger: "2+ AMCs restricting inflows in the category", appliesTo: "Equity segments, sectors" },
  { gate: "Currency stress", trigger: "Sharp INR depreciation episodes", appliesTo: "International equity" },
  { gate: "Earnings collapse", trigger: "Consensus EPS cut more than 15%, optically cheap on stale earnings", appliesTo: "Equity segments, sectors" },
  { gate: "Credit event", trigger: "Default or downgrade cycle underway", appliesTo: "Corporate debt bucket" },
  { gate: "Parabolic move", trigger: "Metal up more than 40% in 6 months, chase risk", appliesTo: "Gold, Silver" },
];

const REVIEW_CADENCE = [
  { cadence: "Monthly", activity: "Data tracker refresh and veto gate check", note: "~15 minutes; percentile history is an asset" },
  { cadence: "Quarterly", activity: "Sector satellite and flows/momentum review", note: "Sectors rotate faster than asset classes" },
  { cadence: "Semi-annual", activity: "Full strategic re-score: L1 and all L2", note: "Implement tilt changes over 4-8 weeks" },
  { cadence: "Annual", activity: "Backtest and weight sensitivity", note: "Test plus or minus 10% weight changes; simplify fragile models" },
  { cadence: "Annual", activity: "Neutral weight and policy review", note: "Risk-profile driven only, not framework-driven" },
];

function ExpandableSection({ title, weightSummary, defaultOpen = false, children }: { title: string; weightSummary: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-neutral-900">{title}</span>
        <span className="flex items-center gap-3">
          <span className="text-xs text-neutral-400">{weightSummary}</span>
          <span className={`text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">
            ⌄
          </span>
        </span>
      </button>
      {open && <div className="border-t border-neutral-100 px-4 py-3">{children}</div>}
    </div>
  );
}

function WeightRows({ weights, labels }: { weights: Record<string, number>; labels: Record<string, string> }) {
  return (
    <div className="space-y-2">
      {Object.entries(weights).map(([signal, weight]) => (
        <div key={signal} className="flex items-center justify-between gap-4 text-sm">
          <span className="text-neutral-600">{labels[signal] ?? signal}</span>
          <span className="font-medium tabular-nums text-neutral-900">{formatPct(weight, 0)}</span>
        </div>
      ))}
    </div>
  );
}

export function MethodologyView({ snapshot }: { snapshot: Snapshot }) {
  const { params } = snapshot;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-1 font-display text-xl font-extrabold tracking-tight text-neutral-900">Methodology</h1>
      <p className="mb-8 text-sm text-neutral-500">
        How each signal is weighted, how far the model can tilt from neutral, and the standing rules that govern when changes take effect.
        Live weights and caps below reflect the model's current configuration. To edit them, use{" "}
        <a href="/model/parameters" className="font-medium text-neutral-700 underline">
          Parameters
        </a>
        .
      </p>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">How each signal is scored</h2>
        <div className="space-y-2">
          <ExpandableSection title={`How ${GROUP_LABELS.l1 ?? "Asset Classes"} is scored`} weightSummary="5 signals" defaultOpen>
            <WeightRows weights={params.signalWeights.l1} labels={SIGNAL_LABELS} />
          </ExpandableSection>
          <ExpandableSection title={`How ${GROUP_LABELS.equity ?? "Equity Segments"} is scored`} weightSummary="5 signals">
            <WeightRows weights={params.signalWeights.equity} labels={SIGNAL_LABELS} />
          </ExpandableSection>
          <ExpandableSection title={`How ${GROUP_LABELS.debt ?? "Debt Buckets"} is scored`} weightSummary="4 signals">
            <WeightRows weights={params.signalWeights.debt} labels={SIGNAL_LABELS} />
          </ExpandableSection>
          <ExpandableSection title={`How ${GROUP_LABELS.metals ?? "Precious Metals"} is scored`} weightSummary="3 signals">
            <WeightRows weights={params.signalWeights.metals} labels={SIGNAL_LABELS} />
          </ExpandableSection>
          <ExpandableSection title="How the Sector Satellite is scored" weightSummary="4 signals">
            <WeightRows weights={params.signalWeights.sector} labels={SIGNAL_LABELS} />
          </ExpandableSection>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Reference: {L1_SIGNALS.length} L1 signals, {EQUITY_SIGNALS.length} equity segment signals, {DEBT_SIGNALS.length} debt bucket signals, {METALS_SIGNALS.length} metals signals.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Tilt caps</h2>
        <p className="mb-3 text-xs text-neutral-400">The maximum a node can move away from its neutral weight in a single review cycle.</p>
        <div className="border border-neutral-200 bg-white px-4 py-3">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-neutral-600">Max tilt — L1 asset classes</span>
              <span className="font-medium tabular-nums text-neutral-900">{formatPct(params.maxTilt.l1, 0)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-neutral-600">Max tilt — Equity segments</span>
              <span className="font-medium tabular-nums text-neutral-900">{formatPct(params.maxTilt.equity, 0)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-neutral-600">Max tilt — Debt buckets</span>
              <span className="font-medium tabular-nums text-neutral-900">{formatPct(params.maxTilt.debt, 0)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-neutral-600">Max tilt — Gold/Silver split</span>
              <span className="font-medium tabular-nums text-neutral-900">{formatPct(params.maxTilt.metals, 0)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-neutral-100 pt-2">
              <span className="text-neutral-600">Sector sleeve cap</span>
              <span className="font-medium tabular-nums text-neutral-900">{formatPct(params.sector.sleeveCap, 0)} of Equity</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-neutral-600">Max sectors held</span>
              <span className="font-medium tabular-nums text-neutral-900">{params.sector.maxSectors}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-neutral-600">Sector qualification threshold (composite)</span>
              <span className="font-medium tabular-nums text-neutral-900">{params.sector.threshold}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Review cadence</h2>
        <div className="space-y-0 border border-neutral-200 bg-white">
          {REVIEW_CADENCE.map((row, i) => (
            <div key={i} className={`grid grid-cols-[110px_1fr] gap-4 px-4 py-3 text-sm ${i > 0 ? "border-t border-neutral-100" : ""}`}>
              <span className="font-medium text-neutral-500">{row.cadence}</span>
              <div>
                <p className="text-neutral-800">{row.activity}</p>
                <p className="mt-0.5 text-xs text-neutral-400">{row.note}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Standing framework rules</h2>
        <p className="mb-3 text-xs text-neutral-400">Product logic, not optional visual notes — these are respected by the allocation engine, not just displayed here.</p>
        <ol className="space-y-2.5 border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
          {STANDING_RULES.map((rule, i) => (
            <li key={i} className="flex gap-3">
              <span className="shrink-0 font-medium text-neutral-400">{i + 1}.</span>
              <span>{rule}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Veto gates</h2>
        <p className="mb-3 text-xs text-neutral-400">Risk gates, not negative scores — vetoes block overweights only, never force underweights.</p>
        <div className="border border-neutral-200 bg-white">
          {VETO_GATES.map((row, i) => (
            <div key={row.gate} className={`grid grid-cols-[130px_1fr_auto] gap-4 px-4 py-3 text-sm ${i > 0 ? "border-t border-neutral-100" : ""}`}>
              <span className="font-medium text-neutral-900">{row.gate}</span>
              <span className="text-neutral-600">{row.trigger}</span>
              <span className="shrink-0 text-right text-xs text-neutral-400">{row.appliesTo}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
