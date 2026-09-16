import { useEffect, useState, type CSSProperties } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import type { Allocation, TiltGroupId } from "@wayfinder/engine";
import { GROUP_LABELS, NODE_LABELS, TILT_GROUP_NODES } from "@wayfinder/engine";
import { formatPct, formatSignedPct } from "../lib/format.js";

// §12.2: stacked proportional bar, not sunburst/donut — angular comparison
// at 2.5% vs 2.4% is unreadable and precision matters more than novelty
// here. The sector sleeve must read as visibly carved out of equity, not
// as a peer segment.
// Flat fills, no gradient/shine overlay - the design system reserves
// gradients for full-bleed editorial panels and illustration, never for
// flat UI fills, so the bar shouldn't be the one glossy holdout.

// One hue per asset class, with each child a shade of its parent, so a child
// always reads as belonging to its family: equity is periwinkle/indigo, debt
// is green, and precious metals are orange/peach.
const SEGMENT_COLORS: Record<string, string> = {
  "l1.equity": "#7B86F4",
  "l1.debt": "#6BCF7F",
  "l1.metals": "#E8834F",
};

// Children take their shade from their position in the bar rather than from a
// fixed per-id colour, so each family always ramps dark to light left to
// right. A static map can't guarantee that: the engine's rollup order is its
// own, and it put the lightest debt sleeve (Liquid) first, which made that
// family read light-dark-light.
type ChildFamily = "equity" | "debt" | "metals";
const FAMILY_RAMPS: Record<ChildFamily, string[]> = {
  equity: ["#4A57E0", "#5C6AE8", "#7B86F4", "#A3ABF8", "#C5CAFB", "#DDE0FD"],
  debt: ["#3B9A52", "#4CAF63", "#7FCB92", "#A8E6B4"],
  metals: ["#D96A2F", "#E8834F", "#F2B195", "#FBE4D8"],
};
const FALLBACK_COLOR = "#C5CAFB";

// Sector sleeves are carved out of equity rather than being peer segments, so
// they take a diagonal hatch over their equity-family shade: the hue says
// "this is equity", the hatch says "this is a sleeve within it".
const SLEEVE_FALLBACK_COLOR = "#8A93F6";

// Walks the rendered order once and hands each child the next shade down its
// family's ramp, clamping to the last stop if a family ever outgrows it.
function rampColors(orderedIds: readonly string[], family: ChildFamily): Record<string, string> {
  const ramp = FAMILY_RAMPS[family];
  const assigned: Record<string, string> = {};
  orderedIds.forEach((id, index) => {
    assigned[id] = ramp[Math.min(index, ramp.length - 1)]!;
  });
  return assigned;
}
function isSleeveId(id: string): boolean {
  return id.startsWith("sleeve.");
}
function hatchStyle(id: string, color: string): CSSProperties | undefined {
  if (!isSleeveId(id)) return undefined;
  return {
    backgroundColor: color,
    backgroundImage:
      "repeating-linear-gradient(45deg, rgba(0,0,0,0.22) 0, rgba(0,0,0,0.22) 2px, transparent 2px, transparent 8px)",
  };
}

// Child shades depend on render order, so callers outside the bar pass the
// allocation to resolve the same colour the bar would draw. L1 ids and an
// absent allocation fall back to the family hues.
export function segmentColor(id: string, allocation?: Allocation): string {
  if (SEGMENT_COLORS[id]) return SEGMENT_COLORS[id]!;
  if (allocation) {
    const match = segmentsForDepth(allocation, "detail").find((segment) => segment.id === id);
    if (match) return match.color;
  }
  return isSleeveId(id) ? SLEEVE_FALLBACK_COLOR : FALLBACK_COLOR;
}

// Swatch styling for anything outside the bar that needs to key back to it
// (legends, holdings lists), so those surfaces can't drift from the bar's
// palette or lose the sleeve hatch.
export function segmentSwatchStyle(id: string, allocation?: Allocation): CSSProperties {
  const color = segmentColor(id, allocation);
  return hatchStyle(id, color) ?? { backgroundColor: color };
}
const TOOLTIP_DELAY_MS = 2000;
const SPRING: Transition = { type: "spring", stiffness: 260, damping: 32, mass: 0.8 };

