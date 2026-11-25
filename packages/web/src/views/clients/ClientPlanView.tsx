import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  segmentColor,
  stickyClassTotals,
} from "../../components/AllocationBar.js";
import { AmountInput } from "../../components/ui/AmountInput.js";
import { Pill } from "../../components/ui/Pill.js";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "../../components/ui/SearchableSelect.js";
import { SegmentedBar } from "../../components/ui/SegmentedBar.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";
import { listDefaultFunds, searchSchemes } from "../../lib/backtestApi.js";
import { formatRupees, formatRupeesCompact } from "../../lib/backtestFormat.js";
import {
  candidatesFor,
  clientById,
  planLines,
  sleeveCategory,
  type FundChoice,
  type PlanLine,
} from "../../lib/clients.js";
import { fundScoresApi, type FundScore } from "../../lib/coreApi.js";
import { formatPct } from "../../lib/format.js";
import { STATUS_LABEL, STATUS_TONE } from "../funds/fundFormat.js";

// A client's investment plan: the model allocation (published, else the
// draft) applied to the client's investable amount, one fund per sleeve —
// the top of the sleeve's Fund Rankings shortlist by default, switchable to
// any ranked alternative or any fund by search — listed largest amount first.

type Picks = Record<string, FundChoice>;

function storageKey(id: string) {
  return `core.clients.${id}`;
}

function loadState(id: string): { investable?: number; picks?: Picks } {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw
      ? (JSON.parse(raw) as { investable?: number; picks?: Picks })
      : {};
  } catch {
    return {};
  }
}

function saveState(id: string, state: { investable: number; picks: Picks }) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(state));
  } catch {
    // Private mode or blocked storage: changes last for this visit only.
  }
}

const formatDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function ClientPlanView() {
  const { id } = useParams();
  const client = clientById(id);
  const { data, allocation, loading, error } = useCoreAllocation();

  const [investable, setInvestable] = useState(() =>
    client ? (loadState(client.id).investable ?? client.investable) : 0,
  );
  const [picks, setPicks] = useState<Picks>(() =>
    client ? (loadState(client.id).picks ?? {}) : {},
  );
  const [rankings, setRankings] = useState<Record<string, FundScore[]>>({});
  const [defaults, setDefaults] = useState<Record<string, FundChoice>>({});
  const [fundsError, setFundsError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (client) saveState(client.id, { investable, picks });
  }, [client, investable, picks]);

  const lines = useMemo(
    () =>
      allocation
        ? planLines(allocation, investable, (sid) =>
            segmentColor(sid, allocation),
          )
        : [],
    [allocation, investable],
  );

  // Rankings for every category the plan's sleeves draw on, and the
  // per-sleeve default funds for sleeves with no ranking (debt).
  const categoryKeys = useMemo(
    () =>
      [
        ...new Set(
          lines
            .map((l) => sleeveCategory(l.sleeve)?.category)
            .filter((c): c is string => !!c),
        ),
      ]
        .sort()
        .join(","),
    [lines],
  );
  useEffect(() => {
    if (!categoryKeys) return;
    const ac = new AbortController();
    Promise.all(
      categoryKeys.split(",").map((k) =>
        fundScoresApi
          .category(k, ac.signal)
          .then((r) => [k, r.funds] as const)
          .catch(() => [k, [] as FundScore[]] as const),
      ),
    ).then(
      (pairs) => !ac.signal.aborted && setRankings(Object.fromEntries(pairs)),
    );
    return () => ac.abort();
  }, [categoryKeys]);
  useEffect(() => {
    listDefaultFunds()
      .then((ds) =>
        setDefaults(
          Object.fromEntries(
            ds.map((d) => [
              d.sleeveId,
              {
                schemeCode: d.schemeCode,
                schemeName: d.schemeName,
                source: "default" as const,
              },
            ]),
          ),
        ),
      )
      .catch((e: unknown) =>
        setFundsError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  const candidates = useMemo(() => {
    const out: Record<string, FundChoice[]> = {};
    for (const l of lines) {
      const cat = sleeveCategory(l.sleeve);
      out[l.sleeve] = cat
        ? candidatesFor(l.sleeve, rankings[cat.category] ?? [])
        : [];
    }
    return out;
  }, [lines, rankings]);

  const chosen = (sleeve: string): FundChoice | null => {
    if (picks[sleeve]) return picks[sleeve]!;
    const c = candidates[sleeve] ?? [];
    return c[0] ?? defaults[sleeve] ?? null;
  };

  if (!client) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
        <p className="text-sm text-muted">
          No such client.{" "}
          <Link to="/clients" className="font-semibold text-ink underline">
            All clients
          </Link>
        </p>
      </div>
    );
  }

  const segments = lines.map((l) => ({
    id: l.sleeve,
    label: l.label,
    weight: l.weight,
    color: l.color,
  }));
  const classTotals = allocation
    ? stickyClassTotals(allocation).map((c) => ({
        ...c,
        label: c.label.replace(" Segments", "").replace(" Buckets", ""),
      }))
    : [];
  const unpicked = lines.filter((l) => !chosen(l.sleeve)).length;
  const asOf = data ? formatDay(data.version.as_of) : null;
  const isDraft = data?.version.kind === "draft";

  async function copyPlan() {
    const text = [
      `${client!.name} · ${client!.basketName} basket · ${formatRupees(investable)}${asOf ? ` · model as of ${asOf}` : ""}`,
      ...lines.map((l, i) => {
        const f = chosen(l.sleeve);
        return `${i + 1}. ${formatRupees(l.amount)}  ${f?.schemeName ?? "(no fund picked)"}  [${l.label}, ${formatPct(l.weight, 1)}]`;
      }),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <Link to="/clients" className="text-[13px] text-muted hover:text-ink">
        ← All clients
      </Link>
      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">
            Client · demo
          </p>
          <h1 className="mt-1 font-display text-2xl text-ink">{client.name}</h1>
          <p className="mt-2 text-[13px] text-muted">
            {client.basketName} basket · client since {formatDay(client.since)}
          </p>
        </div>
        <button
          type="button"
          onClick={copyPlan}
          disabled={lines.length === 0}
          className="inline-flex items-center rounded-md bg-ink px-[22px] py-[11px] text-sm font-semibold text-paper transition duration-100 ease-in hover:-translate-y-px hover:brightness-[1.06] disabled:opacity-40"
        >
          {copied ? "Copied" : "Copy plan"}
        </button>
      </header>

      <div className="mt-6 grid grid-cols-2 divide-line border border-line sm:grid-cols-4 sm:divide-x">
        <Stat label="Net worth" value={formatRupeesCompact(client.netWorth)} />
        <Stat label="Basket" value={client.basketName} />
        <div className="border-t border-line px-5 py-4 sm:border-t-0">
          <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">
            To invest
          </p>
          <AmountInput
            value={investable}
            onChange={(v) => setInvestable(Math.max(0, Math.round(v)))}
            className="mt-1.5 w-40"
          />
        </div>
        <Stat
          label="Of net worth"
          value={
            client.netWorth > 0
              ? formatPct(investable / client.netWorth, 0)
              : "–"
          }
        />
      </div>

      {isDraft && (
        <p className="mt-4 border border-warn-200 bg-warn-50 px-4 py-2 text-[13px] text-warn-800">
          Nothing is published yet; this plan uses the shared draft allocation
          {asOf ? ` as of ${asOf}` : ""}.
        </p>
      )}
      {error && (
        <p className="mt-6 text-[13px] text-danger-500">
          Failed to load the model allocation: {error}
        </p>
      )}
      {fundsError && (
        <p className="mt-6 text-[13px] text-danger-500">
          Failed to load default funds: {fundsError}
        </p>
      )}

      {allocation && (
        <section className="mt-6 border border-line bg-paper px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-ink">
              Model allocation
              {asOf && !isDraft ? ` · published, as of ${asOf}` : ""}
            </h2>
            <div className="flex flex-wrap items-center gap-4">
              {classTotals.map((c) => (
                <span key={c.id} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="text-[13px] font-semibold text-ink-2">
                    {c.label}
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums text-ink">
                    {formatPct(c.weight, 1)}
                  </span>
                  <span className="text-[13px] tabular-nums text-muted">
                    {formatRupeesCompact(c.weight * investable)}
                  </span>
                </span>
              ))}
            </div>
          </div>
          <SegmentedBar segments={segments} legend={false} className="mt-3" />
        </section>
      )}

      <section className="mt-6 border border-line bg-paper">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-paper-2 px-5 py-3">
          <h2 className="text-[13px] font-semibold text-ink">
            Investment plan · largest amount first
          </h2>
          <p className="text-[12px] text-muted">
            {lines.length} purchases ·{" "}
            {formatRupees(lines.reduce((s, l) => s + l.amount, 0))}
            {unpicked > 0 && ` · ${unpicked} without a fund`}
          </p>
        </div>
        {loading && (
          <div className="px-5 py-10 text-sm text-muted">
            Loading the model allocation…
          </div>
        )}
        {!loading && lines.length === 0 && !error && (
          <div className="px-5 py-10 text-sm text-muted">
            Enter an amount to invest.
          </div>
        )}
        <ol className="divide-y divide-line">
          {lines.map((l, i) => (
            <PlanRow
              key={l.sleeve}
              step={i + 1}
              line={l}
              fund={chosen(l.sleeve)}
              options={candidates[l.sleeve] ?? []}
              fallback={defaults[l.sleeve] ?? null}
              overridden={!!picks[l.sleeve]}
              onPick={(f) => setPicks((p) => ({ ...p, [l.sleeve]: f }))}
              onReset={() =>
                setPicks((p) => {
                  const next = { ...p };
                  delete next[l.sleeve];
                  return next;
                })
              }
            />
          ))}
        </ol>
      </section>
      <p className="mt-3 text-[12px] text-muted">
        Funds default to the top of each sleeve's Fund Rankings shortlist;
        sleeves without a ranking (debt) use the sleeve's default fund. Amounts
        are rounded to ₹100. Changes on this page are kept in this browser only.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4 [&:nth-child(n+3)]:border-t [&:nth-child(n+3)]:border-line sm:[&:nth-child(n+3)]:border-t-0">
      <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

/** Rank and score for a ranked fund; where an unranked one came from. */
function rankText(f: FundChoice): string {
  if (f.source === "ranking") {
    const rank = f.rank
      ? `#${f.rank}${f.rankedOf ? ` of ${f.rankedOf}` : ""}`
      : "unranked";
    return `${rank}${f.composite != null ? ` · score ${Math.round(f.composite)}` : ""}`;
  }
  return f.source === "default"
    ? "Default fund for this sleeve (not ranked)"
    : "Picked by search (not ranked)";
}

function fundDetail(f: FundChoice): string {
  return f.source === "ranking" && f.status
    ? `${STATUS_LABEL[f.status]} · ${rankText(f)}`
    : rankText(f);
}

function PlanRow({
  step,
  line,
  fund,
  options,
  fallback,
  overridden,
  onPick,
  onReset,
}: {
  step: number;
  line: PlanLine;
  fund: FundChoice | null;
  options: FundChoice[];
  fallback: FundChoice | null;
  overridden: boolean;
  onPick: (f: FundChoice) => void;
  onReset: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<FundChoice[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setRemote([]);
      return;
    }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchSchemes(q)
        .then(
          (rs) =>
            live &&
            setRemote(
              rs.map((r) => ({
                schemeCode: r.schemeCode,
                schemeName: r.schemeName,
                amc: r.detail,
                source: "search" as const,
              })),
            ),
        )
        .catch(() => live && setRemote([]))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const pool = useMemo(() => {
    const q = query.trim().toLowerCase();
    const local = [
      ...options,
      ...(fallback && !options.some((o) => o.schemeCode === fallback.schemeCode)
        ? [fallback]
        : []),
    ].filter((o) => !q || o.schemeName.toLowerCase().includes(q));
    const seen = new Set(local.map((o) => o.schemeCode));
    return [...local, ...remote.filter((r) => !seen.has(r.schemeCode))];
  }, [options, fallback, remote, query]);
  const byCode = useMemo(
    () => new Map(pool.map((p) => [p.schemeCode, p])),
    [pool],
  );
  const selectOptions: SearchableSelectOption[] = pool
    .slice(0, 40)
    .map((p) => ({
      id: p.schemeCode,
      label: p.schemeName,
      sublabel: fundDetail(p),
    }));

  return (
    <li className="grid grid-cols-[32px_1fr] gap-x-4 gap-y-3 px-5 py-4 md:grid-cols-[32px_minmax(0,1fr)_240px_150px] md:items-center">
      <span className="font-display text-xl tabular-nums text-muted">
        {step}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <span
            className="h-2.5 w-2.5 shrink-0"
            style={{ backgroundColor: line.color }}
            aria-hidden="true"
          />
          {line.label} · {formatPct(line.weight, 1)}
        </div>
        {fund ? (
          <>
            <p
              className="mt-1 truncate text-[15px] font-semibold text-ink"
              title={fund.schemeName}
            >
              {fund.schemeName}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              {fund.source === "ranking" && fund.status && (
                <Pill tone={STATUS_TONE[fund.status]} className="py-0.5">
                  {STATUS_LABEL[fund.status]}
                </Pill>
              )}
              <span>{rankText(fund)}</span>
              {overridden && (
                <span className="font-semibold text-ink-2">· your pick</span>
              )}
            </div>
          </>
        ) : (
          <p className="mt-1 text-[13px] text-muted">
            No fund available; pick one.
          </p>
        )}
      </div>
      <div className="col-start-2 md:col-start-auto">
        {changing ? (
          <div className="flex items-center gap-2">
            <SearchableSelect
              autoFocus
              className="min-w-0 flex-1"
              placeholder="Search alternatives…"
              value={null}
              options={selectOptions}
              loading={searching}
              onQueryChange={setQuery}
              onSelect={(o) => {
                const f = byCode.get(o.id);
                if (f) onPick(f);
                setChanging(false);
                setQuery("");
              }}
            />
            <button
              type="button"
              onClick={() => {
                setChanging(false);
                setQuery("");
              }}
              className="px-1 text-[12px] font-semibold text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setChanging(true)}
              className="rounded-sm border border-line px-3 py-1.5 text-[12px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
            >
              {options.length > 1
                ? `Switch (${options.length - 1} more)`
                : "Switch fund"}
            </button>
            {overridden && (
              <button
                type="button"
                onClick={onReset}
                className="px-1 text-[12px] font-semibold text-muted hover:text-ink"
              >
                Reset
              </button>
            )}
          </div>
        )}
      </div>
      <div className="col-start-2 text-left md:col-start-auto md:text-right">
        <p className="text-[18px] font-semibold tabular-nums text-ink">
          {formatRupees(line.amount)}
        </p>
      </div>
    </li>
  );
}
