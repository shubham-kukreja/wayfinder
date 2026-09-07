import type { ScoreState, Confidence } from "@wayfinder/engine";
import { API_BASE_URL } from "./constants.js";

export async function saveScore(id: string, value: number, note?: string, confidence?: Confidence): Promise<ScoreState> {
  const res = await fetch(`${API_BASE_URL}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, value, note, confidence }),
  });
  if (!res.ok) throw new Error(`Failed to save score: ${res.status}`);
  return res.json();
}
