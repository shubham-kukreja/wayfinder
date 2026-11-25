import type { Allocation } from "@wayfinder/engine";
import type { FundScore } from "./coreApi.js";

// Clients, for now a frontend fixture: demo people, each in a basket (a
// core risk profile). Their plan is derived live from the model allocation
// and Fund Rankings; nothing about a client is stored server-side yet.

export interface Client {
  id: string;
  name: string;
  /** Total net worth, ₹. */
  netWorth: number;
  /** The suggested amount for the next investment, ₹. */
  investable: number;
  /** Core risk profile key. */
  basket: string;
  basketName: string;
  since: string;
}

export const CLIENTS: Client[] = [
  { id: "demo-aarav", name: "Aarav Mehta", netWorth: 1_20_00_000, investable: 10_00_000, basket: "balanced", basketName: "Balanced", since: "2026-04-01" },
  { id: "demo-priya", name: "Priya Nair", netWorth: 45_00_000, investable: 5_00_000, basket: "balanced", basketName: "Balanced", since: "2026-08-15" },
];

export const clientById = (id: string | undefined) => CLIENTS.find((c) => c.id === id) ?? null;

/** A fund the plan can buy. */
export interface FundChoice {
  schemeCode: string;
  schemeName: string;
  amc?: string;
  status?: FundScore["status"];
  rank?: number | null;
  rankedOf?: number | null;
  composite?: number | null;
  /** Where the pick came from. */
  source: "ranking" | "default" | "search";
}

// Which Fund Rankings category serves each sleeve, and (for categories that
// mix sleeves, like Precious Metals) a name test. Debt sleeves have no
// ranking yet and fall back to the sleeve's default fund.
const SLEEVE_CATEGORY: Record<string, { category: string; match?: RegExp }> = {
  "equity.large": { category: "large_cap" },
  "equity.mid": { category: "mid_cap" },
  "equity.small": { category: "small_cap" },
  "equity.intl": { category: "global_fof" },
  "metals.gold": { category: "precious_metals", match: /gold/i },
  "metals.silver": { category: "precious_metals", match: /silver/i },
  "sector.banking": { category: "thematic_banking" },
  "sector.it": { category: "thematic_technology" },
  "sector.pharma": { category: "thematic_healthcare" },
  "sector.fmcg": { category: "thematic_consumption" },
  "sector.capgoods": { category: "thematic_infrastructure" },
  "sector.auto": { category: "thematic_other", match: /auto|transport|mobility/i },
  "sector.energy": { category: "thematic_other", match: /energy|power|psu|commodit/i },
  "sector.metals": { category: "thematic_other", match: /metal|commodit/i },
};

export const sleeveCategory = (sleeve: string) => SLEEVE_CATEGORY[sleeve] ?? null;

const STATUS_ORDER: Record<FundScore["status"], number> = { shortlist: 0, below_cutoff: 1, filtered_out: 2, incomplete: 3 };

/** A sleeve's ranked candidates, best first: shortlist by rank, then the rest. */
export function candidatesFor(sleeve: string, funds: FundScore[]): FundChoice[] {
  const m = SLEEVE_CATEGORY[sleeve];
  return funds
    .filter((f) => !m?.match || m.match.test(f.name))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name))
    .map((f) => ({
      schemeCode: f.scheme_code,
      schemeName: f.name,
      amc: f.amc,
      status: f.status,
      rank: f.rank,
      rankedOf: f.ranked_of,
      composite: f.composite,
      source: "ranking" as const,
    }));
}

export interface PlanLine {
  sleeve: string;
  label: string;
  weight: number; // 0-1 of the portfolio
  amount: number; // ₹, rounded to ₹100
  color: string;
}

/**
 * Splits the investable amount over the allocation's sleeves (rounded to
 * ₹100, the remainder on the largest line so the total is exact), largest
 * amount first.
 */
export function planLines(allocation: Allocation, investable: number, color: (id: string) => string): PlanLine[] {
  const rows = allocation.rollup.filter((r) => r.portfolioWeight > 0.0005);
  const total = rows.reduce((s, r) => s + r.portfolioWeight, 0) || 1;
  const lines = rows.map((r) => {
    const weight = r.portfolioWeight / total;
    return { sleeve: r.id, label: r.label, weight, amount: Math.round((weight * investable) / 100) * 100, color: color(r.id) };
  });
  lines.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  const diff = investable - lines.reduce((s, l) => s + l.amount, 0);
  if (lines[0]) lines[0].amount += diff;
  return lines;
}

