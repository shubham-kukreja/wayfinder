import type Database from "better-sqlite3";
import { realRatesScore } from "@wayfinder/engine";
import { latestObservations } from "../store/observations.js";

// §8.4 — us_real_10y_6m_change (bp) drives both l1.metals::macro (gold
// column) and metals.{gold,silver}::real_rates. This is the one series the
// brief promises is "fully automatic from FRED" end-to-end, so it is the
// M2 gating acceptance test: a live us_real_10y history in the store must
// produce a real metals.*::real_rates score with no manual step.
export function usReal10y6mChangeBp(db: Database.Database, asOfDate: string): number | null {
  const rows = latestObservations(db, "us_real_10y");
  if (rows.length === 0) return null;

  const asOf = new Date(asOfDate);
  const sixMonthsAgo = new Date(asOf);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // Latest observation at or before asOfDate.
  const current = [...rows].filter((r) => new Date(r.date) <= asOf).pop();
  if (!current) return null;

  // Closest observation at or before the 6-months-ago mark.
  const past = [...rows].filter((r) => new Date(r.date) <= sixMonthsAgo).pop();
  if (!past) return null;

  // Both values are yields in percent; bp = percentage-point change * 100.
  return (current.value - past.value) * 100;
}

export function deriveRealRatesScores(
  db: Database.Database,
  asOfDate: string
): { "metals.gold::real_rates": number; "metals.silver::real_rates": number; "l1.metals::macro": number } | null {
  const changeBp = usReal10y6mChangeBp(db, asOfDate);
  if (changeBp === null) return null;
  return {
    "metals.gold::real_rates": realRatesScore(changeBp, "gold"),
    "metals.silver::real_rates": realRatesScore(changeBp, "silver"),
    "l1.metals::macro": realRatesScore(changeBp, "gold"), // §8.4: same table drives the gold column of l1.metals::macro
  };
}