export type AllocationDepth = "overview" | "detail";
// "neutral" overlays each segment's policy-neutral width so the tilt away from
// policy is visible in place, rather than only as a number in a table.
export type CompareBasis = "none" | "neutral";

interface AllocationSegment {
  id: string;
  label: string;
  weight: number;
  color: string;
  parent?: TiltGroupId;
  neutralDelta: number | null;
  vetoActive: boolean;
  isSleeve: boolean;
}

const PARENT_BY_ROLLUP_ID: Record<string, TiltGroupId> = {
  "equity.large": "equity",
  "equity.mid": "equity",
  "equity.small": "equity",
  "equity.intl": "equity",
  "debt.liquid": "debt",
  "debt.corporate": "debt",
  "debt.gilt": "debt",
  "metals.gold": "metals",
  "metals.silver": "metals",
};

function segmentsForDepth(allocation: Allocation, depth: AllocationDepth): AllocationSegment[] {
  if (depth === "overview") {
    return TILT_GROUP_NODES.l1.map((nodeId) => {
      const node = allocation.groups.l1.nodes[nodeId]!;
      return {
        id: nodeId,
        label: NODE_LABELS[nodeId],
        weight: node.final,
        color: SEGMENT_COLORS[nodeId] ?? FALLBACK_COLOR,
        neutralDelta: node.vsNeutralFinal,
        vetoActive: node.vetoActive,
        isSleeve: false,
      };
    });
  }

  // Assign shades in render order, per family, before mapping the segments —
  // that is what keeps each family ramping dark to light across the bar.
  const orderByFamily: Record<ChildFamily, string[]> = { equity: [], debt: [], metals: [] };
  for (const r of allocation.rollup) {
    const family = isSleeveId(r.id) ? "equity" : PARENT_BY_ROLLUP_ID[r.id];
    if (family && family !== "l1") orderByFamily[family].push(r.id);
  }
  const colorById: Record<string, string> = {
    ...rampColors(orderByFamily.equity, "equity"),
    ...rampColors(orderByFamily.debt, "debt"),
    ...rampColors(orderByFamily.metals, "metals"),
  };

  return allocation.rollup.map((r) => {
    const isSleeve = isSleeveId(r.id);
    const parent = isSleeve ? "equity" : PARENT_BY_ROLLUP_ID[r.id];
    const node = parent && !isSleeve ? allocation.groups[parent].nodes[r.id] : undefined;
    return {
      id: r.id,
      label: r.label,
      weight: r.portfolioWeight,
      color: colorById[r.id] ?? (isSleeve ? SLEEVE_FALLBACK_COLOR : FALLBACK_COLOR),
      parent,
      neutralDelta: node ? node.vsNeutralFinal : null,
      vetoActive: !!node?.vetoActive,
      isSleeve,
    };
  });
}

function parentRails(allocation: Allocation): Array<{ id: TiltGroupId; label: string; weight: number; color: string }> {
  return [
    { id: "equity", label: GROUP_LABELS.equity ?? "Equity", weight: allocation.groups.l1.nodes["l1.equity"]!.final, color: SEGMENT_COLORS["l1.equity"] ?? "#7B86F4" },
    { id: "debt", label: GROUP_LABELS.debt ?? "Debt", weight: allocation.groups.l1.nodes["l1.debt"]!.final, color: SEGMENT_COLORS["l1.debt"] ?? "#6BCF7F" },
    { id: "metals", label: GROUP_LABELS.metals ?? "Metals", weight: allocation.groups.l1.nodes["l1.metals"]!.final, color: SEGMENT_COLORS["l1.metals"] ?? "#E8834F" },
  ];
}

// Which parent rail a segment sits under. At detail depth that is the
// segment's own parent; at overview depth the segments *are* the L1 classes,
// so the id maps straight across.
function railIdFor(segment: AllocationSegment): TiltGroupId | undefined {
  if (segment.parent) return segment.parent;
  if (segment.id === "l1.equity") return "equity";
  if (segment.id === "l1.debt") return "debt";
  if (segment.id === "l1.metals") return "metals";
  return undefined;
}

