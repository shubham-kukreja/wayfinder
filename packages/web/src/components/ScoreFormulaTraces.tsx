// Exact calculation breakdowns for the five l1.equity signal cells.
//
// The generic SignalDerivationTrace in CalculationInspector.tsx handles the
// common case: one raw series, percentiled, optionally inverted. None of
// l1.equity's five signals is that case any more —
//   valuation  two percentile parts, then averaged (2 series)
//   macro      a rubric, no series at all
//   flows      a 3M-averaged ratio of two series
//   momentum   a 3-series TRI derivation (kept in CalculationInspector)
//   fundamentals  unsourced, so there is nothing to trace
// so each gets a trace that states the formula the server actually runs,
// mirroring packages/server/src/pipeline/derive.ts + scoreCells.ts.
//
// Every number shown is either read from the snapshot or derived from it
// by the SAME arithmetic the server used — never re-fetched and never
// approximated, so a figure here that disagrees with the score is a real
// bug, not a rounding artefact of the view.
import type { ScoreState, SeriesState } from "@wayfinder/engine";
import { DistributionStrip } from "./DistributionStrip.js";
import { formatScore } from "../lib/format.js";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Span of a series' stored history in years. Observation COUNT can't
// stand in for this — nifty50_pe is daily (645 rows ≈ 2.5 years) while
// gsec_10y is monthly (176 rows ≈ 15 years) — so depth-of-history
// warnings have to measure the calendar span, not the row count.
function historyYears(windowStart: string | null): number | null {
  if (!windowStart) return null;
  const start = new Date(windowStart).getTime();
  if (Number.isNaN(start)) return null;
  return (Date.now() - start) / (365.25 * 24 * 60 * 60 * 1000);
}

function TraceHeading({ signalLabel, children }: { signalLabel: string; children: React.ReactNode }) {
  return (
    <>
      <h3 className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Where {signalLabel} came from</h3>
      <p className="mt-2 text-[13px] leading-5 text-muted">{children}</p>
    </>
  );
}

// The literal formula, set in mono so it reads as the specification it is
// rather than as prose. Kept verbatim from the Calculation Guide.
function Formula({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 overflow-x-auto whitespace-nowrap border-y border-line bg-paper-2 px-3 py-2.5 font-mono text-[12px] leading-5 text-ink">
      {children}
    </p>
  );
}

function InputRow({ id, label, value, state }: { id: string; label: string; value: string; state: SeriesState | undefined }) {
  return (
    <div className="border-b border-line py-2.5 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[13px] text-ink-2">{label}</span>
        <span className="shrink-0 text-[15px] font-semibold tabular-nums text-ink">{value}</span>
      </div>
      <p className="mt-0.5 text-[12px] text-muted">
        {id}
        {state ? ` · ${state.source} · observed ${formatDate(state.latestDate)}` : " · not in snapshot"}
      </p>
    </div>
  );
}

