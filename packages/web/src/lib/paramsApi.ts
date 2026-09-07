import type { Params, Allocation } from "@wayfinder/engine";
import { API_BASE_URL } from "./constants.js";

export async function saveParams(params: Params): Promise<Allocation> {
  const res = await fetch(`${API_BASE_URL}/api/params`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Failed to save params: ${res.status}`);
  return res.json();
}