// ---- orders and holdings (demo: kept in this browser) --------------------------

export interface OrderLine {
  sleeve: string;
  label: string;
  schemeCode: string;
  schemeName: string;
  amount: number;
}

export interface Order {
  id: string;
  date: string; // ISO date
  amount: number;
  lines: OrderLine[];
  /** True for the fixture's opening order. */
  seed?: boolean;
}

// Aarav's opening investment, so "invest more" has holdings to add to.
const SEED_ORDERS: Record<string, Order[]> = {
  "demo-aarav": [
    {
      id: "seed-1",
      date: "2026-04-01",
      amount: 30_00_000,
      seed: true,
      lines: [
        { sleeve: "equity.large", label: "Large Cap", schemeCode: "119018", schemeName: "HDFC Large Cap Fund", amount: 7_50_000 },
        { sleeve: "debt.liquid", label: "Liquid", schemeCode: "118701", schemeName: "Nippon India Liquid Fund", amount: 4_50_000 },
        { sleeve: "debt.corporate", label: "Corporate", schemeCode: "133791", schemeName: "Kotak Corporate Bond Fund", amount: 4_00_000 },
        { sleeve: "equity.mid", label: "Mid Cap", schemeCode: "118668", schemeName: "Nippon India Growth Mid Cap Fund", amount: 3_50_000 },
        { sleeve: "debt.gilt", label: "Gilt", schemeCode: "120520", schemeName: "Invesco India Gilt Fund", amount: 3_00_000 },
        { sleeve: "equity.small", label: "Small Cap", schemeCode: "119589", schemeName: "Sundaram Small Cap Fund", amount: 2_50_000 },
        { sleeve: "equity.intl", label: "International", schemeCode: "119517", schemeName: "Aditya Birla Sun Life International Equity Fund", amount: 2_50_000 },
        { sleeve: "metals.gold", label: "Gold", schemeCode: "119781", schemeName: "Kotak Gold Fund", amount: 2_50_000 },
      ],
    },
  ],
};

const ordersKey = (id: string) => `core.clients.${id}.orders`;

export function loadOrders(clientId: string): Order[] {
  let placed: Order[] = [];
  try {
    const raw = localStorage.getItem(ordersKey(clientId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) placed = parsed as Order[];
  } catch {
    placed = [];
  }
  return [...placed, ...(SEED_ORDERS[clientId] ?? [])].sort((a, b) => b.date.localeCompare(a.date));
}

export function placeOrder(clientId: string, order: Order): void {
  const placed = loadOrders(clientId).filter((o) => !o.seed);
  try {
    localStorage.setItem(ordersKey(clientId), JSON.stringify([order, ...placed]));
  } catch {
    // Private mode or blocked storage: the order is not kept.
  }
}

export function resetOrders(clientId: string): void {
  try {
    localStorage.removeItem(ordersKey(clientId));
  } catch {
    /* nothing to clear */
  }
}

export interface Holding {
  schemeCode: string;
  schemeName: string;
  sleeve: string;
  label: string;
  invested: number;
}

/** Invested amount per fund across all orders, largest first. */
export function holdingsOf(orders: Order[]): Holding[] {
  const by = new Map<string, Holding>();
  for (const o of orders) {
    for (const l of o.lines) {
      const h = by.get(l.schemeCode) ?? { schemeCode: l.schemeCode, schemeName: l.schemeName, sleeve: l.sleeve, label: l.label, invested: 0 };
      h.invested += l.amount;
      by.set(l.schemeCode, h);
    }
  }
  return [...by.values()].sort((a, b) => b.invested - a.invested);
}

/** The asset class a sleeve belongs to (sector sleeves sit in equity). */
export function assetClassOf(sleeve: string): "equity" | "debt" | "metals" {
  if (sleeve.startsWith("debt.")) return "debt";
  if (sleeve.startsWith("metals.")) return "metals";
  return "equity";
}
