import { useEffect, useState } from "react";
import type { NavMap } from "../lib/aum.js";
import { coreFetch } from "../lib/coreApi.js";

const cache = new Map<string, Promise<NavMap>>();

async function fetchNavs(codes: string[], from: string): Promise<NavMap> {
  const out: NavMap = new Map();
  for (let i = 0; i < codes.length; i += 25) {
    const batch = codes.slice(i, i + 25);
    const res = await coreFetch<{ data: Array<{ scheme_code: string; navs: Array<{ date: string; nav: number }> }> }>(
      `/v1/funds/navs?codes=${batch.join(",")}&from=${from}`,
    );
    for (const f of res.data) out.set(f.scheme_code, { dates: f.navs.map((n) => n.date), navs: f.navs.map((n) => n.nav) });
  }
  return out;
}

/** Daily NAVs for the funds, from the given date (cached per page load). */
export function useNavs(codes: string[], from: string | null): { navs: NavMap | null; error: string | null } {
  const key = from ? `${[...codes].sort().join(",")}@${from}` : "";
  const [state, setState] = useState<{ key: string; navs: NavMap | null; error: string | null }>({ key: "", navs: null, error: null });
  useEffect(() => {
    if (!key || codes.length === 0 || !from) return;
    let live = true;
    let p = cache.get(key);
    if (!p) {
      p = fetchNavs([...new Set(codes)].sort(), from);
      cache.set(key, p);
      p.catch(() => cache.delete(key));
    }
    p.then((navs) => live && setState({ key, navs, error: null })).catch(
      (e: unknown) => live && setState({ key, navs: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return state.key === key ? { navs: state.navs, error: state.error } : { navs: null, error: null };
}
