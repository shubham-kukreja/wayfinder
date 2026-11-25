import type { Order } from "./clients.js";

// Assets under management from orders and real NAVs: each order line buys
// units at the NAV on (or before) its date; value on any day is units × that
// day's NAV. Change over a range excludes new money (a Modified Dietz
// approximation: gain over the range divided by the starting value plus half
// the money added during it).

export interface NavSeries {
  dates: string[]; // ISO, ascending
  navs: number[];
}

export type NavMap = Map<string, NavSeries>;

/** The NAV on or before date, or null before the first NAV. */
export function navOn(s: NavSeries | undefined, date: string): number | null {
  if (!s || s.dates.length === 0 || date < s.dates[0]!) return null;
  let lo = 0;
  let hi = s.dates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.dates[mid]! <= date) lo = mid;
    else hi = mid - 1;
  }
  return s.navs[lo]!;
}

interface Lot {
  schemeCode: string;
  schemeName: string;
  sleeve: string;
  label: string;
  date: string;
  amount: number;
  units: number | null; // null: no NAV, held at cost
}

export function lotsOf(orders: Order[], navs: NavMap): Lot[] {
  const out: Lot[] = [];
  for (const o of orders) {
    for (const l of o.lines) {
      const nav = navOn(navs.get(l.schemeCode), o.date);
      out.push({ ...l, date: o.date, units: nav ? l.amount / nav : null });
    }
  }
  return out;
}

function lotValue(l: Lot, date: string, navs: NavMap): number {
  if (date < l.date) return 0;
  if (l.units == null) return l.amount;
  const nav = navOn(navs.get(l.schemeCode), date);
  return nav == null ? l.amount : l.units * nav;
}

export interface Point {
  date: string;
  value: number;
  /** Money put in up to and including this date. */
  invested: number;
}

/** Every NAV date from the first order to the latest NAV. */
export function timeline(lots: Lot[], navs: NavMap): string[] {
  if (lots.length === 0) return [];
  const start = lots.reduce((m, l) => (l.date < m ? l.date : m), lots[0]!.date);
  const set = new Set<string>();
  for (const code of new Set(lots.map((l) => l.schemeCode))) {
    for (const d of navs.get(code)?.dates ?? []) if (d >= start) set.add(d);
  }
  for (const l of lots) set.add(l.date);
  return [...set].sort();
}

export function series(lots: Lot[], navs: NavMap, dates: string[]): Point[] {
  return dates.map((date) => {
    let value = 0;
    let invested = 0;
    for (const l of lots) {
      if (date < l.date) continue;
      value += lotValue(l, date, navs);
      invested += l.amount;
    }
    return { date, value, invested };
  });
}

export type Range = "1D" | "1W" | "1M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX";
/** The dashboard's ranges. */
export const RANGES: Range[] = ["1W", "1M", "6M", "YTD", "1Y", "MAX"];

export function rangeStart(range: Range, last: string): string {
  const d = new Date(`${last}T00:00:00Z`);
  switch (range) {
    case "1D":
      d.setUTCDate(d.getUTCDate() - 1);
      break;
    case "5Y":
      d.setUTCFullYear(d.getUTCFullYear() - 5);
      break;
    case "1W":
      d.setUTCDate(d.getUTCDate() - 7);
      break;
    case "1M":
      d.setUTCMonth(d.getUTCMonth() - 1);
      break;
    case "6M":
      d.setUTCMonth(d.getUTCMonth() - 6);
      break;
    case "YTD":
      return `${last.slice(0, 4)}-01-01`;
    case "1Y":
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      break;
    case "MAX":
      return "0000-01-01";
  }
  return d.toISOString().slice(0, 10);
}

export function inRange(points: Point[], range: Range): Point[] {
  if (points.length === 0) return points;
  const from = rangeStart(range, points[points.length - 1]!.date);
  const i = points.findIndex((p) => p.date >= from);
  // Include the last point before the range, so the change has a base.
  return points.slice(Math.max(0, (i < 0 ? points.length - 1 : i) - 1));
}

/** Return over the points, excluding money added during them. */
export function changeOf(points: Point[]): { pct: number | null; amount: number } {
  if (points.length < 2) return { pct: null, amount: 0 };
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const flows = b.invested - a.invested;
  const gain = b.value - a.value - flows;
  const base = a.value + flows / 2;
  return { pct: base > 0 ? gain / base : null, amount: gain };
}

export interface HoldingValue {
  schemeCode: string;
  schemeName: string;
  sleeve: string;
  label: string;
  invested: number;
  value: number;
  /** NAV change over the range. */
  navChange: number | null;
}

export function holdingValues(lots: Lot[], navs: NavMap, asOf: string, from: string): HoldingValue[] {
  const by = new Map<string, HoldingValue>();
  for (const l of lots) {
    const h = by.get(l.schemeCode) ?? { schemeCode: l.schemeCode, schemeName: l.schemeName, sleeve: l.sleeve, label: l.label, invested: 0, value: 0, navChange: null };
    h.invested += l.amount;
    h.value += lotValue(l, asOf, navs);
    by.set(l.schemeCode, h);
  }
  for (const h of by.values()) {
    const s = navs.get(h.schemeCode);
    const a = navOn(s, from) ?? s?.navs[0] ?? null;
    const b = navOn(s, asOf);
    h.navChange = a && b ? b / a - 1 : null;
  }
  return [...by.values()].sort((x, y) => y.value - x.value);
}

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;

/**
 * Time-weighted return over the points: each day's growth with that day's
 * new money taken out, chained. Not affected by when money was added.
 */
export function twr(points: Point[]): number | null {
  if (points.length < 2) return null;
  let g = 1;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (prev.value <= 0) continue;
    const flow = cur.invested - prev.invested;
    g *= (cur.value - flow) / prev.value;
  }
  return g - 1;
}

/** CAGR: the time-weighted return, annualised. Null under a year. */
export function cagr(points: Point[]): number | null {
  if (points.length < 2) return null;
  const span = days(points[0]!.date, points[points.length - 1]!.date);
  const r = twr(points);
  if (r == null || span < 365) return null;
  return (1 + r) ** (365 / span) - 1;
}

/**
 * XIRR: the annual rate that discounts the cash flows to zero — the value at
 * the start (or the first investment) and each new investment going in, the
 * value at the end coming out. Null under a year or when it does not solve.
 */
export function xirr(points: Point[]): number | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (days(first.date, last.date) < 365) return null;
  const flows: Array<{ t: number; v: number }> = [{ t: 0, v: -first.value }];
  for (let i = 1; i < points.length; i++) {
    const f = points[i]!.invested - points[i - 1]!.invested;
    if (f !== 0) flows.push({ t: days(first.date, points[i]!.date) / 365, v: -f });
  }
  flows.push({ t: days(first.date, last.date) / 365, v: last.value });
  const npv = (r: number) => flows.reduce((s, f) => s + f.v / (1 + r) ** f.t, 0);
  let lo = -0.99;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-7) break;
  }
  return (lo + hi) / 2;
}