// One numbered step of an arithmetic chain, with the value it produced.
function Step({ n, children, value }: { n: number; children: React.ReactNode; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <p className="text-[12px] leading-5 text-ink-2">
        <span className="font-semibold text-ink">{n}.</span> {children}
      </p>
      {value !== undefined && <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">{value}</span>}
    </div>
  );
}

function FinalScore({ label, score }: { label: string; score: number }) {
  return (
    <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      <span className="text-[15px] font-semibold tabular-nums text-ink">{formatScore(score)}</span>
    </div>
  );
}

// A caveat that materially affects how much to trust the number — not
// decoration. Used where the implementation is knowingly approximate or
// the history behind a percentile is thin.
function Caveat({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 border-l-2 border-warn-500 bg-warn-50 px-3 py-2 text-[12px] leading-5 text-warn-800">{children}</p>;
}

// ── valuation ──────────────────────────────────────────────────────────
// Calculation Guide row 7. Two percentile parts, then averaged. Both
// parts are reconstructed here from each series' own SeriesState
// percentile, which is exactly what the server percentiled.
function ValuationTrace({ series, score }: { series: Record<string, SeriesState>; score: number }) {
  const pe = series["nifty50_pe"];
  const gsec = series["gsec_10y"];
  if (!pe || !gsec || pe.latest === null || gsec.latest === null) return null;

  const earningsYield = 100 / pe.latest;
  const gap = earningsYield - gsec.latest;

  // Part (b) is the P/E series' own percentile, inverted. Part (a) is the
  // GAP series' percentile, which is a derived series with no SeriesState
  // of its own — so it is back-solved from the published score:
  // score = (a + b) / 2  =>  a = 2 * score - b.
  const partB = pe.percentile !== null ? 100 - pe.percentile : null;
  const partA = partB !== null ? 2 * score - partB : null;

  return (
    <section>
      <TraceHeading signalLabel="Valuation">
        Two independent reads on whether equity is cheap, averaged. One compares equity's earnings yield to the bond yield; the
        other asks only whether the P/E itself is high or low by its own history.
      </TraceHeading>

      <Formula>score = (a + b) / 2</Formula>

      <div className="mt-3 border-y border-line">
        <InputRow id="nifty50_pe" label="Nifty 50 trailing P/E" value={pe.latest.toFixed(2)} state={pe} />
        <InputRow id="gsec_10y" label="10Y G-sec yield" value={`${gsec.latest.toFixed(2)}%`} state={gsec} />
      </div>

      {/* Part (a) */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-[12px] font-bold uppercase tracking-eyebrow text-ink">Part (a) — earnings-yield gap</h4>
          {partA !== null && <span className="text-[15px] font-semibold tabular-nums text-ink">{formatScore(partA)}</span>}
        </div>
        <Formula>a = PERCENTRANK(gap history, gap) × 100 &nbsp;·&nbsp; AS-IS</Formula>
        <div className="mt-1">
          <Step n={1} value={`${earningsYield.toFixed(2)}%`}>
            Earnings yield = 100 ÷ {pe.latest.toFixed(2)}
          </Step>
          <Step n={2} value={`${gap >= 0 ? "+" : ""}${gap.toFixed(2)}%`}>
            Gap = {earningsYield.toFixed(2)}% − {gsec.latest.toFixed(2)}%
          </Step>
          <Step n={3} value={partA !== null ? formatScore(partA) : "—"}>
            Rank that gap against its own monthly history. A wide gap means equity is cheap against bonds, so it is{" "}
            <span className="font-semibold text-ink">not</span> inverted.
          </Step>
        </div>
      </div>

      {/* Part (b) */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-[12px] font-bold uppercase tracking-eyebrow text-ink">Part (b) — P/E percentile</h4>
          {partB !== null && <span className="text-[15px] font-semibold tabular-nums text-ink">{formatScore(partB)}</span>}
        </div>
        <Formula>b = 100 − PERCENTRANK(P/E history, P/E) × 100 &nbsp;·&nbsp; INVERTED</Formula>
        {pe.percentile !== null ? (
          <>
            <div className="mt-2.5">
              <DistributionStrip percentile={pe.percentile} />
              <p className="mt-1.5 text-[12px] text-muted">
                {Math.round((pe.percentile / 100) * pe.observations)} of {pe.observations} past readings sit at or below a P/E of{" "}
                {pe.latest.toFixed(2)}
                {pe.windowStart ? `, going back to ${formatDate(pe.windowStart)}` : ""}.
              </p>
            </div>
            <div className="mt-1">
              <Step n={1} value={`${pe.percentile.toFixed(1)}`}>
                P/E percentile
              </Step>
              <Step n={2} value={partB !== null ? formatScore(partB) : "—"}>
                Inverted: 100 − {pe.percentile.toFixed(1)}. A high P/E is expensive, so it scores low.
              </Step>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[12px] text-muted">
            Not enough P/E history to rank yet — {pe.observations} observations stored.
          </p>
        )}
      </div>

      {partA !== null && partB !== null && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[12px] text-ink-2">
              ({formatScore(partA)} + {formatScore(partB)}) / 2
            </span>
            <span className="text-[15px] font-semibold tabular-nums text-ink">{formatScore(score)}</span>
          </div>
        </div>
      )}

      {historyYears(pe.windowStart) !== null && historyYears(pe.windowStart)! < 10 && (
        <Caveat>
          The spec asks for 10–15 years of P/E history; only about {historyYears(pe.windowStart)!.toFixed(1)} years is stored
          {pe.windowStart ? `, starting ${formatDate(pe.windowStart)}` : ""} ({pe.observations} observations). That is too short to
          contain a full valuation cycle, so part (b) ranks against an unrepresentatively narrow range and reads more extreme than
          it should. A niftyindices backfill fixes this — the formula itself is correct.
        </Caveat>
      )}
    </section>
  );
}

// ── flows ──────────────────────────────────────────────────────────────
// §7.1. 3-month average of net flows as % of AUM, percentiled, INVERTED.
// The 3M averaging happens in the pipeline, not the adapter — the stored
// flow series holds a single month despite its `_3m` name.
function FlowsTrace({
  series,
  score,
  flowId,
  aumId,
  ratioId,
  sleeveLabel,
}: {
  series: Record<string, SeriesState>;
  score: number;
  flowId: string;
  aumId: string;
  // The DERIVED 3M-mean-flow / AUM series the score actually percentiles.
  // Published on the snapshot by currentSnapshot.ts precisely so this
  // trace can show the percentile step instead of asserting it.
  ratioId: string;
  sleeveLabel: string;
}) {
  const flow = series[flowId];
  const aum = series[aumId];
  const ratioSeries = series[ratioId];
  if (!flow || !aum) return null;

  const ratio = ratioSeries?.latest ?? null;
  const pct = ratioSeries?.percentile ?? null;
  // The 3M mean is recoverable from the published ratio and the AUM it
  // was divided by, so the smoothed flow can be shown as a number rather
  // than described in prose.
  const mean3m = ratio !== null && aum.latest !== null ? ratio * aum.latest : null;
  const asPct = (v: number) => `${(v * 100).toFixed(3)}%`;

  return (
    <section>
      <TraceHeading signalLabel="Flows">
        A contrarian signal: when everyone is already buying {sleeveLabel}, the easy money has been made. Heavy inflows therefore
        score <span className="font-semibold text-ink">low</span>, not high.
      </TraceHeading>

      <Formula>score = 100 − PERCENTRANK(history, mean(flow, 3 months) ÷ AUM) × 100</Formula>

      <div className="mt-3 border-y border-line">
        <InputRow
          id={flowId}
          label="Net flow, latest month"
          value={flow.latest !== null ? flow.latest.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}
          state={flow}
        />
        <InputRow
          id={aumId}
          label="Category AUM"
          value={aum.latest !== null ? aum.latest.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}
          state={aum}
        />
      </div>

      <div className="mt-1">
        <Step n={1} value={mean3m !== null ? mean3m.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}>
          Average the net flow over the trailing <span className="font-semibold text-ink">3 months</span>. Despite its name, the
          stored <span className="font-mono">{flowId}</span> series holds a single month, so the averaging is applied here in the
          pipeline.
        </Step>
        <Step n={2} value={ratio !== null ? asPct(ratio) : "—"}>
          Divide that 3M mean by the same month&rsquo;s AUM. The flow is smoothed, the AUM is not — AUM is a stock, read at its
          own date.
        </Step>
        <Step n={3} value={pct !== null ? pct.toFixed(1) : "—"}>
          Rank that ratio against its own history
          {ratioSeries ? ` — ${ratioSeries.observations} months since ${formatDate(ratioSeries.windowStart)}` : ""}.
        </Step>
        <Step n={4} value={formatScore(score)}>
          Invert it: <span className="font-mono">100 − {pct !== null ? pct.toFixed(1) : "percentile"}</span>.
        </Step>
      </div>

      <FinalScore label="Flows score" score={score} />

      {/* Detected, not hardcoded to a date: AUM is a slow-moving stock, so
          a single month collapsing by orders of magnitude is a parse
          failure rather than a market event. Shown only while the bad row
          is actually the latest one, so the warning disappears on its own
          once the adapter is fixed and the series refetched. */}
      {aumLooksCorrupt(aum) && (
        <Caveat>
          <span className="font-semibold">This score is not trustworthy right now.</span> The latest{" "}
          <span className="font-mono">{aumId}</span> reading of{" "}
          {aum.latest?.toLocaleString("en-IN", { maximumFractionDigits: 0 })} is roughly three orders of magnitude below the
          previous month — an AMFI parse failure in{" "}
          <span className="font-mono">adapters/amfi.ts</span>, not a real move. Both the flow and the AUM are affected, so the
          ratio is wrong in both directions.
        </Caveat>
      )}
    </section>
  );
}

// AUM is a stock that moves a few percent a month, and these categories
// have grown steadily, so the latest reading should be at or near the top
// of its own history. Sitting at the very BOTTOM after a year or more of
// observations is not a market event — it is the parse failure that
// Aug-2026 produced (AUM off by ~1000x).
//
// Deliberately a shape test, not a hardcoded date: it clears itself once
// the adapter is fixed and the series refetched, and it would catch the
// same break recurring in a different month. It cannot compare against
// the prior month directly — SeriesState carries only the latest point.
function aumLooksCorrupt(aum: SeriesState): boolean {
  return aum.latest !== null && aum.percentile !== null && aum.percentile === 0 && aum.observations >= 24;
}

// ── macro ──────────────────────────────────────────────────────────────
// §8.1. A rubric, not a series: three discrete selections, each a fixed
// delta from a base of 50. Deltas mirror equityMacroScore() in
// packages/engine/src/rubrics.ts exactly.
const MACRO_RUBRIC: Array<{ field: string; options: Array<{ label: string; delta: number }> }> = [
  {
    field: "RBI stance",
    options: [
      { label: "Cutting / about to cut", delta: 20 },
      { label: "On hold", delta: 0 },
      { label: "Hiking / hawkish", delta: -20 },
    ],
  },
  {
    field: "Growth vs. expectations",
    options: [
      { label: "Beating", delta: 10 },
      { label: "In line", delta: 0 },
      { label: "Missing", delta: -10 },
    ],
  },
  {
    field: "Inflation direction",
    options: [
      { label: "Falling toward target", delta: 5 },
      { label: "Rising", delta: -5 },
    ],
  },
];

// Renders any of the "start at 50, add fixed deltas" rubrics from
// rubricInputs, which already carry the field, the chosen option, the
// delta and the reading behind it. Only the blurb and the formula line
// differ per cell, so they are props rather than a second component.
function MacroTrace({
  scoreState,
  score,
  blurb,
  formula,
}: {
  scoreState: ScoreState;
  score: number;
  blurb: string;
  formula: string;
}) {
  const answered = scoreState.provenance === "rubric" || scoreState.provenance === "manual";
  const inputs = scoreState.rubricInputs ?? null;

  return (
    <section>
      <TraceHeading signalLabel="Macro">{blurb}</TraceHeading>

      <Formula>{formula}</Formula>

      {inputs && inputs.length > 0 ? (
        <>
          {/* The actual derivation, not the menu of options. Each row is
              the choice that was made, the reading behind it, and the
              points it contributed — so the total can be checked by
              adding the column up. */}
          <div className="mt-3 border-y border-line">
            <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5">
              <span className="text-[13px] text-ink-2">Base</span>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">50</span>
            </div>
            {inputs.map((input) => (
              <div key={input.field} className="border-b border-line py-2.5 last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-[13px] text-ink-2">
                    {input.field}
                    {": "}
                    <span className="font-semibold text-ink">{input.selected ?? "—"}</span>
                    {input.assumed && (
                      <span className="ml-1.5 rounded-sm bg-warn-50 px-1.5 py-0.5 text-[11px] font-bold text-warn-800">
                        assumed
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 text-[13px] font-semibold tabular-nums ${
                      input.delta > 0 ? "text-brand-800" : input.delta < 0 ? "text-danger-500" : "text-ink-2"
                    }`}
                  >
                    {input.delta > 0 ? "+" : ""}
                    {input.delta}
                  </span>
                </div>
                {input.basis && <p className="mt-1 text-[11px] leading-4 text-muted">{input.basis}</p>}
              </div>
            ))}
          </div>

          <p className="mt-3 font-mono text-[12px] leading-5 text-ink">
            score = 50 {inputs.map((i) => `${i.delta < 0 ? "-" : "+"} ${Math.abs(i.delta)}`).join(" ")} ={" "}
            {formatScore(score)}
          </p>

          {inputs.some((i) => i.assumed) && (
            <Caveat>
              {inputs
                .filter((i) => i.assumed)
                .map((i) => i.field)
                .join(" and ")}{" "}
              {inputs.filter((i) => i.assumed).length > 1 ? "were" : "was"} not derived from any source — the rubric's own
              no-adjustment case was used, so {inputs.filter((i) => i.assumed).length > 1 ? "those inputs" : "that input"}{" "}
              contributes 0 rather than a measured view. An analyst can still override this cell manually.
            </Caveat>
          )}

          <FinalScore label="Macro score" score={score} />
        </>
      ) : (
        <>
          {/* No derived inputs — fall back to documenting the rubric
              itself, which is all there is to show for a cell nobody has
              answered and nothing is computing. */}
          <div className="mt-3 border-y border-line">
            {MACRO_RUBRIC.map((field) => (
              <div key={field.field} className="border-b border-line py-2.5 last:border-0">
                <p className="text-[13px] text-ink-2">{field.field}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                  {field.options.map((opt) => (
                    <span key={opt.label} className="text-[12px] text-muted">
                      {opt.label}{" "}
                      <span
                        className={`font-semibold tabular-nums ${
                          opt.delta > 0 ? "text-brand-800" : opt.delta < 0 ? "text-danger-500" : "text-ink-2"
                        }`}
                      >
                        {opt.delta > 0 ? "+" : ""}
                        {opt.delta}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[12px] leading-5 text-muted">
            Range 15-85. All three must be answered — a partial selection scores nothing rather than defaulting, so the model
            never guesses a macro view nobody expressed.
          </p>

          {answered ? (
            <FinalScore label="Macro score" score={score} />
          ) : (
            <Caveat>
              Nobody has answered this rubric yet, so the cell is sitting at its neutral default of {formatScore(score)}. That is
              a placeholder, not a macro view — it contributes 20% of Equity's composite.
            </Caveat>
          )}
        </>
      )}
    </section>
  );
}

// ── debt momentum ─────────────────────────────────────
// §7.1 l1.debt::momentum — 12-month return of the composite bond index,
// percentiled AS-IS. The ranked quantity is the RETURN, not the index
// level, so bond_index_close gets no strip; bond_index_return_12m
// carries the percentile the score is built from.
function DebtMomentumTrace({ series, score }: { series: Record<string, SeriesState>; score: number }) {
  const index = series["bond_index_close"];
  const ret = series["bond_index_return_12m"];
  if (!index || !ret || ret.latest === null) return null;

  const pct = ret.percentile;

  return (
    <section>
      <TraceHeading signalLabel="Momentum">
        How much the broad Indian government bond index has returned over the past year. A bond index that has been rising is
        positive momentum for debt, so a high return scores high.
      </TraceHeading>

      <Formula>score = PERCENTRANK(12M return history, bond index 12M return) &times; 100 &nbsp;&middot;&nbsp; AS-IS</Formula>

      <div className="mt-3 border-y border-line">
        <InputRow
          id="bond_index_close"
          label="Nifty Composite G-sec Index"
          value={index.latest !== null ? index.latest.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
          state={index}
        />
      </div>

      <div className="mt-1">
        <Step n={1} value={`${ret.latest >= 0 ? "+" : ""}${ret.latest.toFixed(2)}%`}>
          Return over the trailing <span className="font-semibold text-ink">12 months</span>. The index is a total-return series
          — accrued coupon is already in the level — so this is the full return, not just price.
        </Step>
        <Step n={2} value={pct !== null ? pct.toFixed(1) : "—"}>
          Rank that return against its own history — {ret.observations} months since {formatDate(ret.windowStart)}.
        </Step>
        <Step n={3} value={formatScore(score)}>
          High returns are attractive here, so the percentile is used{" "}
          <span className="font-semibold text-ink">as-is</span>, not flipped.
        </Step>
      </div>

      <FinalScore label="Momentum score" score={score} />
    </section>
  );
}

// ── metals flows ──────────────────────────────────────
// §7.1 l1.metals::flows — 3M average of gold ETF net flows, INVERTED.
// Unlike the equity and debt flow cells the spec specifies NO AUM
// denominator, so this is a smoothed flow level, not a ratio.
function MetalsFlowsTrace({ series, score }: { series: Record<string, SeriesState>; score: number }) {
  const flow = series["flow_goldetf"];
  const mean = series["flow_goldetf_3m"];
  if (!flow || !mean || mean.latest === null) return null;

  const pct = mean.percentile;
  const fmt = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 });

  return (
    <section>
      <TraceHeading signalLabel="Flows">
        A contrarian signal: when everyone is already piling into gold ETFs, the easy money has been made. Heavy inflows
        therefore score <span className="font-semibold text-ink">low</span>, not high.
      </TraceHeading>

      <Formula>score = 100 &minus; PERCENTRANK(history, mean(gold ETF net flow, 3 months)) &times; 100</Formula>

      <div className="mt-3 border-y border-line">
        <InputRow
          id="flow_goldetf"
          label="Gold ETF net flow, latest month"
          value={flow.latest !== null ? fmt(flow.latest) : "—"}
          state={flow}
        />
      </div>

      <div className="mt-1">
        <Step n={1} value={fmt(mean.latest)}>
          Average the net flow over the trailing <span className="font-semibold text-ink">3 months</span>. The stored{" "}
          <span className="font-mono">flow_goldetf</span> series holds a single month, so the averaging happens in the pipeline.
        </Step>
        <Step n={2} value={pct !== null ? pct.toFixed(1) : "—"}>
          Rank it against its own history — {mean.observations} months since {formatDate(mean.windowStart)}. No AUM
          denominator: unlike the equity and debt flow cells, the spec asks for a flow level, not a share of assets.
        </Step>
        <Step n={3} value={formatScore(score)}>
          Invert it: <span className="font-mono">100 &minus; {pct !== null ? pct.toFixed(1) : "percentile"}</span>.
        </Step>
      </div>

      <FinalScore label="Flows score" score={score} />
    </section>
  );
}

// ── metals macro / cycle support ──────────────────────
// §8.4 l1.metals::macro — six-month change in the US 10Y
// real yield (FRED DFII10), mapped through five fixed bands. This is a
// lookup rubric, not a percentile, so the trace shows raw yields and the
// basis-point arithmetic and deliberately draws no distribution strip.
function MetalsMacroTrace({ series, score }: { series: Record<string, SeriesState>; score: number }) {
  const realYield = series["us_real_10y"];
  const change = series["us_real_10y_6m_change_bp"];
  if (!realYield || realYield.latest === null || !change || change.latest === null) return null;

  const changeBp = change.latest;
  const pastYield = realYield.latest - changeBp / 100;
  const band =
    changeBp < -50
      ? "Fallen more than 50bp"
      : changeBp < -10
        ? "Fallen 10–50bp"
        : changeBp <= 10
          ? "Flat (±10bp)"
          : changeBp <= 50
            ? "Risen 10–50bp"
            : "Risen more than 50bp";
  const signedBp = `${changeBp >= 0 ? "+" : ""}${changeBp.toFixed(1)}bp`;

  return (
    <section>
      <TraceHeading signalLabel="Macro / cycle support">
        Falling US real yields reduce the opportunity cost of holding gold, so declines score high and rises score low.
      </TraceHeading>

      <Formula>
        change (bp) = (current DFII10 &minus; DFII10 six months earlier) &times; 100; score = LOOKUP(change)
      </Formula>

      <div className="mt-3 border-y border-line">
        <InputRow
          id="us_real_10y"
          label="US 10Y real yield (TIPS)"
          value={`${realYield.latest.toFixed(2)}%`}
          state={realYield}
        />
      </div>

      <div className="mt-1">
        <Step n={1} value={`${pastYield.toFixed(2)}%`}>
          Take the closest published DFII10 reading at or before the date six months earlier.
        </Step>
        <Step n={2} value={signedBp}>
          ({realYield.latest.toFixed(2)}% &minus; {pastYield.toFixed(2)}%) &times; 100.
        </Step>
        <Step n={3} value={formatScore(score)}>
          Selected band: <span className="font-semibold text-ink">{band}</span>.
        </Step>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-1 border-t border-line pt-3 text-[11px] text-muted sm:grid-cols-5">
        <span>&lt; &minus;50bp &rarr; 75</span>
        <span>&minus;50 to &lt; &minus;10bp &rarr; 60</span>
        <span>&minus;10 to +10bp &rarr; 50</span>
        <span>&gt; +10 to +50bp &rarr; 40</span>
        <span>&gt; +50bp &rarr; 25</span>
      </div>

      <FinalScore label="Macro score" score={score} />
    </section>
  );
}

function MetalsRatioTrace({ series, score, inverted }: { series: Record<string, SeriesState>; score: number; inverted: boolean }) {
  const ratio = series["gold_silver_ratio_20y"];
  const gold = series["gold_usd_futures"];
  const silver = series["silver_usd_futures"];
  const hasRatio = !!ratio && ratio.latest !== null;
  const pct = ratio?.percentile ?? null;
  return <section>
    <TraceHeading signalLabel="Gold/silver ratio position">The ratio is ranked against its trailing 20-year history; high ratios favour silver and are inverted for gold.</TraceHeading>
    <Formula>ratio = gold futures ÷ silver futures; score = {inverted ? "100 − " : ""}PERCENTRANK(ratio, trailing 20Y)</Formula>
    <div className="mt-3 border-y border-line">
      <InputRow id="gold_usd_futures" label="Gold futures" value={gold?.latest === null || !gold ? "—" : gold.latest.toFixed(2)} state={gold} />
      <InputRow id="silver_usd_futures" label="Silver futures" value={silver?.latest === null || !silver ? "—" : silver.latest.toFixed(2)} state={silver} />
    </div>
    <div className="mt-1"><Step n={1} value={hasRatio ? ratio!.latest!.toFixed(2) : "—"}>Divide gold by silver to get the live ratio.</Step><Step n={2} value={hasRatio ? (pct === null ? "—" : pct.toFixed(1)) : "—"}>{hasRatio ? `Rank across ${ratio!.observations} observations since ${formatDate(ratio!.windowStart)}.` : "The derived 20-year ratio is not present in this snapshot yet."}</Step><Step n={3} value={formatScore(score)}>{inverted ? "Invert the percentile for gold." : "Use the percentile as-is for silver."}</Step></div>
    <FinalScore label="Ratio-position score" score={score} />
  </section>;
}

function MetalsRealRatesTrace({ series, score }: { series: Record<string, SeriesState>; score: number }) {
  const yieldSeries = series["us_real_10y"]; const change = series["us_real_10y_6m_change_bp"];
  if (!yieldSeries || yieldSeries.latest === null || !change || change.latest === null) return null;
  const past = yieldSeries.latest - change.latest / 100;
  const band = change.latest > 50 ? "Risen more than 50bp" : change.latest > 10 ? "Risen 10–50bp" : change.latest >= -10 ? "Flat (±10bp)" : change.latest >= -50 ? "Fallen 10–50bp" : "Fallen more than 50bp";
  return <section><TraceHeading signalLabel="US 10Y real-yield cycle">The six-month change in FRED DFII10 is mapped to the metal-specific rubric bands.</TraceHeading><Formula>change (bp) = (current DFII10 − DFII10 six months earlier) × 100; score = LOOKUP(change)</Formula><div className="mt-3 border-y border-line"><InputRow id="us_real_10y" label="US 10Y real yield (TIPS)" value={`${yieldSeries.latest.toFixed(2)}%`} state={yieldSeries} /></div><div className="mt-1"><Step n={1} value={`${past.toFixed(2)}%`}>Closest DFII10 reading six months earlier.</Step><Step n={2} value={`${change.latest >= 0 ? "+" : ""}${change.latest.toFixed(1)}bp`}>Six-month basis-point change.</Step><Step n={3} value={formatScore(score)}>Selected band: <span className="font-semibold text-ink">{band}</span>.</Step></div><FinalScore label="Real-rates score" score={score} /></section>;
}

function GoldIndustrialTrace({ score }: { score: number }) { return <section><TraceHeading signalLabel="Gold industrial demand">The workbook specifies gold industrial demand as neutral; no live external feed is required.</TraceHeading><Formula>score = 50 (static neutral)</Formula><FinalScore label="Industrial score" score={score} /></section>; }

function SilverIndustrialTrace({ scoreState, score }: { scoreState: ScoreState; score: number }) { return <section><TraceHeading signalLabel="Silver industrial demand">Silver uses the global manufacturing PMI band, plus the qualitative solar/EV capex adjustment.</TraceHeading><Formula>score = PMI band + capex adjustment</Formula><div className="mt-3 border-y border-line">{(scoreState.rubricInputs ?? []).map((input) => <div key={input.field} className="border-b border-line py-2.5 last:border-0"><div className="flex justify-between gap-3 text-[13px]"><span>{input.field}</span><span className="font-semibold">{input.selected} ({input.delta >= 0 ? "+" : ""}{input.delta})</span></div><p className="mt-0.5 text-[12px] text-muted">{input.basis}</p></div>)}</div><FinalScore label="Industrial score" score={score} /></section>; }

// ── metals momentum ───────────────────────────────────
// §7.4 l1.metals::momentum — INR gold 12M return,
// percentiled AS-IS, with an independent >40% six-month parabolic veto.
// Both return series are published from the same monthly
// gold_usd_futures x usd_inr construction used by the server.
function MetalsMomentumTrace({ series, score }: { series: Record<string, SeriesState>; score: number }) {
  const gold = series["gold_usd_futures"];
  const fx = series["usd_inr"];
  const return12m = series["gold_return_12m_inr"];
  const return6m = series["gold_return_6m_inr"];
  if (!return12m || return12m.latest === null) return null;

  const pct = return12m.percentile;
  const sixMonth = return6m?.latest ?? null;
  const vetoActive = sixMonth !== null && sixMonth > 0.4;
  const asReturn = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;

  return (
    <section>
      <TraceHeading signalLabel="Momentum">
        Gold&rsquo;s rupee return over the past year, ranked against its own history. The score uses the percentile as-is, while a
        separate six-month surge above 40% activates the parabolic veto regardless of the score.
      </TraceHeading>

      <Formula>score = PERCENTRANK(INR 12M return history, INR 12M return) &times; 100 &nbsp;&middot;&nbsp; AS-IS</Formula>

      {(gold || fx) && (
        <div className="mt-3 border-y border-line">
          {gold && (
            <InputRow
              id="gold_usd_futures"
              label="Gold futures, USD/oz"
              value={gold.latest !== null ? gold.latest.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
              state={gold}
            />
          )}
          {fx && (
            <InputRow id="usd_inr" label="USD/INR" value={fx.latest !== null ? fx.latest.toFixed(2) : "—"} state={fx} />
          )}
        </div>
      )}

      <div className="mt-1">
        <Step n={1}>Build one month-end INR gold series as gold USD &times; USD/INR.</Step>
        <Step n={2} value={asReturn(return12m.latest)}>
          Calculate the trailing <span className="font-semibold text-ink">12-month INR return</span>.
        </Step>
        <Step n={3} value={pct !== null ? pct.toFixed(1) : "—"}>
          Rank that return against {return12m.observations} historical 12-month readings since {formatDate(return12m.windowStart)}.
        </Step>
        <Step n={4} value={formatScore(score)}>
          Strong momentum is attractive, so use the percentile as-is.
        </Step>
      </div>

      {pct !== null && (
        <div className="mt-2.5">
          <DistributionStrip percentile={pct} />
          <p className="mt-1.5 text-[12px] text-muted">
            {Math.round((pct / 100) * return12m.observations)} of {return12m.observations} historical returns were at or below {asReturn(return12m.latest)}.
          </p>
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-semibold text-ink">Parabolic veto: INR return over 6 months</span>
          <span className={`text-[13px] font-semibold tabular-nums ${vetoActive ? "text-danger-500" : "text-ink"}`}>
            {sixMonth !== null ? asReturn(sixMonth) : "—"}
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-5 text-muted">
          Threshold: &gt; +40.00% &rarr; {vetoActive ? "veto active" : sixMonth === null ? "not enough history" : "veto not active"}.
        </p>
      </div>

      <FinalScore label="Momentum score" score={score} />
    </section>
  );
}

// ── metals valuation ──────────────────────────────────
// §8.4 l1.metals::valuation — INR gold price deflated by CPI (the real
// gold price), percentiled and INVERTED: expensive gold is unattractive.
//
// The ranked quantity is the DEFLATED series, so no leg's own percentile
// is an input and none gets a strip — gold_usd_futures reads 98.2 and
// cpi_index 56.0 against a cell scoring 0, and gold_inr holds too few
// rows to percentile at all. real_gold_inr carries the percentile the
// score is actually built from.
function MetalsValuationTrace({ series, score }: { series: Record<string, SeriesState>; score: number }) {
  const real = series["real_gold_inr"];
  // The SPLICED CPI, which is the deflator the score actually divided
  // by. The stored cpi_index's latest row is on RBI's post-rebase base
  // (~104.84 vs the spliced ~162.8), so showing it here would restate
  // the arithmetic wrong by the splice factor.
  const cpi = series["cpi_index_spliced"] ?? series["cpi_index"];
  const goldInr = series["gold_inr"];
  if (!real || real.latest === null || real.latestDate === null) return null;

  const pct = real.percentile;

  // gold_inr is IBJA spot and currently holds only a handful of rows, so
  // deriveRealGoldPriceSeries falls back to a SYNTHETIC INR price built
  // from COMEX futures x USD/INR. Say which path produced the number
  // instead of implying a direct IBJA quote.
  const usedSynthetic = (goldInr?.observations ?? 0) < 24;

  return (
    <section>
      <TraceHeading signalLabel="Valuation / carry">
        The INR gold price with inflation taken out. Gold that is expensive against its own inflation-adjusted history is
        unattractive, so a high real price scores <span className="font-semibold text-ink">low</span>.
      </TraceHeading>

      <Formula>
        score = 100 &minus; PERCENTRANK(real gold history, gold &#8377; &divide; CPI index) &times; 100 &nbsp;&middot;&nbsp;
        INVERTED
      </Formula>

      <div className="mt-3 border-y border-line">
        {usedSynthetic ? (
          <>
            <InputRow
              id="gold_usd_futures"
              label="Gold, USD/oz (COMEX)"
              value={series["gold_usd_futures"]?.latest?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}
              state={series["gold_usd_futures"]}
            />
            <InputRow
              id="usd_inr"
              label="USD/INR"
              value={series["usd_inr"]?.latest?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}
              state={series["usd_inr"]}
            />
          </>
        ) : (
          <InputRow
            id="gold_inr"
            label="Gold, &#8377; (IBJA spot)"
            value={goldInr?.latest?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}
            state={goldInr}
          />
        )}
        <InputRow
          id={series["cpi_index_spliced"] ? "cpi_index_spliced" : "cpi_index"}
          label="CPI index (spliced FRED + RBI)"
          value={cpi?.latest?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}
          state={cpi}
        />
      </div>

      <div className="mt-1">
        {usedSynthetic && (
          <Step n={1}>
            Build an INR gold price as{" "}
            <span className="font-mono">gold_usd_futures &times; usd_inr</span>. The direct IBJA quote
            (<span className="font-mono">gold_inr</span>) holds only {goldInr?.observations ?? 0} readings — far too few to
            percentile — so the COMEX-and-FX construction supplies the history instead.
          </Step>
        )}
        <Step n={usedSynthetic ? 2 : 1} value={real.latest.toFixed(2)}>
          Divide that INR price by the CPI index for the same month. This is the real (inflation-adjusted) gold price — an
          index level, not rupees.
        </Step>
        <Step n={usedSynthetic ? 3 : 2} value={pct !== null ? pct.toFixed(1) : "—"}>
          Rank it against its own history — {real.observations} months since {formatDate(real.windowStart)}.
        </Step>
        <Step n={usedSynthetic ? 4 : 3} value={formatScore(score)}>
          Invert it: <span className="font-mono">100 &minus; {pct !== null ? pct.toFixed(1) : "percentile"}</span>. Expensive
          gold is unattractive, so the percentile is flipped.
        </Step>
      </div>

      <FinalScore label="Valuation / carry score" score={score} />

      {/* Not a DistributionStrip: no leg's own percentile is an input
          here. See the comment above this component. */}
      <p className="mt-3 text-[12px] leading-5 text-muted">
        Neither leg&rsquo;s own percentile is used — only the percentile of the deflated series.
      </p>

      {pct !== null && pct >= 100 && (
        <Caveat>
          The real gold price is at the <span className="font-semibold">highest level in its entire recorded history</span>, so
          the percentile is pinned at 100 and the score at 0. That is a real reading, not a computation error — but it also
          means the signal cannot distinguish &ldquo;expensive&rdquo; from &ldquo;more expensive&rdquo; until the price comes
          off its high.
        </Caveat>
      )}
    </section>
  );
}

// ── debt valuation ──────────────────────────────────────
// §7.1 l1.debt::valuation — real 10Y yield (gsec_10y − cpi_yoy),
// percentiled AS-IS. High real yield = attractive, so it is NOT inverted
// (the §15.1 trap, opposite of the equity valuation convention).
//
// Why this needs its own trace rather than the generic one: the generic
// SignalDerivationTrace assumes ONE raw series and renders
// derivedFrom[0]'s own DistributionStrip. Here the percentile is taken
// over the DERIVED real-yield series, so each raw leg's own percentile is
// not an input to the score at all — showing it actively misleads
// (confirmed live 2026-09-19: gsec_10y's own percentile reads 28.6 while
// the cell scores 70, and cpi_yoy has only 5 stored observations so its
// strip renders empty, implying "insufficient history" for a cell that is
// in fact "ok"). The strips are dropped here in favour of the numbers the
// calculation actually uses.
function DebtValuationTrace({ series, score }: { series: Record<string, SeriesState>; score: number }) {
  const gsec = series["gsec_10y"];
  const cpi = series["cpi_yoy"];
  const real = series["real_gsec_10y"];
  if (!gsec || gsec.latest === null || !real || real.latest === null) return null;

  // The two legs are joined BY YEAR-MONTH, so the CPI print that entered
  // the arithmetic is the one for the real-yield observation's month —
  // NOT necessarily cpi_yoy's latest stored row, which routinely runs a
  // month ahead of the G-sec series (live 2026-09-19: CPI had an August
  // print while the score was computed on July). Back it out of the
  // subtraction the server actually performed instead of displaying a
  // print the cell never used.
  const cpiUsed = gsec.latest - real.latest;
  const cpiIsLatestRow =
    cpi?.latestDate != null && real.latestDate != null && cpi.latestDate.slice(0, 7) === real.latestDate.slice(0, 7);

  return (
    <section>
      <TraceHeading signalLabel="Valuation / carry">
        What the 10Y government bond pays after inflation is taken out. A high real yield means bonds are paying you well to
        lend, so it scores high &mdash; the opposite of how a high equity P/E reads.
      </TraceHeading>

      <Formula>score = PERCENTRANK(real yield history, 10Y G-sec &minus; CPI YoY) &times; 100 &nbsp;&middot;&nbsp; AS-IS</Formula>

      <div className="mt-3 border-y border-line">
        <InputRow id="gsec_10y" label="10Y G-sec yield" value={`${gsec.latest.toFixed(2)}%`} state={gsec} />
        <InputRow
          id="cpi_yoy"
          label={`CPI inflation, YoY${cpiIsLatestRow ? "" : " (month matched to the yield)"}`}
          value={`${cpiUsed.toFixed(2)}%`}
          state={cpiIsLatestRow ? cpi : undefined}
        />
      </div>

      <div className="mt-1">
        <Step n={1} value={`${real.latest >= 0 ? "+" : ""}${real.latest.toFixed(2)}%`}>
          Real yield = {gsec.latest.toFixed(2)}% &minus; {cpiUsed.toFixed(2)}%
        </Step>
        <Step n={2} value={formatScore(score)}>
          Rank that real yield against its own history. High real yield is attractive, so the percentile is used{" "}
          <span className="font-semibold text-ink">as-is</span>, not flipped.
        </Step>
      </div>

      {/* Deliberately a COUNT, not a DistributionStrip. The bar could only
          be drawn from a raw leg's percentile, and neither leg's percentile
          is an input here — gsec_10y's own reads 28.6 against a cell
          scoring 70, and cpi_yoy has too few stored rows to percentile at
          all, so its strip renders empty and implies a history problem the
          cell does not have. */}
      <p className="mt-3 text-[12px] leading-5 text-muted">
        <span className="font-semibold text-ink">
          {Math.round((real.percentile ?? score) / 100 * real.observations)} of {real.observations}
        </span>{" "}
        past months had a real yield at or below {real.latest.toFixed(2)}%
        {real.windowStart ? `, going back to ${formatDate(real.windowStart)}` : ""}. Neither leg&rsquo;s own percentile is used
        &mdash; only the percentile of the subtraction.
      </p>

      {!cpiIsLatestRow && cpi?.latestDate && (
        <Caveat>
          A newer CPI print for {formatDate(cpi.latestDate)} ({cpi.latest?.toFixed(2)}%) is already stored, but the 10Y yield
          only runs to {formatDate(real.latestDate)}. The score uses the matching month, so it will move when the yield catches
          up.
        </Caveat>
      )}

      <FinalScore label="Valuation / carry score" score={score} />
    </section>
  );
}

// ── fundamentals ───────────────────────────────────────────────────────
// §8.1. Specified, but no source exists for its input anywhere in the
// project — so this trace documents the formula and says plainly that
// nothing is computing it.
function FundamentalsTrace({ score }: { score: number }) {
  return (
    <section>
      <TraceHeading signalLabel="Fundamentals">
        Earnings revision breadth — what share of analyst estimate changes are upgrades rather than downgrades, across the Nifty
        100.
      </TraceHeading>

      <Formula>score = PERCENTRANK(breadth history, upgrades ÷ (upgrades + downgrades)) × 100 &nbsp;·&nbsp; AS-IS</Formula>

      <p className="mt-3 text-[12px] leading-5 text-muted">
        Documented fallback if breadth cannot be sourced: the % change in consensus FY+1 EPS over the last 3 months, percentiled
        the same way.
      </p>

      <Caveat>
        <span className="font-semibold">No source is wired for this signal.</span> Revision breadth is published in brokerage
        strategy notes and on ACE Equity / Bloomberg, none of which this project fetches — and unlike other gaps, no candidate
        source has been researched yet. The cell is sitting at {formatScore(score)} and contributes 20% of Equity's composite. The
        same missing data blocks 12 other <span className="font-mono">revisions</span> cells across the equity and sector groups.
      </Caveat>
    </section>
  );
}

// ── momentum ───────────────────────────────────────────────────────────
// §8.1 (Calculation Guide row 11). Three series, TRI-approximated.
// Mirrors deriveNiftyMomentumSeries() in derive.ts.
function MomentumTrace({ series, score }: { series: Record<string, SeriesState>; score: number }) {
  const close = series["nifty50_close"];
  const divYield = series["nifty50_div_yield"];
  const gsec = series["gsec_10y"];
  if (!close || !divYield || !gsec || close.latest === null || divYield.latest === null || gsec.latest === null) return null;

  return (
    <section>
      <TraceHeading signalLabel="Momentum">
        Equity's total return over the trailing year, less the risk-free rate, ranked against its own history.
      </TraceHeading>

      <Formula>score = PERCENTRANK(history, TRI 12M return × 100 − 10Y yield) × 100 &nbsp;·&nbsp; AS-IS</Formula>

      <div className="mt-3 border-y border-line">
        <InputRow id="nifty50_close" label="Nifty 50 close" value={close.latest.toLocaleString("en-IN")} state={close} />
        <InputRow id="nifty50_div_yield" label="Trailing dividend yield" value={`${divYield.latest}%`} state={divYield} />
        <InputRow id="gsec_10y" label="10Y G-sec yield" value={`${gsec.latest.toFixed(2)}%`} state={gsec} />
      </div>

      <div className="mt-1">
        <Step n={1}>TRI return ≈ (12M price return) × (1 + dividend yield) − 1</Step>
        <Step n={2}>Excess return = TRI return × 100 − {gsec.latest.toFixed(2)}%</Step>
        <Step n={3} value={formatScore(score)}>
          Rank that excess-return history as-is — persistent strength scores positively, so it is not inverted.
        </Step>
      </div>

      <FinalScore label="Momentum score" score={score} />

      <Caveat>
        The TRI is an approximation, not a reconstruction: no free Nifty 50 total-return source exists, so this applies one
        point-in-time dividend yield across the whole trailing year. It diverges from AMFI's published TRI whenever yield itself
        moved materially.
      </Caveat>
    </section>
  );
}

// Dispatches to the right bespoke trace for a score cell. Returns null for
// cells that don't have one, so every caller can fall back to its own
// generic rendering rather than this module deciding what that fallback is.
//
// Used by BOTH the allocation inspector (CalculationInspector.tsx) and the
// Data Point Control Center's "View exact formula" modal, so the formula a
// reader sees is the same text in both places — there is no second copy to
// drift out of step with the server.
// Calculation Guide, SECTOR SATELLITE: "Sector index (Nifty Bank, Nifty
// IT, etc.) trailing P/E — or P/B for financials — percentile vs its own
// 10Y history, INVERTED."
//
// This needs its own trace rather than the generic one-series percentile
// in CalculationInspector, for one reason that matters: the generic
// trace reads SeriesState.percentile, which is computed over the series'
// ENTIRE stored history, while the score is computed over the 10-year
// WINDOW. Where stored history is shorter than the window those agree,
// but the moment backfill passes 10 years they diverge, and the trace
// would quietly display a percentile that is not the one that produced
// the score. Deriving the displayed percentile FROM the score (as below)
// cannot drift.
function SectorValuationTrace({
  scoreState,
  series,
  score,
  sectorLabel,
}: {
  scoreState: ScoreState;
  series: SeriesState | undefined;
  score: number;
  sectorLabel: string;
}) {
  const seriesId = scoreState.derivedFrom[0];
  const spanYears = scoreState.historySpanYears ?? null;
  const shortfall = scoreState.historyShortfall === true;
  // Inverted cell: the score IS 100 − percentile, so this is exact.
  const rawPercentile = 100 - score;

  return (
    <section>
      <TraceHeading signalLabel={`${sectorLabel} valuation`}>
        How expensive the sector's own earnings multiple is versus its own past — not versus other sectors. A sector
        can be the cheapest in the market and still score badly here if it is dear by its own standards.
      </TraceHeading>

      <Formula>score = 100 − PERCENTRANK({seriesId}, 10Y window) × 100</Formula>

      <div className="mt-3">
        <InputRow
          id={seriesId ?? "—"}
          label={`${sectorLabel} trailing P/E`}
          value={series?.latest !== null && series?.latest !== undefined ? series.latest.toFixed(2) : "—"}
          state={series}
        />
      </div>

      <div className="mt-3">
        <Step n={1} value={`${rawPercentile.toFixed(1)}%ile`}>
          Rank today's P/E against its own history. {series?.observations ?? 0} readings
          {spanYears !== null ? `, spanning ${spanYears.toFixed(1)} years` : ""}.
        </Step>
        <Step n={2} value={formatScore(score)}>
          Invert — a high multiple is unattractive, so <span className="tabular-nums">100 − {rawPercentile.toFixed(1)}</span>.
        </Step>
      </div>

      {/* The strip is legitimate here: this cell percentiles the series
          ITSELF (seriesRole "percentile"), not a derivation of it. */}
      {series?.percentile !== null && series?.percentile !== undefined && (
        <div className="mt-3">
          <DistributionStrip percentile={rawPercentile} />
        </div>
      )}

      {shortfall && (
        <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
          <span className="font-semibold">Provisional.</span> The workbook asks for a 10-year window; only{" "}
          {spanYears !== null ? `${spanYears.toFixed(1)} years` : "a partial history"} of {seriesId} is stored, because
          niftyindices' Daily Snapshot backfill starts in August 2024 and NSE publishes no index history at all. The
          ranking is real but shallow — it will move as history accumulates, and a percentile drawn from two years
          cannot distinguish a cyclical extreme from a normal one.
        </p>
      )}
    </section>
  );
}

// Calculation Guide "Valuation vs own history":
// "Segment index trailing P/E percentile vs its own 10-15Y monthly
// history, INVERTED: attractiveness = 100 - PERCENTRANK x 100.
// Optionally average with the same on P/B."
//
// Bespoke rather than generic for two reasons. First, the same one the
// sector trace documents: the generic trace reads SeriesState.percentile,
// computed over the series' ENTIRE stored history, while the score is
// computed over a 10-year MONTH-END sample. Those now differ materially
// (the store holds ~740 daily rows against 119 monthly ones), so a
// generic trace would display a percentile that did not produce the
// score. Second, this cell averages TWO inverted percentiles, and the
// average is not recoverable from the final score alone — each leg's
// own percentile has to be read from its series state and shown.
function SegmentValuationTrace({
  scoreState,
  series,
  score,
  segmentLabel,
}: {
  scoreState: ScoreState;
  series: Record<string, SeriesState>;
  score: number;
  segmentLabel: string;
}) {
  const peId = scoreState.derivedFrom.find((id) => id.endsWith("_pe"));
  const pbId = scoreState.derivedFrom.find((id) => id.endsWith("_pb"));
  const pe = peId ? series[peId] : undefined;
  const pb = pbId ? series[pbId] : undefined;
  const spanYears = scoreState.historySpanYears ?? null;
  const shortfall = scoreState.historyShortfall === true;
  const legCount = (peId ? 1 : 0) + (pbId ? 1 : 0);

  return (
    <section>
      <TraceHeading signalLabel={`${segmentLabel} valuation vs own history`}>
        How expensive this segment's own multiples are versus its own past — not versus other segments. A segment can
        be the cheapest in the market and still score badly here if it is dear by its own standards.
      </TraceHeading>

      <Formula>
        {legCount > 1
          ? "score = mean of (100 − PERCENTRANK(P/E) × 100, 100 − PERCENTRANK(P/B) × 100), 10Y month-end"
          : "score = 100 − PERCENTRANK(P/E, 10Y month-end) × 100"}
      </Formula>

      <div className="mt-3">
        {peId && (
          <InputRow
            id={peId}
            label={`${segmentLabel} trailing P/E`}
            value={pe?.latest !== null && pe?.latest !== undefined ? pe.latest.toFixed(2) : "—"}
            state={pe}
          />
        )}
        {pbId && (
          <InputRow
            id={pbId}
            label={`${segmentLabel} P/B`}
            value={pb?.latest !== null && pb?.latest !== undefined ? pb.latest.toFixed(2) : "—"}
            state={pb}
          />
        )}
      </div>

      <div className="mt-3">
        <Step n={1} value={legCount > 1 ? "two legs" : "one leg"}>
          Rank each multiple against its own 10-year month-end history and invert it, so a high multiple scores low.
          {spanYears !== null ? ` History spans ${spanYears.toFixed(1)} years.` : ""}
        </Step>
        <Step n={2} value={formatScore(score)}>
          {legCount > 1
            ? "Average the two inverted percentiles — the spec's “optionally average with the same on P/B”."
            : "Only one multiple has enough history here, so it carries the score alone."}
        </Step>
      </div>

      <p className="mt-3 text-[12px] leading-5 text-ink-2">
        Sampled month-end, one reading per month. The raw feed is daily since August 2024 but month-end before it, so
        ranking every stored row would weight the last two years roughly twenty times as heavily per unit of calendar
        time as the eight before them.
      </p>

      {shortfall && (
        <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
          <span className="font-semibold">Provisional.</span> The workbook asks for a 10-15 year window; only{" "}
          {spanYears !== null ? `${spanYears.toFixed(1)} years` : "a partial history"} is stored. The ranking is real
          but shallow, and will move as history accumulates.
        </p>
      )}
    </section>
  );
}

// Calculation Guide "Valuation vs own history" (International):
// "use S&P 500 forward P/E vs its own history, inverted; then subtract
// 5-10 points if the India-US valuation gap is at an extreme favouring
// India, add if favouring US."
//
// States the trailing-for-forward substitution ON THE FACE of the trace.
// The score is defensible, but only if the reader knows which multiple
// was ranked — 26.07 trailing and 18.66 forward are both "the S&P 500's
// P/E" and they rank quite differently.
function IntlValuationTrace({
  scoreState,
  series,
  score,
}: {
  scoreState: ScoreState;
  series: Record<string, SeriesState>;
  score: number;
}) {
  const sp = series["sp500_trailing_pe"];
  const gap = series["india_us_valuation_gap"];
  const spanYears = scoreState.historySpanYears ?? null;
  const shortfall = scoreState.historyShortfall === true;
  const hasGapLeg = scoreState.derivedFrom.includes("nifty100_pe");

  // Read the applied adjustment off the cell; do NOT re-derive it from
  // the gap series' published percentile. Those are two different
  // numbers: the server selects the band using a 10Y MONTH-END window,
  // while SeriesState.percentile is computed over the entire stored
  // history (3.4 vs 10.2 live on 2026-09-20 — different bands, -10 vs
  // -5). Re-deriving would print an adjustment that never entered the
  // score, which is exactly what §8 invariant 6 forbids.
  const gapInput = scoreState.rubricInputs?.find((r) => r.field === "India-US valuation gap");
  const adjustment = gapInput?.delta ?? 0;
  const gapBasis = gapInput?.basis ?? null;
  const gapAssumed = gapInput?.assumed === true;
  const beforeAdjustment = score - adjustment;

  return (
    <section>
      <TraceHeading signalLabel="International valuation vs own history">
        How expensive US equities are versus their own past, then nudged by how far Indian and US multiples have
        diverged from their usual relationship.
      </TraceHeading>

      <Formula>score = (100 − PERCENTRANK(S&amp;P P/E, 10Y month-end) × 100) ± India–US gap adjustment</Formula>

      <div className="mt-3">
        <InputRow
          id="sp500_trailing_pe"
          label="S&P 500 trailing P/E"
          value={sp?.latest !== null && sp?.latest !== undefined ? sp.latest.toFixed(2) : "—"}
          state={sp}
        />
        {hasGapLeg && (
          <InputRow
            id="india_us_valuation_gap"
            label="India − US P/E gap"
            value={gap?.latest !== null && gap?.latest !== undefined ? gap.latest.toFixed(2) : "—"}
            state={gap}
          />
        )}
      </div>

      <div className="mt-3">
        <Step n={1} value={formatScore(beforeAdjustment)}>
          Rank the S&P 500's trailing P/E against its own 10-year month-end history and invert it.
          {spanYears !== null ? ` History spans ${spanYears.toFixed(1)} years.` : ""}
        </Step>
        <Step n={2} value={adjustment === 0 ? "no adjustment" : `${adjustment > 0 ? "+" : ""}${adjustment}`}>
          {adjustment < 0
            ? "India is unusually cheap against the US — an extreme favouring India, so international is marked down. "
            : adjustment > 0
              ? "India is unusually dear against the US — an extreme favouring the US, so international is marked up. "
              : gapAssumed
                ? ""
                : "The gap is not at an extreme, so nothing is added or subtracted. "}
          {gapBasis}
        </Step>
        <Step n={3} value={formatScore(score)}>
          Clamped to 0–100.
        </Step>
      </div>

      {/* The strip belongs to the S&P leg, the only series this cell
          percentiles on its own (seriesRole "percentile"). The gap's
          percentile selects a band; nifty100_pe is a raw operand. */}
      {sp?.percentile !== null && sp?.percentile !== undefined && (
        <div className="mt-3">
          <DistributionStrip percentile={100 - beforeAdjustment} />
        </div>
      )}

      <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
        <span className="font-semibold">Reads trailing P/E, not forward.</span> The workbook specifies S&P 500{" "}
        <em>forward</em> P/E. multpl.com publishes no forward series, and the forward figure we do collect is
        latest-only, so it cannot be ranked against its own history for years yet. Trailing P/E is ranked against its
        own trailing history, which is internally consistent, but the two multiples differ in level by roughly 40%
        (26.07 against 18.66 on 2026-09-20) — so read this as a percentile, not as a statement about the level.
      </p>

      {shortfall && (
        <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
          <span className="font-semibold">Provisional.</span> Only{" "}
          {spanYears !== null ? `${spanYears.toFixed(1)} years` : "a partial history"} of S&P P/E history is stored
          against the workbook's 10-15 year window.
        </p>
      )}
    </section>
  );
}

// Calculation Guide row 29 — "Relative value vs segments": Mid Cap score =
// 100 − Mid Spread %ile; Small Cap score = 100 − Small Spread %ile. Both
// rank a DERIVED spread (segment P/E − Nifty 100 P/E), not either leg's
// own history — a high spread means the segment is expensive relative to
// Large, so a high spread percentile is unattractive and gets inverted.
//
// No DistributionStrip: the spread series is not published to the
// snapshot (scoreMap marks neither leg "percentile"), so a strip on
// either raw P/E would draw the wrong distribution next to the score —
// the same reasoning as SectorRelMomentumTrace below.
function SegmentRelValueTrace({
  scoreState,
  series,
  score,
  segmentLabel,
  segmentSeriesId,
}: {
  scoreState: ScoreState;
  series: Record<string, SeriesState>;
  score: number;
  segmentLabel: string;
  segmentSeriesId: string;
}) {
  const segment = series[segmentSeriesId];
  const large = series["nifty100_pe"];
  const spread = segment?.latest !== null && segment?.latest !== undefined && large?.latest !== null && large?.latest !== undefined
    ? segment.latest - large.latest
    : null;
  const rawPercentile = 100 - score;

  return (
    <section>
      <TraceHeading signalLabel={`${segmentLabel} relative value vs segments`}>
        Whether {segmentLabel.toLowerCase()} is cheap or expensive against Large cap specifically, not against its
        own history. A wide P/E premium over Large is unattractive here, so the spread's percentile is inverted.
      </TraceHeading>

      <Formula>score = 100 − PERCENTRANK({segmentLabel === "Mid cap" ? "Midcap 150" : "Smallcap 250"} P/E − Nifty 100 P/E) × 100</Formula>

      <div className="mt-3">
        <InputRow id={segmentSeriesId} label={`${segmentLabel} P/E`} value={segment?.latest?.toFixed(2) ?? "—"} state={segment} />
        <InputRow id="nifty100_pe" label="Large cap (Nifty 100) P/E" value={large?.latest?.toFixed(2) ?? "—"} state={large} />
      </div>

      <div className="mt-3">
        <Step n={1} value={spread !== null ? spread.toFixed(2) : "—"}>
          Subtract the Large cap P/E from the {segmentLabel.toLowerCase()} P/E to get the premium.
        </Step>
        <Step n={2} value={`${rawPercentile.toFixed(1)}th percentile`}>
          Rank that spread against its own 10-year history{" "}
          {scoreState.historySpanYears !== undefined && scoreState.historySpanYears !== null
            ? `(${scoreState.historySpanYears.toFixed(1)} years stored)`
            : ""}
          .
        </Step>
        <Step n={3} value={formatScore(score)}>
          Invert: a wide, unusually high spread means {segmentLabel.toLowerCase()} looks expensive next to Large, so
          the score falls.
        </Step>
      </div>

      {scoreState.historyShortfall && (
        <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
          <span className="font-semibold">Provisional.</span> The workbook asks for a 10-year window; only{" "}
          {scoreState.historySpanYears !== undefined && scoreState.historySpanYears !== null
            ? `${scoreState.historySpanYears.toFixed(1)} years`
            : "a partial history"}{" "}
          of spread history is stored.
        </p>
      )}
    </section>
  );
}

// Calculation Guide row 29 — "Large Cap score = average of the two raw
// spread %iles AS-IS (wide spreads favour large)." NOT inverted: a wide
// Mid/Small premium over Large means Large itself looks relatively cheap,
// so Large's score moves WITH the spread percentile — the opposite framing
// from Mid/Small's own cells above, off the exact same two spreads.
function LargeRelValueTrace({ series, score }: { series: Record<string, SeriesState>; score: number }) {
  const mid = series["midcap150_pe"];
  const small = series["smallcap250_pe"];
  const large = series["nifty100_pe"];
  const midSpread = mid?.latest !== null && mid?.latest !== undefined && large?.latest !== null && large?.latest !== undefined ? mid.latest - large.latest : null;
  const smallSpread = small?.latest !== null && small?.latest !== undefined && large?.latest !== null && large?.latest !== undefined ? small.latest - large.latest : null;

  return (
    <section>
      <TraceHeading signalLabel="Large cap relative value vs segments">
        Whether Large cap looks cheap by how much of a premium Mid and Small are commanding over it — the same two
        spreads Mid and Small cap's own relvalue cells rank, read the opposite way.
      </TraceHeading>

      <Formula>score = ( PERCENTRANK(Mid − Large) + PERCENTRANK(Small − Large) ) ÷ 2 × 100 — AS-IS, no inversion</Formula>

      <div className="mt-3">
        <InputRow id="midcap150_pe" label="Mid cap P/E" value={mid?.latest?.toFixed(2) ?? "—"} state={mid} />
        <InputRow id="smallcap250_pe" label="Small cap P/E" value={small?.latest?.toFixed(2) ?? "—"} state={small} />
        <InputRow id="nifty100_pe" label="Large cap (Nifty 100) P/E" value={large?.latest?.toFixed(2) ?? "—"} state={large} />
      </div>

      <div className="mt-3">
        <Step n={1} value={midSpread !== null && smallSpread !== null ? `${midSpread.toFixed(2)} / ${smallSpread.toFixed(2)}` : "—"}>
          Take the Mid−Large and Small−Large P/E spreads.
        </Step>
        <Step n={2}>
          Rank each spread against its own 10-year history, AS-IS — no inversion, because a wide spread here means
          Mid/Small are expensive and Large is comparatively cheap.
        </Step>
        <Step n={3} value={formatScore(score)}>
          Average the two raw spread percentiles.
        </Step>
      </div>

      <p className="mt-3 text-[12px] leading-5 text-muted">
        This is the mirror image of the Mid and Small cap relvalue cells: the same two spreads, but Large's score
        rises when Mid/Small look expensive against it, and falls when they look cheap.
      </p>
    </section>
  );
}

// Calculation Guide "Earnings revision breadth" (per segment) —
// equity.{large,mid,small}::revisions. The spec wants upgrade/downgrade
// breadth or consensus FY+1 EPS change, percentiled AS-IS — neither is
// free-sourced for any Indian segment. DOCUMENTED SUBSTITUTE: 3-month
// change in the segment's TRAILING EPS (index close ÷ trailing P/E),
// percentiled the same way. This is the same substitute already built and
// explicitly REJECTED for sector.*::revisions (see
// docs/missing_data_points/sector-satellite.md) because trailing EPS moves
// on REPORTING and consensus EPS moves on REVISION — they can disagree
// exactly at cycle turns. Wired here on explicit instruction; this trace's
// job is to keep that deviation visible, not to dress the proxy up as the
// spec's own breadth figure.
function SegmentRevisionsTrace({
  scoreState,
  series,
  score,
  segmentLabel,
  closeSeriesId,
  peSeriesId,
}: {
  scoreState: ScoreState;
  series: Record<string, SeriesState>;
  score: number;
  segmentLabel: string;
  closeSeriesId: string;
  peSeriesId: string;
}) {
  const close = series[closeSeriesId];
  const pe = series[peSeriesId];
  const trailingEps = close?.latest !== null && close?.latest !== undefined && pe?.latest !== null && pe?.latest !== undefined && pe.latest !== 0
    ? close.latest / pe.latest
    : null;
  const spanYears = scoreState.historySpanYears ?? null;
  const shortfall = scoreState.historyShortfall === true;
  const basis = scoreState.rubricInputs?.[0]?.basis;

  return (
    <section>
      <TraceHeading signalLabel={`${segmentLabel} earnings revisions`}>
        The spec asks for analyst upgrade/downgrade breadth or consensus EPS revisions for {segmentLabel.toLowerCase()}
        constituents — no free source publishes either for any Indian segment. This cell substitutes the 3-month
        change in the segment's own trailing EPS instead.
      </TraceHeading>

      <Formula>score = PERCENTRANK( 3M change in (index close ÷ trailing P/E) ) × 100 — AS-IS</Formula>

      <div className="mt-3">
        <InputRow id={closeSeriesId} label={`${segmentLabel} index close`} value={close?.latest?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"} state={close} />
        <InputRow id={peSeriesId} label={`${segmentLabel} trailing P/E`} value={pe?.latest?.toFixed(2) ?? "—"} state={pe} />
      </div>

      <div className="mt-3">
        <Step n={1} value={trailingEps !== null ? trailingEps.toFixed(2) : "—"}>
          Divide the index close by its trailing P/E to back out trailing EPS.
        </Step>
        <Step n={2}>Take the 3-month change in that trailing EPS.</Step>
        <Step n={3} value={formatScore(score)}>
          Rank the change against its own history{spanYears !== null ? ` (${spanYears.toFixed(1)} years)` : ""}, AS-IS —
          rising trailing EPS is treated as attractive, no inversion.
        </Step>
      </div>

      {/* No DistributionStrip: both close and P/E are raw operands of the
          derived trailing-EPS-change quantity (scoreMap seriesRoles), which
          is not itself published as a series. A strip on either leg would
          contradict the score. */}
      <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
        <span className="font-semibold">Documented proxy, not the spec's input.</span> Trailing EPS moves when
        constituents <em>report</em>; the spec's own breadth/consensus figure moves when analysts <em>revise</em>
        forward estimates. These can point opposite directions at cycle turns — a segment whose earnings just
        collapsed shows trailing EPS falling here even if analysts are already upgrading the turnaround. Read this
        score as earnings momentum, not as an analyst-revision signal.
        {basis ? ` ${basis}` : ""}
      </p>

      {shortfall && (
        <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
          <span className="font-semibold">Provisional.</span> The workbook asks for a 5Y+ history; only{" "}
          {spanYears !== null ? `${spanYears.toFixed(1)} years` : "a partial history"} of trailing-EPS-change history is
          stored.
        </p>
      )}
    </section>
  );
}

// Calculation Guide "Earnings growth differential" (mid/small) — banded
// rubric over the segment's 12M trailing-EPS growth minus Large Cap's, a
// documented substitute for the spec's consensus FY+1 EPS growth gap. Same
// missing-consensus-source class as SegmentRevisionsTrace above, but a
// RUBRIC cell (banded lookup on the latest gap value) rather than a
// percentile — matching growthDiffScore()'s own construction.
function SegmentGrowthDiffTrace({
  scoreState,
  series,
  score,
  segmentLabel,
  closeSeriesId,
  peSeriesId,
}: {
  scoreState: ScoreState;
  series: Record<string, SeriesState>;
  score: number;
  segmentLabel: string;
  closeSeriesId: string;
  peSeriesId: string;
}) {
  const close = series[closeSeriesId];
  const pe = series[peSeriesId];
  const large = series["nifty100_pe"];
  const input = scoreState.rubricInputs?.[0];
  const gapPp = input?.selected ? parseFloat(input.selected) : null;

  return (
    <section>
      <TraceHeading signalLabel={`${segmentLabel} earnings growth differential`}>
        The spec asks for {segmentLabel.toLowerCase()} consensus FY+1 EPS growth minus Large Cap's, banded into a
        score — no free source publishes segment-level consensus growth for Indian equities. This cell substitutes
        each segment's own 12-month trailing EPS growth instead.
      </TraceHeading>

      <Formula>score = growthDiffScore( 12M trailing-EPS growth − Large Cap's 12M trailing-EPS growth )</Formula>

      <div className="mt-3">
        <InputRow id={closeSeriesId} label={`${segmentLabel} index close`} value={close?.latest?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"} state={close} />
        <InputRow id={peSeriesId} label={`${segmentLabel} trailing P/E`} value={pe?.latest?.toFixed(2) ?? "—"} state={pe} />
        <InputRow id="nifty100_pe" label="Large cap (Nifty 100) trailing P/E" value={large?.latest?.toFixed(2) ?? "—"} state={large} />
      </div>

      <div className="mt-3">
        <Step n={1}>Back out trailing EPS for {segmentLabel.toLowerCase()} and Large cap (index close ÷ trailing P/E), each.</Step>
        <Step n={2} value={gapPp !== null ? `${gapPp.toFixed(1)}pp` : "—"}>
          Take each series' 12-month change, then subtract Large cap's from the segment's.
        </Step>
        <Step n={3} value={formatScore(score)}>
          Band the gap: ≥+8pp → 75, +3 to +8pp → 60, −3 to +3pp → 50, −8 to −3pp → 40, below −8pp → 25.
        </Step>
      </div>

      {/* No DistributionStrip: this is a rubric cell, not a percentile —
          all four legs are raw operands of the derived growth gap
          (scoreMap seriesRoles), which is not itself published as a
          series. rubricInputs[] carries the applied band/delta instead. */}
      <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
        <span className="font-semibold">Documented proxy, not the spec's input.</span> Trailing EPS growth is
        reported earnings momentum, not analysts' forward FY+1 estimate — the two can disagree at cycle turns, same
        caveat as the revisions cells.
        {input?.basis ? ` ${input.basis}` : ""}
      </p>
    </section>
  );
}

// Calculation Guide "Earnings growth differential" (International) — "US
// EPS growth minus India's," same growthDiffScore() bands, +5 structural
// INR-depreciation bonus. TWO stacked deviations from the spec's input:
// trailing (not consensus FY+1) on both legs, and REAL US EPS growth
// (multpl.com's EPS page is inflation-adjusted) vs NOMINAL India EPS
// growth — see adapters/multpl.ts for the full reasoning.
function IntlGrowthDiffTrace({ scoreState, series, score }: { scoreState: ScoreState; series: Record<string, SeriesState>; score: number }) {
  const usEps = series["sp500_trailing_eps_real"];
  const indiaClose = series["nifty100_close"];
  const indiaPe = series["nifty100_pe"];
  const input = scoreState.rubricInputs?.[0];
  const gapPp = input?.selected ? parseFloat(input.selected) : null;

  return (
    <section>
      <TraceHeading signalLabel="International earnings growth differential">
        The spec asks for US consensus FY+1 EPS growth minus India's, plus a structural +5 for INR depreciation — no
        free source publishes either side's consensus growth. This cell substitutes trailing EPS growth on both
        legs, with a further real-vs-nominal deviation on the US leg (see below).
      </TraceHeading>

      <Formula>score = growthDiffScore( US 12M real trailing-EPS growth − India 12M nominal trailing-EPS growth, "intl" ) [+5 built in]</Formula>

      <div className="mt-3">
        <InputRow id="sp500_trailing_eps_real" label="S&P 500 trailing EPS (real, multpl.com)" value={usEps?.latest?.toFixed(2) ?? "—"} state={usEps} />
        <InputRow id="nifty100_close" label="Nifty 100 close" value={indiaClose?.latest?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"} state={indiaClose} />
        <InputRow id="nifty100_pe" label="Nifty 100 trailing P/E" value={indiaPe?.latest?.toFixed(2) ?? "—"} state={indiaPe} />
      </div>

      <div className="mt-3">
        <Step n={1}>Take the S&P 500's 12-month change in its (inflation-adjusted) trailing EPS.</Step>
        <Step n={2}>Back out Nifty 100 trailing EPS (close ÷ trailing P/E) and take its 12-month change, nominal INR.</Step>
        <Step n={3} value={gapPp !== null ? `${gapPp.toFixed(1)}pp` : "—"}>Subtract India's growth from the US's.</Step>
        <Step n={4} value={formatScore(score)}>
          Band the gap (same table as mid/small cap), then add the structural +5 for International.
        </Step>
      </div>

      <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
        <span className="font-semibold">Two stacked deviations from the spec's input.</span> (1) Trailing EPS growth,
        not analysts' forward FY+1 estimate — reported earnings momentum can disagree with consensus at cycle turns.
        (2) The US leg is <em>real</em> (inflation-adjusted) EPS growth; the India leg is <em>nominal</em> — no
        deflator is applied to the INR series. The gap is therefore real-US-growth minus nominal-India-growth, which
        drifts from a clean comparison whenever US and India CPI inflation diverge over the trailing year.
        {input?.basis ? ` ${input.basis}` : ""}
      </p>
    </section>
  );
}

// Calculation Guide row 29, International sub-case — "International = 100
// − percentile of (S&P fwd P/E − Nifty fwd P/E) spread vs history."
//
// DOCUMENTED DEVIATION, same substitution as equity.intl::valuation above:
// sp500_fwd_pe has no usable history (15 rows over 5 days), so this ranks
// the same nifty100_pe − sp500_trailing_pe series equity.intl::valuation's
// gap adjustment already uses — published as india_us_valuation_gap.
//
// Sign identity stated on the server (scoreCells.ts): the published series
// is Nifty − S&P; the spec ranks S&P − Nifty = its negation. Because
// PERCENTRANK of a negated series is the complement of the original's
// percentile, "100 − percentile(S&P − Nifty)" equals the PLAIN percentile
// of the published Nifty − S&P series. This trace reads the score straight
// off scoreState.rubricInputs rather than re-deriving from the published
// series' own percentile field, for the same reason IntlValuationTrace
// does: india_us_valuation_gap's SeriesState.percentile is computed over
// its ENTIRE stored history, while this score ranks a 10Y MONTH-END
// window — two different numbers (10.2 vs 3.4 live on 2026-09-20).
function IntlRelValueTrace({ scoreState, series, score }: { scoreState: ScoreState; series: Record<string, SeriesState>; score: number }) {
  const sp = series["sp500_trailing_pe"];
  const nifty = series["nifty100_pe"];
  const gap = series["india_us_valuation_gap"];
  const spanYears = scoreState.historySpanYears ?? null;
  const shortfall = scoreState.historyShortfall === true;
  const input = scoreState.rubricInputs?.[0];

  return (
    <section>
      <TraceHeading signalLabel="International relative value vs segments">
        Whether US equities look cheap or expensive against India specifically, by ranking the same India−US P/E gap
        used to nudge international's own valuation score — read here as its own signal rather than an adjustment.
      </TraceHeading>

      <Formula>score = 100 − PERCENTRANK(S&amp;P P/E − Nifty 100 P/E) × 100 = PERCENTRANK(Nifty 100 P/E − S&amp;P P/E) × 100</Formula>

      <div className="mt-3">
        <InputRow id="nifty100_pe" label="Nifty 100 P/E" value={nifty?.latest?.toFixed(2) ?? "—"} state={nifty} />
        <InputRow id="sp500_trailing_pe" label="S&P 500 P/E" value={sp?.latest?.toFixed(2) ?? "—"} state={sp} />
        <InputRow id="india_us_valuation_gap" label="India − US P/E gap" value={gap?.latest?.toFixed(2) ?? "—"} state={gap} />
      </div>

      <div className="mt-3">
        <Step n={1}>
          Take the India−US P/E gap (Nifty 100 P/E minus S&P 500 P/E) — negative means India is cheaper than the US.
        </Step>
        <Step n={2} value={formatScore(score)}>
          Rank it against its own 10-year month-end history, AS-IS.
          {spanYears !== null ? ` History spans ${spanYears.toFixed(1)} years.` : ""} A low gap (India unusually
          cheap vs. the US) scores low here — the spec's "100 − percentile of S&P−Nifty" is algebraically the same
          number as the plain percentile of Nifty−S&P.
        </Step>
      </div>

      {input && (
        <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">{input.basis}</p>
      )}

      <p className="mt-3 text-[12px] leading-5 text-ink-2">
        <span className="font-semibold">Reads trailing P/E, not forward.</span> The workbook specifies S&P 500{" "}
        <em>forward</em> P/E on both legs. The forward figure we collect is latest-only, so both legs are ranked as
        trailing P/E instead — internally consistent, but read this as a percentile of the gap, not a statement
        about either market's absolute multiple.
      </p>

      {shortfall && (
        <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
          <span className="font-semibold">Provisional.</span> Only{" "}
          {spanYears !== null ? `${spanYears.toFixed(1)} years` : "a partial history"} of gap history is stored
          against the workbook's 10-year window.
        </p>
      )}
    </section>
  );
}

// Calculation Guide, SECTOR SATELLITE: "Average of the sector index's 6M
// and 12M return minus Nifty's over the same windows; percentile vs
// history, AS-IS."
//
// Needs a bespoke trace for the reason scoreMap now records: this cell
// percentiles a DERIVED spread, and BOTH its legs are raw operands. The
// generic one-series trace would draw a distribution strip for a raw
// index close — inviting the reader to attribute the score to the
// market's own percentile rather than to the sector's relative return.
//
// It also states the direction explicitly, because AS-IS on a
// self-referential distribution reads as a bug until explained: Nifty IT
// scored 86.9 on a NEGATIVE −6.94% relative return (live 2026-09-20),
// which is correct — the cell ranks a sector against ITS OWN history,
// and −6.94% is near the top of a year that ranged −27.8% to −1.1%.
function SectorRelMomentumTrace({
  scoreState,
  series,
  score,
  sectorLabel,
}: {
  scoreState: ScoreState;
  series: Record<string, SeriesState>;
  score: number;
  sectorLabel: string;
}) {
  const sectorId = scoreState.derivedFrom[0];
  const sectorClose = sectorId ? series[sectorId] : undefined;
  const niftyClose = series["nifty50_close"];
  const spanYears = scoreState.historySpanYears ?? null;
  const shortfall = scoreState.historyShortfall === true;

  return (
    <section>
      <TraceHeading signalLabel={`${sectorLabel} relative momentum`}>
        Whether the sector has been beating the market, blended across two windows so a single sharp month cannot
        carry the signal. Ranked against the sector's own past relative performance — not against other sectors.
      </TraceHeading>

      <Formula>score = PERCENTRANK( ((sector 6M − Nifty 6M) + (sector 12M − Nifty 12M)) ÷ 2 ) × 100</Formula>

      <div className="mt-3">
        <InputRow id={sectorId ?? "—"} label={`${sectorLabel} index close`} value={sectorClose?.latest?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"} state={sectorClose} />
        <InputRow id="nifty50_close" label="Nifty 50 close" value={niftyClose?.latest?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"} state={niftyClose} />
      </div>

      <div className="mt-3">
        <Step n={1}>Take the sector's 6-month and 12-month price returns, and the Nifty's over the same two windows.</Step>
        <Step n={2}>Subtract the Nifty's return from the sector's in each window, then average the two gaps.</Step>
        <Step n={3} value={formatScore(score)}>
          Rank that blended gap against its own history{spanYears !== null ? ` (${spanYears.toFixed(1)} years)` : ""}. Taken
          AS-IS — outperformance is attractive, so no inversion.
        </Step>
      </div>

      {/* No DistributionStrip: both legs are raw operands of the spread
          (scoreMap seriesRoles), and the spread itself is not published
          as a series. A strip on either close would contradict the score. */}
      <p className="mt-3 text-[12px] leading-5 text-muted">
        The ranking is against this sector's <span className="font-semibold">own</span> history of relative
        performance. A persistent laggard can therefore score well by being less far behind than usual, and a strong
        performer can score poorly if it is normally stronger still.
      </p>

      {shortfall && (
        <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
          <span className="font-semibold">Provisional.</span> The 12-month lookback consumes the first year of stored
          closes before any relative return exists, so this history is about a year shorter than the price history
          behind it{spanYears !== null ? ` — ${spanYears.toFixed(1)} years here` : ""}. It will deepen as closes
          accumulate.
        </p>
      )}
    </section>
  );
}

// Calculation Guide, SECTOR SATELLITE — "Cycle position": start 50;
// demand cycle turning up with discipline intact +15; mid-cycle 0;
// late-cycle -15; regulatory or disruption overhang -10.
//
// The only sector signal with no feed BY CONSTRUCTION rather than by
// omission — the workbook names a different indicator per sector and
// asks for judgements ("pricing discipline intact", "capacity racing
// in") that no series answers. So this trace's job is the opposite of
// the others': instead of showing arithmetic over fetched numbers, it
// shows the table and states plainly that the input is an analyst's
// call, so a reader never mistakes the score for a measurement.
function SectorCyclePositionTrace({
  scoreState,
  score,
  sectorLabel,
  evidence,
}: {
  scoreState: ScoreState;
  score: number;
  sectorLabel: string;
  evidence: string;
}) {
  const answered = scoreState.provenance === "manual" || (scoreState.rubricInputs?.length ?? 0) > 0;

  return (
    <section>
      <TraceHeading signalLabel={`${sectorLabel} cycle position`}>
        Where {sectorLabel} sits in its own business cycle. This is a judgement, not a measurement — the workbook
        scores it from a fixed table so that the judgement is at least applied consistently.
      </TraceHeading>

      <Formula>score = clamp(50 + cycle stage + overhang, 0, 100)</Formula>

      {scoreState.rubricInputs && scoreState.rubricInputs.length > 0 ? (
        <div className="mt-3">
          {scoreState.rubricInputs.map((input) => (
            <div key={input.field} className="border-b border-line py-2.5 last:border-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-ink-2">{input.field}</span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">
                  {input.delta >= 0 ? "+" : ""}
                  {input.delta}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-muted">
                {input.selected ?? "—"}
                {input.assumed ? " · assumed" : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          <Step n={1}>Cycle stage — turning up with discipline intact <span className="tabular-nums">+15</span>, mid-cycle <span className="tabular-nums">0</span>, late-cycle with capacity racing in <span className="tabular-nums">−15</span>.</Step>
          <Step n={2}>Regulatory or disruption overhang — <span className="tabular-nums">−10</span> if present.</Step>
          <Step n={3} value={formatScore(score)}>Add to the neutral base of 50 and clamp.</Step>
        </div>
      )}

      <p className="mt-3 border-y border-line bg-paper-2 px-3 py-2.5 text-[12px] leading-5 text-ink-2">
        <span className="font-semibold">{answered ? "Analyst input." : "Awaiting analyst input."}</span> No data feed
        answers this cell, and none is planned: the workbook judges each sector on its own evidence ({evidence}) and
        asks whether pricing discipline is intact or capacity is racing in — questions a published series cannot
        settle. {answered ? "The score above reflects a deliberate call." : "Until someone answers the rubric, this shows the demo baseline."}
      </p>
    </section>
  );
}

export function ScoreFormulaTrace({
  scoreId,
  scoreState,
  series,
  score,
}: {
  scoreId: string;
  scoreState: ScoreState;
  series: Record<string, SeriesState>;
  score: number;
}) {
  switch (scoreId) {
    case "l1.equity::valuation":
      return <ValuationTrace series={series} score={score} />;
    case "l1.equity::flows":
      return <FlowsTrace
          series={series}
          score={score}
          flowId="flow_equity_3m"
          aumId="aum_equity"
          ratioId="flow_ratio_equity_3m"
          sleeveLabel="equity funds"
        />;
    case "l1.equity::macro":
      return (
        <MacroTrace
          scoreState={scoreState}
          score={score}
          blurb="A rubric, not a percentile: three judgement calls, each worth a fixed number of points from a neutral base of 50."
          formula="score = clamp(50 + RBI stance + growth + inflation, 0, 100)"
        />
      );
    case "l1.equity::fundamentals":
      return <FundamentalsTrace score={score} />;
    case "l1.equity::momentum":
      return <MomentumTrace series={series} score={score} />;
    case "l1.debt::macro":
      return (
        <MacroTrace
          scoreState={scoreState}
          score={score}
          blurb="A rubric, not a percentile: three judgement calls about the rate cycle, each worth a fixed number of points from a neutral base of 50. Note this reads inflation against the 4% target — a level, not the direction of travel Equity's macro cell uses — so the two can legitimately disagree."
          formula="score = clamp(50 + RBI path + G-sec supply + inflation vs. target, 0, 100)"
        />
      );
    case "l1.debt::momentum":
      return <DebtMomentumTrace series={series} score={score} />;
    case "l1.metals::flows":
      return <MetalsFlowsTrace series={series} score={score} />;
    case "l1.metals::macro":
      return <MetalsMacroTrace series={series} score={score} />;
    case "metals.gold::ratio_position": return <MetalsRatioTrace series={series} score={score} inverted />;
    case "metals.silver::ratio_position": return <MetalsRatioTrace series={series} score={score} inverted={false} />;
    case "metals.gold::real_rates":
    case "metals.silver::real_rates": return <MetalsRealRatesTrace series={series} score={score} />;
    case "metals.gold::industrial": return <GoldIndustrialTrace score={score} />;
    case "metals.silver::industrial": return <SilverIndustrialTrace scoreState={scoreState} score={score} />;
    case "l1.metals::momentum":
      return <MetalsMomentumTrace series={series} score={score} />;
    case "l1.metals::valuation":
      return <MetalsValuationTrace series={series} score={score} />;
    case "l1.debt::valuation":
      return <DebtValuationTrace series={series} score={score} />;
    case "l1.debt::flows":
      return (
        <FlowsTrace
          series={series}
          score={score}
          flowId="flow_duration_3m"
          aumId="aum_duration"
          ratioId="flow_ratio_duration_3m"
          sleeveLabel="duration funds"
        />
      );
    case "equity.large::valuation":
      return <SegmentValuationTrace scoreState={scoreState} series={series} score={score} segmentLabel="Large cap" />;
    case "equity.mid::valuation":
      return <SegmentValuationTrace scoreState={scoreState} series={series} score={score} segmentLabel="Mid cap" />;
    case "equity.small::valuation":
      return <SegmentValuationTrace scoreState={scoreState} series={series} score={score} segmentLabel="Small cap" />;
    case "equity.intl::valuation":
      return <IntlValuationTrace scoreState={scoreState} series={series} score={score} />;
    case "equity.mid::relvalue":
      return <SegmentRelValueTrace scoreState={scoreState} series={series} score={score} segmentLabel="Mid cap" segmentSeriesId="midcap150_pe" />;
    case "equity.small::relvalue":
      return <SegmentRelValueTrace scoreState={scoreState} series={series} score={score} segmentLabel="Small cap" segmentSeriesId="smallcap250_pe" />;
    case "equity.large::relvalue":
      return <LargeRelValueTrace series={series} score={score} />;
    case "equity.intl::relvalue":
      return <IntlRelValueTrace scoreState={scoreState} series={series} score={score} />;
    case "equity.large::revisions":
      return <SegmentRevisionsTrace scoreState={scoreState} series={series} score={score} segmentLabel="Large cap" closeSeriesId="nifty100_close" peSeriesId="nifty100_pe" />;
    case "equity.mid::revisions":
      return <SegmentRevisionsTrace scoreState={scoreState} series={series} score={score} segmentLabel="Mid cap" closeSeriesId="midcap150_close" peSeriesId="midcap150_pe" />;
    case "equity.small::revisions":
      return <SegmentRevisionsTrace scoreState={scoreState} series={series} score={score} segmentLabel="Small cap" closeSeriesId="smallcap250_close" peSeriesId="smallcap250_pe" />;
    case "equity.mid::growth_diff":
      return <SegmentGrowthDiffTrace scoreState={scoreState} series={series} score={score} segmentLabel="Mid cap" closeSeriesId="midcap150_close" peSeriesId="midcap150_pe" />;
    case "equity.small::growth_diff":
      return <SegmentGrowthDiffTrace scoreState={scoreState} series={series} score={score} segmentLabel="Small cap" closeSeriesId="smallcap250_close" peSeriesId="smallcap250_pe" />;
    case "equity.intl::growth_diff":
      return <IntlGrowthDiffTrace scoreState={scoreState} series={series} score={score} />;
    case "sector.banking::valuation":
      return <SectorValuationTrace scoreState={scoreState} series={series["sector_pe_banking"]} score={score} sectorLabel="Banking" />;
    case "sector.it::valuation":
      return <SectorValuationTrace scoreState={scoreState} series={series["sector_pe_it"]} score={score} sectorLabel="IT" />;
    case "sector.pharma::valuation":
      return <SectorValuationTrace scoreState={scoreState} series={series["sector_pe_pharma"]} score={score} sectorLabel="Pharma" />;
    case "sector.auto::valuation":
      return <SectorValuationTrace scoreState={scoreState} series={series["sector_pe_auto"]} score={score} sectorLabel="Auto" />;
    case "sector.capgoods::valuation":
      return <SectorValuationTrace scoreState={scoreState} series={series["sector_pe_capgoods"]} score={score} sectorLabel="Capital Goods" />;
    case "sector.fmcg::valuation":
      return <SectorValuationTrace scoreState={scoreState} series={series["sector_pe_fmcg"]} score={score} sectorLabel="FMCG" />;
    case "sector.energy::valuation":
      return <SectorValuationTrace scoreState={scoreState} series={series["sector_pe_energy"]} score={score} sectorLabel="Energy" />;
    case "sector.metals::valuation":
      return <SectorValuationTrace scoreState={scoreState} series={series["sector_pe_metals"]} score={score} sectorLabel="Metals" />;
    case "sector.banking::rel_momentum":
      return <SectorRelMomentumTrace scoreState={scoreState} series={series} score={score} sectorLabel="Banking" />;
    case "sector.it::rel_momentum":
      return <SectorRelMomentumTrace scoreState={scoreState} series={series} score={score} sectorLabel="IT" />;
    case "sector.pharma::rel_momentum":
      return <SectorRelMomentumTrace scoreState={scoreState} series={series} score={score} sectorLabel="Pharma" />;
    case "sector.auto::rel_momentum":
      return <SectorRelMomentumTrace scoreState={scoreState} series={series} score={score} sectorLabel="Auto" />;
    case "sector.capgoods::rel_momentum":
      return <SectorRelMomentumTrace scoreState={scoreState} series={series} score={score} sectorLabel="Capital Goods" />;
    case "sector.fmcg::rel_momentum":
      return <SectorRelMomentumTrace scoreState={scoreState} series={series} score={score} sectorLabel="FMCG" />;
    case "sector.energy::rel_momentum":
      return <SectorRelMomentumTrace scoreState={scoreState} series={series} score={score} sectorLabel="Energy" />;
    case "sector.metals::rel_momentum":
      return <SectorRelMomentumTrace scoreState={scoreState} series={series} score={score} sectorLabel="Metals" />;
    case "sector.banking::cycle_position":
      return <SectorCyclePositionTrace scoreState={scoreState} score={score} sectorLabel="Banking" evidence="credit growth, asset quality" />;
    case "sector.it::cycle_position":
      return <SectorCyclePositionTrace scoreState={scoreState} score={score} sectorLabel="IT" evidence="deal wins, pricing" />;
    case "sector.pharma::cycle_position":
      return <SectorCyclePositionTrace scoreState={scoreState} score={score} sectorLabel="Pharma" evidence="approvals, US pricing" />;
    case "sector.auto::cycle_position":
      return <SectorCyclePositionTrace scoreState={scoreState} score={score} sectorLabel="Auto" evidence="volume growth" />;
    case "sector.capgoods::cycle_position":
      return <SectorCyclePositionTrace scoreState={scoreState} score={score} sectorLabel="Capital Goods" evidence="capex announcements, order books" />;
    case "sector.fmcg::cycle_position":
      return <SectorCyclePositionTrace scoreState={scoreState} score={score} sectorLabel="FMCG" evidence="volume growth, rural demand" />;
    case "sector.energy::cycle_position":
      return <SectorCyclePositionTrace scoreState={scoreState} score={score} sectorLabel="Energy" evidence="refining/marketing margins" />;
    case "sector.metals::cycle_position":
      return <SectorCyclePositionTrace scoreState={scoreState} score={score} sectorLabel="Metals" evidence="global prices, capacity additions" />;
    default:
      return null;
  }
}

// True when ScoreFormulaTrace will render something for this id. Lets a
// caller decide between the bespoke trace and its own fallback WITHOUT
// rendering first and testing for null — which React makes awkward.
export function hasScoreFormulaTrace(scoreId: string): boolean {
  return [
    "l1.equity::valuation",
    "l1.equity::flows",
    "l1.equity::macro",
    "l1.equity::fundamentals",
    "l1.equity::momentum",
    "l1.metals::valuation",
    "metals.gold::ratio_position",
    "metals.silver::ratio_position",
    "metals.gold::real_rates",
    "metals.silver::real_rates",
    "metals.gold::industrial",
    "metals.silver::industrial",
    "l1.metals::flows",
    "l1.metals::macro",
    "l1.metals::momentum",
    "l1.debt::valuation",
    "l1.debt::momentum",
    "l1.debt::macro",
    "l1.debt::flows",
    "equity.large::valuation",
    "equity.mid::valuation",
    "equity.small::valuation",
    "equity.intl::valuation",
    "equity.large::relvalue",
    "equity.mid::relvalue",
    "equity.small::relvalue",
    "equity.intl::relvalue",
    "equity.large::revisions",
    "equity.mid::revisions",
    "equity.small::revisions",
    "equity.mid::growth_diff",
    "equity.small::growth_diff",
    "equity.intl::growth_diff",
    ...["banking", "it", "pharma", "auto", "capgoods", "fmcg", "energy", "metals"].flatMap((s) => [
      `sector.${s}::valuation`,
      `sector.${s}::rel_momentum`,
      `sector.${s}::cycle_position`,
    ]),
  ].includes(scoreId);
}