// Centre of the segment, clamped away from the bar's ends so a tooltip on the
// first or last segment stays fully on screen.
function tooltipAnchor(segments: AllocationSegment[], id: string): number {
  let cursor = 0;
  for (const segment of segments) {
    if (segment.id === id) {
      const centre = (cursor + segment.weight / 2) * 100;
      return Math.min(86, Math.max(14, centre));
    }
    cursor += segment.weight;
  }
  return 50;
}

// Light card giving the numbers a narrow segment can't show inline: exact
// weight, the policy-neutral comparison, and any active constraint.
function SegmentTooltip({ segment, compare }: { segment: AllocationSegment; compare: CompareBasis }) {
  const delta = segment.neutralDelta;
  return (
    <div className="min-w-[184px] rounded border border-line bg-paper px-3 py-2.5 text-ink shadow-xl">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0"
          style={hatchStyle(segment.id, segment.color) ?? { backgroundColor: segment.color }}
        />
        <span className="text-[13px] font-semibold">{segment.label}</span>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <span className="text-[11px] uppercase tracking-eyebrow text-muted">Weight</span>
        <span className="text-[15px] font-semibold tabular-nums">{formatPct(segment.weight)}</span>
      </div>
      {delta !== null && (
        <>
          <div className="mt-1 flex items-baseline justify-between gap-4">
            <span className="text-[11px] uppercase tracking-eyebrow text-muted">Neutral</span>
            <span className="text-[13px] tabular-nums text-ink-2">{formatPct(segment.weight - delta)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-4">
            <span className="text-[11px] uppercase tracking-eyebrow text-muted">Tilt</span>
            <span className={`text-[13px] font-semibold tabular-nums ${delta >= 0 ? "text-brand-800" : "text-danger-500"}`}>
              {formatSignedPct(delta, 2)}
            </span>
          </div>
        </>
      )}
      {(segment.vetoActive || segment.isSleeve) && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-line pt-2">
          {segment.isSleeve && (
            <span className="rounded-sm bg-paper-2 px-1.5 py-0.5 text-[10px] font-bold text-ink-2">Sector sleeve</span>
          )}
          {segment.vetoActive && (
            <span className="rounded-sm bg-warn-50 px-1.5 py-0.5 text-[10px] font-bold text-warn-800">Veto active</span>
          )}
        </div>
      )}
    </div>
  );
}

