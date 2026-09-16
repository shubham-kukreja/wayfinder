import type { Snapshot } from "@wayfinder/engine";
import { formatPct } from "../lib/format.js";

// §24-26 of the UX spec ("Methodology screen" / "Standing framework rules"):
// explanatory, philosophy-first content — the model's real configured weights
// and tilt caps, plus the governance rules that apply between reviews. This is
// deliberately READ-ONLY; the editable weights/caps UI lives at
// /model/parameters (ParametersView) — this page explains WHY those numbers
// exist, not how to change them ("explain philosophy, not expose spreadsheet
// plumbing by default," per the spec).
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

const WEIGHT_GROUPS: ReadonlyArray<{ key: "l1" | "equity" | "debt" | "metals" | "sector"; title: string; blurb: string }> = [
  { key: "l1", title: "Asset classes", blurb: "equity vs debt vs metals" },
  { key: "equity", title: "Equity segments", blurb: "across market caps" },
  { key: "debt", title: "Debt buckets", blurb: "duration and credit" },
  { key: "metals", title: "Precious metals", blurb: "gold vs silver" },
  { key: "sector", title: "Sector satellite", blurb: "the optional sleeve" },
];

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

// How the model turns raw data into a weight, in the order it happens. This is
// the spine of the page: a reader who understands only this section already
// understands the system.
const PIPELINE = [
  {
    step: "Observe",
    title: "Each input becomes a percentile",
    body: "Every tracked series — valuations, flows, rates, spreads — is scored against its own history rather than an absolute threshold. A P/E of 22 means nothing on its own; being in the 85th percentile of the last decade means something.",
  },
  {
    step: "Score",
    title: "Percentiles combine into a composite",
    body: "Each node gets one composite out of 100, a weighted blend of its signals. 50 is neutral. The weights are policy, set at an annual review, not something the model tunes for itself.",
  },
  {
    step: "Tilt",
    title: "Distance from 50 becomes a tilt",
    body: "A composite above 50 argues for an overweight, below 50 for an underweight. How far it can actually move is bounded by the tilt cap for that level.",
  },
  {
    step: "Gate",
    title: "Vetoes can block an overweight",
    body: "A risk gate does not produce a score. It removes permission to overweight a node, no matter how attractive the composite looks. It never forces an underweight.",
  },
  {
    step: "Normalise",
    title: "Weights are rebalanced to sum to 100%",
    body: "Capping and vetoing leave the book off-target, so the remaining weights are scaled back to a full allocation. This is why a node's final weight can differ from its raw tilt.",
  },
];

const PRINCIPLES = [
  {
    title: "Relative, not absolute",
    body: "Nothing is judged against a fixed number. Every score is a position within that series' own history, which is what makes the framework portable across regimes.",
  },
  {
    title: "Bounded by design",
    body: "Caps exist so a single loud signal cannot dominate the book. The model is meant to lean, not to swing.",
  },
  {
    title: "Slow on purpose",
    body: "Tilts change on a schedule, not on news. The cadence below is the only route to a change, apart from a veto trigger.",
  },
  {
    title: "Neutral is a real position",
    body: "When signals disagree, the answer is the neutral weight. The model is not obliged to have a view.",
  },
];

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <span className="text-[13px] text-ink-2">{label}</span>
      <span className="text-[13px] font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

