import type { ScoreState, Confidence } from "@wayfinder/engine";
import { apiFetchJson } from "./apiFetch.js";

export async function saveScore(id: string, value: number, note?: string, confidence?: Confidence): Promise<ScoreState> {
  const res = await apiFetchJson("/api/scores", "POST", { id, value, note, confidence });
  if (!res.ok) throw new Error(`Failed to save score: ${res.status}`);
  return res.json();
}
