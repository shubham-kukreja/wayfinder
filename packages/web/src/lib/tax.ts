import { navOn, type NavMap } from "./aum.js";
import type { Order } from "./clients.js";

// Capital gains on a client's mutual fund units, lot by lot, first in first
// out, under the rules after the July 2024 budget (estimates, not tax advice):
//  - equity funds (equity and sector sleeves): held over 12 months is
//    long-term, 12.5% above ₹1.25 lakh of such gains a financial year; up to
//    12 months is short-term at 20%
//  - debt funds bought from 1 Apr 2023: taxed at the slab rate however long
//    they are held
//  - gold, silver and international fund-of-funds: long-term after 24 months
//    at 12.5%, otherwise the slab rate

export const LTCG_EXEMPTION = 1_25_000;
export const EQUITY_LTCG_RATE = 0.125;
export const EQUITY_STCG_RATE = 0.2;

export type TaxClass = "equity" | "debt" | "other";

export function taxClassOf(sleeve: string): TaxClass {
  if (sleeve.startsWith("equity.intl")) return "other";
  if (sleeve.startsWith("equity.") || sleeve.startsWith("sector.")) return "equity";
  if (sleeve.startsWith("debt.")) return "debt";
  return "other";
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export function isLongTerm(cls: TaxClass, bought: string, on: string): boolean {
  const d = daysBetween(bought, on);
  if (cls === "equity") return d > 365;
  if (cls === "other") return d > 730;
  return false; // debt from 1 Apr 2023: always slab
}

/** Indian financial year start (1 April) for a date. */
export function fyStart(date: string): string {
  const y = Number(date.slice(0, 4));
  return date.slice(5) >= "04-01" ? `${y}-04-01` : `${y - 1}-04-01`;
}

export interface OpenLot {
  schemeCode: string;
  schemeName: string;
  sleeve: string;
  label: string;
  cls: TaxClass;
  bought: string;
  units: number;
  cost: number;
  value: number;
  gain: number;
  longTerm: boolean;
}

export interface Realised {
  schemeCode: string;
  schemeName: string;
  sleeve: string;
  cls: TaxClass;
  bought: string;
  sold: string;
  proceeds: number;
  cost: number;
  gain: number;
  longTerm: boolean;
}

/** Open lots at asOf and gains realised by sells, first in first out. */
export function lotsFifo(orders: Order[], navs: NavMap, asOf: string): { open: OpenLot[]; realised: Realised[] } {
  const queues = new Map<string, Array<{ bought: string; units: number; costPerUnit: number; schemeName: string; sleeve: string; label: string }>>();
  const realised: Realised[] = [];
  const lines = orders
    .flatMap((o) => o.lines.map((l, i) => ({ ...l, date: o.date, seq: i })))
    // Buys before sells on the same day, so a sell-and-rebuy works in order.
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.amount < 0) - Number(b.amount < 0) || a.seq - b.seq);
  for (const l of lines) {
    const nav = navOn(navs.get(l.schemeCode), l.date);
    if (!nav) continue;
    const q = queues.get(l.schemeCode) ?? [];
    queues.set(l.schemeCode, q);
    if (l.amount > 0) {
      q.push({ bought: l.date, units: l.amount / nav, costPerUnit: nav, schemeName: l.schemeName, sleeve: l.sleeve, label: l.label });
      continue;
    }
    let units = -l.amount / nav;
    while (units > 1e-9 && q.length > 0) {
      const lot = q[0]!;
      const take = Math.min(units, lot.units);
      const cls = taxClassOf(lot.sleeve);
      realised.push({
        schemeCode: l.schemeCode,
        schemeName: lot.schemeName,
        sleeve: lot.sleeve,
        cls,
        bought: lot.bought,
        sold: l.date,
        proceeds: take * nav,
        cost: take * lot.costPerUnit,
        gain: take * (nav - lot.costPerUnit),
        longTerm: isLongTerm(cls, lot.bought, l.date),
      });
      lot.units -= take;
      units -= take;
      if (lot.units <= 1e-9) q.shift();
    }
  }
  const open: OpenLot[] = [];
  for (const [code, q] of queues) {
    const nav = navOn(navs.get(code), asOf);
    for (const lot of q) {
      if (lot.units <= 1e-9) continue;
      const cls = taxClassOf(lot.sleeve);
      const cost = lot.units * lot.costPerUnit;
      const value = nav ? lot.units * nav : cost;
      open.push({
        schemeCode: code,
        schemeName: lot.schemeName,
        sleeve: lot.sleeve,
        label: lot.label,
        cls,
        bought: lot.bought,
        units: lot.units,
        cost,
        value,
        gain: value - cost,
        longTerm: isLongTerm(cls, lot.bought, asOf),
      });
    }
  }
  return { open, realised };
}

export interface HarvestLine {
  schemeCode: string;
  schemeName: string;
  sleeve: string;
  label: string;
  /** Rupees to redeem and reinvest the same day. */
  amount: number;
  gain: number;
}

/**
 * Gains harvesting: redeem long-term equity units in gain, oldest first, up
 * to the year's unused ₹1.25 lakh exemption, and reinvest the same day. The
 * cost resets higher, so that much future gain is never taxed.
 */
export function harvestGains(open: OpenLot[], usedThisYear: number): { lines: HarvestLine[]; gain: number; room: number } {
  const room = Math.max(0, LTCG_EXEMPTION - usedThisYear);
  let left = room;
  const by = new Map<string, HarvestLine>();
  const lots = open.filter((l) => l.cls === "equity" && l.longTerm && l.gain > 0).sort((a, b) => a.bought.localeCompare(b.bought));
  for (const l of lots) {
    if (left <= 100) break;
    const share = Math.min(1, left / l.gain);
    const gain = l.gain * share;
    const h = by.get(l.schemeCode) ?? { schemeCode: l.schemeCode, schemeName: l.schemeName, sleeve: l.sleeve, label: l.label, amount: 0, gain: 0 };
    h.amount += l.value * share;
    h.gain += gain;
    by.set(l.schemeCode, h);
    left -= gain;
  }
  const lines = [...by.values()].map((h) => ({ ...h, amount: Math.round(h.amount / 100) * 100 })).filter((h) => h.amount >= 1000);
  return { lines, gain: lines.reduce((s, h) => s + h.gain, 0), room };
}

/** Funds holding a loss that could be booked to offset gains. */
export function harvestLosses(open: OpenLot[]): Array<HarvestLine & { longTerm: boolean }> {
  const by = new Map<string, HarvestLine & { longTerm: boolean }>();
  for (const l of open) {
    if (l.gain >= -100) continue;
    const h = by.get(l.schemeCode) ?? { schemeCode: l.schemeCode, schemeName: l.schemeName, sleeve: l.sleeve, label: l.label, amount: 0, gain: 0, longTerm: l.longTerm };
    h.amount += l.value;
    h.gain += l.gain;
    h.longTerm = h.longTerm && l.longTerm;
    by.set(l.schemeCode, h);
  }
  return [...by.values()].map((h) => ({ ...h, amount: Math.round(h.amount / 100) * 100 })).sort((a, b) => a.gain - b.gain);
}
