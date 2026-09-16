import type { Params, Allocation } from "@wayfinder/engine";
import { apiFetchJson } from "./apiFetch.js";

export async function saveParams(params: Params): Promise<Allocation> {
  const res = await apiFetchJson("/api/params", "POST", params);
  if (!res.ok) throw new Error(`Failed to save params: ${res.status}`);
  return res.json();
}
