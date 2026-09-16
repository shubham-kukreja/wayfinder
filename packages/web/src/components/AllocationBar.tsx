import type { CSSProperties } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import type { Allocation, TiltGroupId } from "@wayfinder/engine";
import { GROUP_LABELS, NODE_LABELS, TILT_GROUP_NODES } from "@wayfinder/engine";
import { formatPct, formatSignedPct } from "../lib/format.js";

// §12.2: stacked proportional bar, not sunburst/donut — angular comparison
// at 2.5% vs 2.4% is unreadable and precision matters more than novelty
// here. The sector sleeve must read as visibly carved out of equity, not
// as a peer segment.
// Flat fills, no gradient/shine overlay - matches the app's sharp,
// flat visual language (no rounded corners, no glossy accents
// anywhere else), so the bar shouldn't be the one glossy holdout.
const SEGMENT_COLORS: Record<string, string> = {
  "l1.equity": "#8690F8",
  "l1.debt": "#B5BAF9",
  "l1.metals": "#F09265",
  "equity.large": "#FBE9E0",
  "equity.mid": "#F4BA9D",
  "equity.small": "#6AD778",
  "equity.intl": "#C165D0",
  "debt.liquid": "#55B957",
  "debt.corporate": "#91EDA6",
  "debt.gilt": "#D5D5D5",
  "metals.gold": "#F09265",
};
// metals.silver uses a diagonal-hatch pattern instead of a flat fill
// (see hatchStyle) rather than a plain color from the map above.
const SILVER_ID = "metals.silver";
const SILVER_HATCH_BASE = "#D5D5D5";
function hatchStyle(id: string): CSSProperties | undefined {
  if (id !== SILVER_ID) return undefined;
  return {
    backgroundColor: SILVER_HATCH_BASE,
    backgroundImage:
      "repeating-linear-gradient(45deg, rgba(0,0,0,0.18) 0, rgba(0,0,0,0.18) 2px, transparent 2px, transparent 8px)",
  };
}
const SLEEVE_COLOR = "#000000";
const SPRING: Transition = { type: "spring", stiffness: 260, damping: 32, mass: 0.8 };

export type AllocationDepth = "overview" | "detail";

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
        color: SEGMENT_COLORS[nodeId] ?? SILVER_HATCH_BASE,
        neutralDelta: node.vsNeutralFinal,
        vetoActive: node.vetoActive,
        isSleeve: false,
      };
    });
  }

  return allocation.rollup.map((r) => {
    const isSleeve = r.id.startsWith("sleeve.");
    const parent = isSleeve ? "equity" : PARENT_BY_ROLLUP_ID[r.id];
    const node = parent && !isSleeve ? allocation.groups[parent].nodes[r.id] : undefined;
    return {
      id: r.id,
      label: r.label,
      weight: r.portfolioWeight,
      color: isSleeve ? SLEEVE_COLOR : SEGMENT_COLORS[r.id] ?? SILVER_HATCH_BASE,
      parent,
      neutralDelta: node ? node.vsNeutralFinal : null,
      vetoActive: !!node?.vetoActive,
      isSleeve,
    };
  });
}

function parentRails(allocation: Allocation): Array<{ id: TiltGroupId; label: string; weight: number; color: string }> {
  return [
    { id: "equity", label: GROUP_LABELS.equity ?? "Equity", weight: allocation.groups.l1.nodes["l1.equity"]!.final, color: SEGMENT_COLORS["l1.equity"] ?? "#6d8ee0" },
    { id: "debt", label: GROUP_LABELS.debt ?? "Debt", weight: allocation.groups.l1.nodes["l1.debt"]!.final, color: SEGMENT_COLORS["l1.debt"] ?? "#5cb684" },
    { id: "metals", label: GROUP_LABELS.metals ?? "Metals", weight: allocation.groups.l1.nodes["l1.metals"]!.final, color: SEGMENT_COLORS["l1.metals"] ?? "#e0a44f" },
  ];
}

