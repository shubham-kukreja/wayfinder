import type { Allocation } from "@wayfinder/engine";
import { basketById, basketLabel } from "./baskets.js";
import type { FundScore } from "./coreApi.js";

// Clients, for now a frontend fixture: people, each in a basket (a
// core risk profile). Their plan is derived live from the model allocation
// and Fund Rankings; nothing about a client is stored server-side yet.

export interface Client {
  id: string;
  name: string;
  /** Total net worth, ₹. */
  netWorth: number;
  /** The suggested amount for the next investment, ₹. */
  investable: number;
  /** Basket (client archetype) id, lib/baskets.ts. */
  basket: string;
  basketName: string;
  since: string;
  city: string;
}

// Clients sit in different archetypes; every archetype uses the Balanced
// model for now (lib/baskets.ts).
const A = (id: string) => {
  const b = basketById(id)!;
  return { basket: id, basketName: basketLabel(b) };
};

export const CLIENTS: Client[] = [
  { id: "hrishikesh-patwardhan", name: "Hrishikesh Patwardhan", netWorth: 3_40_00_000, investable: 10_00_000, since: "2024-02-12", city: "Mumbai", ...A("a4") },
  { id: "devika-ramaswamy", name: "Devika Ramaswamy", netWorth: 1_10_00_000, investable: 5_00_000, since: "2024-06-03", city: "Bengaluru", ...A("a5") },
  { id: "kabir-sethi", name: "Kabir Sethi", netWorth: 6_75_00_000, investable: 25_00_000, since: "2024-03-18", city: "Delhi", ...A("a3b-ii") },
  { id: "nandini-chaturvedi", name: "Nandini Chaturvedi", netWorth: 85_00_000, investable: 3_00_000, since: "2025-01-20", city: "Chennai", ...A("a2") },
  { id: "arjun-venkataraman", name: "Arjun Venkataraman", netWorth: 2_20_00_000, investable: 10_00_000, since: "2024-09-09", city: "Jaipur", ...A("a3a") },
  { id: "ritika-bhattacharjee", name: "Ritika Bhattacharjee", netWorth: 1_60_00_000, investable: 5_00_000, since: "2025-04-14", city: "Pune", ...A("a4") },
  { id: "zoya-merchant", name: "Zoya Merchant", netWorth: 4_10_00_000, investable: 15_00_000, since: "2025-07-07", city: "Gurugram", ...A("a4") },
  { id: "parth-oberoi", name: "Parth Oberoi", netWorth: 70_00_000, investable: 2_00_000, since: "2026-08-25", city: "Hyderabad", ...A("a1") },
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
 * Splits the investable amount over the allocation's sleeves, in the model's
 * order, rounded to ₹100 with the remainder on the largest line so the total
 * is exact.
 */
export function planLines(allocation: Allocation, investable: number, color: (id: string) => string): PlanLine[] {
  const rows = allocation.rollup.filter((r) => r.portfolioWeight > 0.0005);
  const total = rows.reduce((s, r) => s + r.portfolioWeight, 0) || 1;
  const lines = rows.map((r) => {
    const weight = r.portfolioWeight / total;
    return { sleeve: r.id, label: r.label, weight, amount: Math.round((weight * investable) / 100) * 100, color: color(r.id) };
  });
  const diff = investable - lines.reduce((s, l) => s + l.amount, 0);
  const largest = lines.reduce<PlanLine | null>((m, l) => (!m || l.amount > m.amount ? l : m), null);
  if (largest) largest.amount += diff;
  return lines;
}

// ---- orders and holdings (kept in this browser) ---------------------------------

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
  /** A past investment from the client records (not placed here). */
  seed?: boolean;
  /** invest: new money; rebalance: sells and buys that net to zero. */
  kind?: "invest" | "rebalance" | "harvest";
}

// Past investments, split across one fund per sleeve in roughly the model's
// weights. Values over time come from real NAVs.
type Seed = Omit<OrderLine, "amount"> & { share: number };
const L = (sleeve: string, label: string, schemeCode: string, schemeName: string, share: number): Seed => ({ sleeve, label, schemeCode, schemeName, share });