export function MethodologyView({ snapshot }: { snapshot: Snapshot }) {
  const { params } = snapshot;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <div className="mb-16 max-w-[72ch] border-b border-line pb-10">
        <p className="text-xs font-bold uppercase tracking-eyebrow text-muted">Workspace</p>
        <h1 className="mt-2 font-display text-3xl text-ink">How this model works</h1>
        <p className="mt-5 text-xl leading-[1.55] text-ink-2">
          This framework decides how much to hold of each asset class, and how far to lean away from a fixed neutral
          position when conditions justify it. It is rules-driven: the same inputs always produce the same allocation,
          and every number on the dashboard can be traced back to a series and a weight.
        </p>
        <p className="mt-4 text-base leading-[1.7] text-ink-2">
          It is not a forecasting model. It does not predict returns. It reads where each market sits relative to its own
          history and leans modestly toward what looks better priced.
        </p>
      </div>

      {/* The pipeline is the spine of the page: five steps, in the order the
          engine performs them, so a new reader can follow one number end to
          end before meeting any configuration tables. */}
      <section className="mb-16 grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="font-display text-xl text-ink">From data to allocation</h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-muted">
            Five steps, in the order they happen. Every weight on the Overview is the output of this sequence.
          </p>
        </div>
        <ol className="border-t border-line">
          {PIPELINE.map((stage, i) => (
            <li key={stage.step} className="grid grid-cols-[auto_1fr] gap-x-6 border-b border-line py-7">
              <div className="flex flex-col items-center">
                <span className="flex h-7 w-7 items-center justify-center bg-ink text-[12px] font-bold tabular-nums text-paper">
                  {i + 1}
                </span>
                {i < PIPELINE.length - 1 && <span className="mt-2 w-px flex-1 bg-line" aria-hidden="true" />}
              </div>
              <div className="max-w-[68ch]">
                <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">{stage.step}</p>
                <h3 className="mt-1 text-[15px] font-semibold text-ink">{stage.title}</h3>
                <p className="mt-2 text-[15px] leading-[1.7] text-ink-2">{stage.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-16 grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="font-display text-xl text-ink">What the framework assumes</h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-muted">
            Four choices that explain most of the model's behaviour.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-x-12 gap-y-9 sm:grid-cols-2 xl:gap-x-16">
          {PRINCIPLES.map((principle) => (
            <div key={principle.title} className="border-t-2 border-ink pt-3">
              <h3 className="text-[15px] font-semibold text-ink">{principle.title}</h3>
              <p className="mt-2 text-[15px] leading-[1.7] text-ink-2">{principle.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-16 grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="font-display text-xl text-ink">When things change</h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-muted">
            Nothing moves between these points, except when a veto gate trips.
          </p>
        </div>
        <div className="border-t border-line">
          {REVIEW_CADENCE.map((row, i) => (
            <div key={i} className="grid grid-cols-[150px_minmax(0,1fr)] gap-8 border-b border-line py-5">
              <span className="text-[13px] font-semibold text-ink">{row.cadence}</span>
              <div className="max-w-[68ch]">
                <p className="text-[15px] leading-[1.6] text-ink-2">{row.activity}</p>
                <p className="mt-0.5 text-[13px] text-muted">{row.note}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-16 grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="font-display text-xl text-ink">Veto gates</h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-muted">
            A veto is a risk gate, not a negative score. It removes permission to overweight a node; it never forces an
            underweight.
          </p>
        </div>
        <div className="border-t border-line">
          {VETO_GATES.map((row) => (
            <div key={row.gate} className="grid grid-cols-[180px_minmax(0,1fr)] gap-8 border-b border-line py-5">
              <span className="text-[13px] font-semibold text-ink">{row.gate}</span>
              <div className="max-w-[68ch]">
                <p className="text-[15px] leading-[1.6] text-ink-2">{row.trigger}</p>
                <p className="mt-0.5 text-[13px] text-muted">Applies to {row.appliesTo.toLowerCase()}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-16 grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="font-display text-xl text-ink">Standing rules</h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-muted">
            Product logic, not display notes — the allocation engine enforces these.
          </p>
        </div>
        <ol className="grid grid-cols-1 gap-x-12 border-t border-line xl:grid-cols-2">
          {STANDING_RULES.map((rule, i) => (
            <li key={i} className="flex gap-5 border-b border-line py-4">
              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-muted">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="max-w-[68ch] text-[15px] leading-[1.7] text-ink-2">{rule}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Live configuration last: the numbers matter, but they are reference
          material once the reader understands what they govern. */}
      <section className="grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="font-display text-xl text-ink">Current configuration</h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-muted">
            The live values behind the rules above. To change them, use{" "}
            <a href="/model/parameters" className="font-medium text-ink underline underline-offset-2">
              Parameters
            </a>
            .
          </p>
        </div>
        <div className="grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <h3 className="mb-3 border-b border-line pb-2 text-[11px] font-bold uppercase tracking-eyebrow text-muted">Tilt caps</h3>
            <StatRow label="L1 asset classes" value={`±${formatPct(params.maxTilt.l1, 0)}`} />
            <StatRow label="Equity segments" value={`±${formatPct(params.maxTilt.equity, 0)}`} />
            <StatRow label="Debt buckets" value={`±${formatPct(params.maxTilt.debt, 0)}`} />
            <StatRow label="Gold / silver split" value={`±${formatPct(params.maxTilt.metals, 0)}`} />
          </div>
          <div>
            <h3 className="mb-3 border-b border-line pb-2 text-[11px] font-bold uppercase tracking-eyebrow text-muted">Sector satellite</h3>
            <StatRow label="Sleeve cap" value={`${formatPct(params.sector.sleeveCap, 0)} of equity`} />
            <StatRow label="Max sectors held" value={String(params.sector.maxSectors)} />
            <StatRow label="Qualification threshold" value={String(params.sector.threshold)} />
            <StatRow label="Forced exit" value={`After ${params.sector.maxConsecutiveQuarters} quarters`} />
          </div>
          {WEIGHT_GROUPS.map((groupDef) => {
            const weights = params.signalWeights[groupDef.key] as Record<string, number>;
            return (
              <div key={groupDef.key}>
                <h3 className="mb-3 border-b border-line pb-2 text-[11px] font-bold uppercase tracking-eyebrow text-muted">
                  {groupDef.title} weights
                </h3>
                {Object.entries(weights)
                  .sort((a, b) => b[1] - a[1])
                  .map(([signal, weight]) => (
                    <StatRow key={signal} label={SIGNAL_LABELS[signal] ?? signal} value={formatPct(weight, 0)} />
                  ))}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