export function AllocationBar({
  allocation,
  depth = "detail",
  selectedId,
  onSelect,
  compactLegend = false,
}: {
  allocation: Allocation;
  depth?: AllocationDepth;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  compactLegend?: boolean;
}) {
  const segments = segmentsForDepth(allocation, depth);
  const rails = parentRails(allocation);
  const reduceMotion = useReducedMotion();
  const motionTransition = reduceMotion ? { duration: 0 } : SPRING;
  const detailGroups = rails.map((rail) => ({
    rail,
    segments: segments.filter((segment) => segment.parent === rail.id),
  }));

  return (
    <div>
      {depth === "detail" && (
        <div className="space-y-3 md:hidden">
          {detailGroups.map(({ rail, segments: groupSegments }) => (
            <div key={rail.id} className="rounded-lg border border-neutral-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold uppercase tracking-wide text-neutral-600">{rail.label.replace(" Segments", "")}</span>
                <span className="tabular-nums text-neutral-500">{formatPct(rail.weight, 1)}</span>
              </div>
              <div className="flex h-11 overflow-hidden rounded-md border border-neutral-200">
                {groupSegments.map((segment) => {
                  const isSelected = selectedId === segment.id;
                  return (
                    <motion.button
                      layout
                      key={segment.id}
                      type="button"
                      onClick={() => onSelect?.(segment.id)}
                      aria-label={`${segment.label}, ${formatPct(segment.weight, 1)}${segment.vetoActive ? ", veto active" : ""}`}
                      animate={{ width: `${segment.weight * 100}%` }}
                      transition={motionTransition}
                      style={hatchStyle(segment.id) ?? { backgroundColor: segment.color }}
                      className={`relative min-w-[28px] overflow-hidden border-r border-white/55 text-left focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
                        isSelected ? "ring-2 ring-brand-500 ring-offset-2" : ""
                      }`}
                      title={`${segment.label}: ${formatPct(segment.weight)}${segment.neutralDelta !== null ? ` (${formatSignedPct(segment.neutralDelta, 2)} vs neutral)` : ""}`}
                    >
                      <span className="relative flex h-full flex-col justify-center px-2 text-neutral-900">
                        <span className="truncate text-[10px] font-semibold uppercase tracking-wide">{segment.label}</span>
                        <span className="text-[11px] font-medium tabular-nums">{formatPct(segment.weight, 1)}</span>
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={depth === "detail" ? "hidden md:block" : ""}>
        <motion.div layout className="flex h-16 w-full overflow-hidden rounded-lg border border-neutral-200 bg-white" transition={motionTransition}>
          {segments.map((segment) => {
            const isSelected = selectedId === segment.id;
            const isDimmed = selectedId && !isSelected;
            return (
              <motion.button
                layout
                key={segment.id}
                type="button"
                onClick={() => onSelect?.(segment.id)}
                aria-label={`${segment.label}, ${formatPct(segment.weight, 1)}${segment.vetoActive ? ", veto active" : ""}`}
                animate={{
                  width: `${segment.weight * 100}%`,
                  opacity: isDimmed ? 0.48 : 1,
                  filter: isDimmed ? "saturate(0.7)" : "saturate(1)",
                }}
                transition={motionTransition}
                style={hatchStyle(segment.id) ?? { backgroundColor: segment.color }}
                className={`group relative min-w-[22px] overflow-hidden border-r border-white/55 text-left focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
                  segment.isSleeve ? "border-x border-dashed border-white/70" : ""
                } ${isSelected ? "ring-2 ring-brand-500 ring-offset-2" : ""}`}
                title={`${segment.label}: ${formatPct(segment.weight)}${segment.neutralDelta !== null ? ` (${formatSignedPct(segment.neutralDelta, 2)} vs neutral)` : ""}`}
              >
                <motion.span
                  className="relative flex h-full min-w-0 flex-col justify-center px-2 text-neutral-900"
                  initial={false}
                  animate={{ y: depth === "detail" ? -1 : 0 }}
                  transition={motionTransition}
                >
                  <span className="truncate text-[11px] font-semibold uppercase tracking-wide">{segment.label}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs font-medium tabular-nums">
                    {formatPct(segment.weight, 1)}
                    {segment.vetoActive && <span className="rounded-sm bg-white/60 px-1 text-[10px] text-neutral-900" title="Overweight blocked by veto">!</span>}
                  </span>
                </motion.span>
              </motion.button>
            );
          })}
        </motion.div>

        {depth === "detail" && (
          <motion.div layout className="mt-1 flex gap-1" transition={motionTransition}>
            {rails.map((rail) => (
              <motion.div
                layout
                key={rail.id}
                className="border-t-2 pt-1 text-center text-[10px] font-medium uppercase tracking-wide text-neutral-400"
                animate={{ width: `${rail.weight * 100}%` }}
                transition={motionTransition}
                style={{ borderColor: rail.color }}
              >
                {rail.id}
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      <div className={`mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 ${compactLegend ? "sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-3"}`}>
        {segments.map((segment) => (
          <div key={segment.id} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={hatchStyle(segment.id) ?? { backgroundColor: segment.color }} />
            <span className="truncate text-neutral-600">{segment.label}{segment.isSleeve ? " (sleeve)" : ""}</span>
            <span className="ml-auto font-medium tabular-nums text-neutral-900">{formatPct(segment.weight)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
