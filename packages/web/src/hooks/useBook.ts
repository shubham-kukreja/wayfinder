import { useMemo } from "react";
import { changeOf, holdingValues, inRange, lotsOf, rangeStart, series, timeline, type HoldingValue, type Point, type Range } from "../lib/aum.js";
import { loadOrders, type Client, type Order } from "../lib/clients.js";
import { useNavs } from "./useNavs.js";

export interface ClientBook {
  client: Client;
  orders: Order[];
  value: number;
  invested: number;
  lastActivity: string | null;
}

/**
 * AUM for a set of clients from their orders and real NAVs: the series over
 * the range, the change excluding new money, holdings by fund, and each
 * client's current value. `version` re-reads orders after one is placed.
 */
export function useBook(clients: Client[], range: Range, version = 0) {
  const orders = useMemo(() => clients.map((c) => ({ client: c, orders: loadOrders(c.id) })), [clients, version]);
  const all = useMemo(() => orders.flatMap((o) => o.orders), [orders]);
  const codes = useMemo(() => [...new Set(all.flatMap((o) => o.lines.map((l) => l.schemeCode)))], [all]);
  const from = useMemo(() => (all.length ? all.reduce((m, o) => (o.date < m ? o.date : m), all[0]!.date) : null), [all]);
  const { navs, error } = useNavs(codes, from);

  return useMemo(() => {
    if (!navs)
      return {
        loading: !error && all.length > 0,
        error,
        points: [] as Point[],
        change: { pct: null, amount: 0 },
        total: 0,
        invested: 0,
        holdings: [] as HoldingValue[],
        clients: [] as ClientBook[],
        navs: null,
        asOf: null as string | null,
      };
    const lots = lotsOf(all, navs);
    const dates = timeline(lots, navs);
    const full = series(lots, navs, dates);
    const points = inRange(full, range);
    const last = full[full.length - 1];
    const asOf = last?.date ?? new Date().toISOString().slice(0, 10);
    const holdings = holdingValues(lots, navs, asOf, rangeStart(range, asOf));
    const books: ClientBook[] = orders.map(({ client, orders: os }) => {
      const hv = holdingValues(lotsOf(os, navs), navs, asOf, asOf);
      return {
        client,
        orders: os,
        value: hv.reduce((s, h) => s + h.value, 0),
        invested: hv.reduce((s, h) => s + h.invested, 0),
        lastActivity: os[0]?.date ?? null,
      };
    });
    return {
      loading: false,
      error,
      points,
      // All time: plain gain over the money put in (the range-change estimate
      // only holds when most of the money was there at the start).
      change:
        range === "MAX" && last && last.invested > 0
          ? { pct: last.value / last.invested - 1, amount: last.value - last.invested }
          : changeOf(points),
      total: last?.value ?? 0,
      invested: last?.invested ?? 0,
      holdings,
      clients: books,
      navs,
      asOf,
    };
  }, [navs, error, all, orders, range]);
}