// Three line-ups of real funds (from Fund Rankings and fund search), so the
// book holds a spread of funds rather than one set.
const LINEUPS: Record<"a" | "b" | "c", Seed[]> = {
  a: [
    L("equity.large", "Large Cap", "119018", "HDFC Large Cap Fund", 0.25),
    L("equity.mid", "Mid Cap", "118668", "Nippon India Growth Mid Cap Fund", 0.12),
    L("equity.small", "Small Cap", "119589", "Sundaram Small Cap Fund", 0.08),
    L("equity.intl", "International", "119517", "Aditya Birla Sun Life International Equity Fund", 0.1),
    L("debt.liquid", "Liquid", "118701", "Nippon India Liquid Fund", 0.14),
    L("debt.corporate", "Corporate", "133791", "Kotak Corporate Bond Fund", 0.12),
    L("debt.gilt", "Gilt", "120520", "Invesco India Gilt Fund", 0.09),
    L("metals.gold", "Gold", "119781", "Kotak Gold Fund", 0.07),
    L("metals.silver", "Silver", "150615", "Axis Silver Fund of Fund", 0.03),
  ],
  b: [
    L("equity.large", "Large Cap", "118632", "Nippon India Large Cap Fund", 0.15),
    L("equity.large", "Large Cap", "118269", "Canara Robeco Large Cap Fund", 0.1),
    L("equity.mid", "Mid Cap", "120403", "Invesco India Mid Cap Fund", 0.12),
    L("equity.small", "Small Cap", "118778", "Nippon India Small Cap Fund", 0.08),
    L("equity.intl", "International", "118551", "Franklin U. S. Opportunities Equity Active Fund of Funds", 0.1),
    L("debt.liquid", "Liquid", "119091", "HDFC Liquid Fund", 0.14),
    L("debt.corporate", "Corporate", "120692", "ICICI Prudential Corporate Bond Fund", 0.12),
    L("debt.gilt", "Gilt", "120520", "Invesco India Gilt Fund", 0.09),
    L("metals.gold", "Gold", "119132", "HDFC Gold ETF Fund of Fund", 0.07),
    L("metals.silver", "Silver", "149775", "ICICI Prudential Silver ETF FOF", 0.03),
  ],
  c: [
    L("equity.large", "Large Cap", "118825", "Mirae Asset Large Cap Fund", 0.25),
    L("equity.mid", "Mid Cap", "118989", "HDFC Mid Cap Fund", 0.12),
    L("equity.small", "Small Cap", "125354", "Axis Small Cap Fund", 0.08),
    L("equity.intl", "International", "119517", "Aditya Birla Sun Life International Equity Fund", 0.1),
    L("debt.liquid", "Liquid", "118701", "Nippon India Liquid Fund", 0.14),
    L("debt.corporate", "Corporate", "133791", "Kotak Corporate Bond Fund", 0.12),
    L("debt.gilt", "Gilt", "120520", "Invesco India Gilt Fund", 0.09),
    L("metals.gold", "Gold", "118663", "Nippon India Gold Savings Fund", 0.07),
    L("metals.silver", "Silver", "150615", "Axis Silver Fund of Fund", 0.03),
  ],
};

function seedOrder(id: string, date: string, amount: number, lineup: keyof typeof LINEUPS = "a"): Order {
  const lines = LINEUPS[lineup].map(({ share, ...l }) => ({ ...l, amount: Math.round((amount * share) / 100) * 100 }));
  lines[0]!.amount += amount - lines.reduce((s, l) => s + l.amount, 0);
  return { id, date, amount, lines, seed: true };
}

const SEED_ORDERS: Record<string, Order[]> = {
  "hrishikesh-patwardhan": [seedOrder("a1", "2024-02-12", 60_00_000, "a"), seedOrder("a2", "2025-03-10", 25_00_000, "c")],
  "devika-ramaswamy": [seedOrder("p1", "2024-06-03", 30_00_000, "b")],
  "kabir-sethi": [seedOrder("r1", "2024-03-18", 1_50_00_000, "a"), seedOrder("r2", "2025-06-16", 40_00_000, "b"), seedOrder("r3", "2026-05-11", 20_00_000, "c")],
  "nandini-chaturvedi": [seedOrder("n1", "2025-01-20", 18_00_000, "b")],
  "arjun-venkataraman": [seedOrder("v1", "2024-09-09", 55_00_000, "c"), seedOrder("v2", "2026-02-02", 12_00_000, "a")],
  "ritika-bhattacharjee": [seedOrder("m1", "2025-04-14", 35_00_000, "b")],
  "zoya-merchant": [seedOrder("k1", "2025-07-07", 90_00_000, "c"), seedOrder("k2", "2026-09-14", 15_00_000, "b")],
  "parth-oberoi": [seedOrder("s1", "2026-08-25", 12_00_000, "c")],
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