export function AllocationBar({
  allocation,
  depth = "detail",
  selectedId,
  onSelect,
  compare = "none",
}: {
  allocation: Allocation;
  depth?: AllocationDepth;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  compare?: CompareBasis;
}) {
  const segments = segmentsForDepth(allocation, depth);
  const rails = parentRails(allocation);
  const reduceMotion = useReducedMotion();
  const motionTransition = reduceMotion ? { duration: 0 } : SPRING;

  // Hover previews the same focus state selection produces, so pointing at a
  // segment or its legend chip reads identically. Hover wins while it is
  // active; selection is what persists once the pointer leaves.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const activeId = hoveredId ?? selectedId ?? null;
  const activeSegment = activeId ? segments.find((segment) => segment.id === activeId) ?? null : null;

  // Highlighting is immediate, but the tooltip waits out a dwell so sweeping
  // across the bar doesn't flash a card over every segment on the way past.
  // A selected segment shows its tooltip at once — that was a deliberate
  // click, not a pointer passing through.
  const [dwelledId, setDwelledId] = useState<string | null>(null);
  useEffect(() => {
    if (hoveredId === null) {
      setDwelledId(null);
      return;
    }
    const timer = window.setTimeout(() => setDwelledId(hoveredId), TOOLTIP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hoveredId]);

  const tooltipId = hoveredId ? (dwelledId === hoveredId ? hoveredId : null) : selectedId ?? null;
  const tooltipSegment = tooltipId ? segments.find((segment) => segment.id === tooltipId) ?? null : null;
  const detailGroups = rails.map((rail) => ({
    rail,
    segments: segments.filter((segment) => segment.parent === rail.id),
  }));

  // Neutral markers are positioned against the whole bar, not within their own
  // segment: an underweight segment's neutral width is wider than the segment
  // itself, so a segment-relative marker would clamp to the edge and vanish.
  // Walking cumulative offsets keeps each boundary where it actually falls.
  //
  // The last segment's boundary is skipped: weights sum to 1, so it always
  // lands on (or just past) the end of the bar and carries no information that
  // the preceding boundaries don't already show.
  const neutralMarkers: Array<{ id: string; label: string; delta: number; left: number }> = [];
  if (compare === "neutral") {
    let cursor = 0;
    segments.forEach((segment, index) => {
      const isLast = index === segments.length - 1;
      if (segment.neutralDelta !== null && !isLast) {
        const left = (cursor + segment.weight - segment.neutralDelta) * 100;
        if (left >= 0 && left <= 100) {
          neutralMarkers.push({ id: segment.id, label: segment.label, delta: segment.neutralDelta, left });
        }
      }
      cursor += segment.weight;
    });
  }

  return (
    <div>
      {depth === "detail" && (
        <div className="space-y-3 md:hidden">
          {detailGroups.map(({ rail, segments: groupSegments }) => (
            <div key={rail.id} className="rounded-lg border border-line bg-paper p-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold uppercase tracking-wide text-ink-2">{rail.label.replace(" Segments", "")}</span>
                <span className="tabular-nums text-muted">{formatPct(rail.weight, 1)}</span>
              </div>
              <div className="flex h-11 overflow-hidden">
                {/* Touch-first, so there is no hover here — but selection dims
                    the rest exactly as it does on the desktop band. */}
                {groupSegments.map((segment) => {
                  const isSelected = selectedId === segment.id;
                  const isDimmed = selectedId != null && !isSelected;
                  return (
                    <motion.button
                      layout
                      key={segment.id}
                      type="button"
                      onClick={() => onSelect?.(segment.id)}
                      aria-label={`${segment.label}, ${formatPct(segment.weight, 1)}${segment.vetoActive ? ", veto active" : ""}`}
                      animate={{
                        width: `${segment.weight * 100}%`,
                        opacity: isDimmed ? 0.24 : 1,
                        filter: isDimmed ? "saturate(0.55)" : "saturate(1)",
                      }}
                      transition={motionTransition}
                      style={hatchStyle(segment.id, segment.color) ?? { backgroundColor: segment.color }}
                      className={`relative min-w-[6px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 ${
                        isSelected ? "ring-2 ring-inset ring-ink" : ""
                      }`}
                      title={`${segment.label}: ${formatPct(segment.weight)}${segment.neutralDelta !== null ? ` (${formatSignedPct(segment.neutralDelta, 2)} vs neutral)` : ""}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The band clips its own overflow to keep segment fills square, so the
          tooltip lives in this wrapper instead — a sibling of the band rather
          than a child of it, which is what keeps it from being cut off. */}
      <div className={`relative ${depth === "detail" ? "hidden md:block" : ""}`}>
        {tooltipSegment && (
          <div
            className="pointer-events-none absolute top-full z-20 mt-2 -translate-x-1/2"
            style={{ left: `${tooltipAnchor(segments, tooltipSegment.id)}%` }}
          >
            <SegmentTooltip segment={tooltipSegment} compare={compare} />
          </div>
        )}

        {/* Solid band of flat colour: square corners, no internal dividers and
            no labels inside the segments. Identification happens in the legend
            below, which keeps narrow sleeves readable instead of clipping text. */}
        <motion.div
          layout
          className="relative flex h-20 w-full overflow-hidden"
          transition={motionTransition}
          onMouseLeave={() => setHoveredId(null)}
        >
          {segments.map((segment) => {
            const isActive = activeId === segment.id;
            const isDimmed = activeId !== null && !isActive;
            return (
              <motion.button
                layout
                key={segment.id}
                type="button"
                onClick={() => onSelect?.(segment.id)}
                onMouseEnter={() => setHoveredId(segment.id)}
                onFocus={() => setHoveredId(segment.id)}
                onBlur={() => setHoveredId(null)}
                aria-label={`${segment.label}, ${formatPct(segment.weight, 1)}${segment.vetoActive ? ", veto active" : ""}`}
                animate={{
                  width: `${segment.weight * 100}%`,
                  opacity: isDimmed ? 0.24 : 1,
                  filter: isDimmed ? "saturate(0.55)" : "saturate(1)",
                }}
                transition={motionTransition}
                style={hatchStyle(segment.id, segment.color) ?? { backgroundColor: segment.color }}
                className={`relative min-w-[6px] focus:outline-none ${
                  selectedId === segment.id ? "ring-2 ring-inset ring-ink" : ""
                }`}
              />
            );
          })}

          {/* Where each class would end at its policy-neutral weight. The gap
              between a marker and its segment's edge is the active tilt. */}
          {neutralMarkers.map((marker) => (
            <span
              key={marker.id}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-ink"
              style={{ left: `${marker.left}%` }}
            />
          ))}

        </motion.div>

        {/* Parent rail: a coloured rule under the band spanning each asset
            class, labelled beneath. Shown at both depths — on overview the
            segments are the three parents, so the rule simply names them. The
            rails sit flush with no gap, matching the band above. */}
        {/* The rail dims with the band: when a segment is focused, only the
            class it belongs to stays lit. */}
        <motion.div layout className="mt-1.5 flex" transition={motionTransition}>
          {rails.map((rail) => {
            const railDimmed = activeSegment != null && railIdFor(activeSegment) !== rail.id;
            return (
              <motion.div
                layout
                key={rail.id}
                className="border-t-2 pt-2 text-center text-[11px] font-bold uppercase tracking-eyebrow text-muted"
                animate={{ width: `${rail.weight * 100}%`, opacity: railDimmed ? 0.3 : 1 }}
                transition={motionTransition}
                style={{ borderColor: rail.color }}
              >
                {rail.label.replace(" Segments", "")}
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* Legend as a row of tinted chips — a solid square swatch beside the
          label, under a hairline rule. Chips wrap rather than sitting on a
          fixed grid, so the row reflows to whatever segments are present. */}
      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-4">
          <div className="text-[13px] font-semibold text-muted">Allocation</div>
          {compare === "neutral" && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="inline-block h-3 border-l-2 border-dashed border-ink" aria-hidden="true" />
              Policy neutral
            </div>
          )}
        </div>
        <div className="mt-2 border-t border-line pt-3">
          <div className="flex flex-wrap gap-2" onMouseLeave={() => setHoveredId(null)}>
            {segments.map((segment) => {
              const isActive = activeId === segment.id;
              const isDimmed = activeId !== null && !isActive;
              return (
                <button
                  key={segment.id}
                  type="button"
                  onClick={() => onSelect?.(segment.id)}
                  onMouseEnter={() => setHoveredId(segment.id)}
                  onFocus={() => setHoveredId(segment.id)}
                  onBlur={() => setHoveredId(null)}
                  className={`inline-flex items-center gap-2 rounded-md bg-paper-2 px-3 py-2 text-left transition-all duration-100 ease-in hover:bg-paper-3 ${
                    selectedId === segment.id ? "ring-1 ring-ink" : ""
                  } ${isDimmed ? "opacity-40" : "opacity-100"}`}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0"
                    style={hatchStyle(segment.id, segment.color) ?? { backgroundColor: segment.color }}
                  />
                  <span className="text-[13px] font-semibold text-ink">
                    {segment.label}
                    {segment.isSleeve ? " (sleeve)" : ""}
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums text-muted">{formatPct(segment.weight)}</span>
                  {compare === "neutral" && segment.neutralDelta !== null && (
                    <span
                      className={`text-[13px] font-semibold tabular-nums ${
                        segment.neutralDelta > 0.0005
                          ? "text-brand-800"
                          : segment.neutralDelta < -0.0005
                            ? "text-danger-500"
                            : "text-muted"
                      }`}
                      title="Versus policy-neutral weight"
                    >
                      {formatSignedPct(segment.neutralDelta, 2)}
                    </span>
                  )}
                  {segment.vetoActive && (
                    <span className="rounded-sm bg-warn-50 px-1 text-[10px] font-bold text-warn-800" title="Overweight blocked by veto">
                      !
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
