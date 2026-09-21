import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Pill } from "../../components/ui/Pill.js";
import { formatDuration, formatRupeesCompact, formatXirr } from "../../lib/backtestFormat.js";
import { cancelBacktestJob, listBacktestJobs, type BacktestJobSummary } from "../../lib/backtestApi.js";

// Polls only while something is actually in flight (queued or running) —
// once every job is in a terminal state, the interval stops rather than
// hitting the server every few seconds forever on a page someone left open.
const POLL_INTERVAL_MS = 3000;

function elapsedSeconds(job: BacktestJobSummary): number {
  if (!job.startedAt) return 0;
  return (Date.now() - new Date(job.startedAt).getTime()) / 1000;
}

function StatusPill({ status }: { status: BacktestJobSummary["status"] }) {
  if (status === "running") return <Pill tone="dark" dot>Running</Pill>;
  if (status === "queued") return <Pill tone="neutral">Queued</Pill>;
  if (status === "completed") return <Pill tone="green">Completed</Pill>;
  if (status === "failed") return <Pill tone="danger">Failed</Pill>;
  return <Pill tone="neutral">Cancelled</Pill>;
}

function JobRow({ job, queuePosition, onCancel }: { job: BacktestJobSummary; queuePosition?: number; onCancel?: (id: string) => void }) {
  const navigate = useNavigate();
  const clickable = job.status === "completed";
  const summary = job.summary;

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => navigate(`/backtest/runs/${job.id}`) : undefined}
      onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && navigate(`/backtest/runs/${job.id}`) : undefined}
      className={`flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 ${clickable ? "cursor-pointer transition-colors duration-100 ease-in hover:bg-paper-2" : ""}`}
    >
      {/* Name first, then status, per the requested order. */}
      <div className="min-w-0 flex-1 basis-64">
        <div className="truncate text-[13px] font-semibold text-ink">{job.label}</div>
        <div className="mt-0.5 truncate text-xs text-muted">
          {job.benchmarkId} · {job.legs.length} fund{job.legs.length === 1 ? "" : "s"}
          {" · "}
          {new Date(job.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </div>
      </div>

      <div className="shrink-0">
        <StatusPill status={job.status} />
      </div>

      {/* Completed: invested/current/return sit right in the row so the
          history reads as a scannable table, not just a label + a button. */}
      {job.status === "completed" && summary && (
        <div className="flex shrink-0 items-center gap-5 text-xs">
          <span className="flex flex-col items-end">
            <span className="text-muted">Invested</span>
            <span className="font-mono font-medium tabular-nums text-ink">{formatRupeesCompact(summary.totalInvested)}</span>
          </span>
          <span className="flex flex-col items-end">
            <span className="text-muted">Current</span>
            <span className="font-mono font-medium tabular-nums text-ink">{formatRupeesCompact(summary.portfolioCurrentValue)}</span>
          </span>
          <span className="flex flex-col items-end">
            <span className="text-muted">XIRR</span>
            <span
              className={`font-mono font-semibold tabular-nums ${
                summary.portfolioXirr !== null && summary.portfolioXirr >= 0 ? "text-brand-800" : "text-danger-500"
              }`}
            >
              {formatXirr(summary.portfolioXirr)}
            </span>
          </span>
          <span className="flex flex-col items-end">
            <span className="text-muted">vs benchmark</span>
            <span
              className={`font-mono font-semibold tabular-nums ${
                summary.portfolioXirr !== null && summary.benchmarkXirr !== null && summary.portfolioXirr >= summary.benchmarkXirr
                  ? "text-brand-800"
                  : "text-danger-500"
              }`}
            >
              {summary.portfolioXirr !== null && summary.benchmarkXirr !== null
                ? formatXirr(summary.portfolioXirr - summary.benchmarkXirr)
                : "—"}
            </span>
          </span>
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {job.status === "running" && (
          <span className="text-xs tabular-nums text-muted">
            {formatDuration(elapsedSeconds(job))}
            {job.etaSeconds ? ` / ~${formatDuration(job.etaSeconds)}` : ""}
          </span>
        )}
        {job.status === "queued" && job.etaSeconds !== null && <span className="text-xs tabular-nums text-muted">~{formatDuration(job.etaSeconds)}</span>}
        {job.status === "queued" && queuePosition !== undefined && <span className="text-xs text-muted">position {queuePosition}</span>}
        {job.status === "queued" && onCancel && (
          <button
            type="button"
            onClick={() => onCancel(job.id)}
            className="border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-2 transition duration-100 ease-in hover:bg-paper-2 hover:text-danger-500"
          >
            Cancel
          </button>
        )}
        {job.status === "completed" && (
          <Link
            to={`/backtest/runs/${job.id}`}
            className="border border-ink px-2.5 py-1 text-[11px] font-semibold text-ink transition duration-100 ease-in hover:bg-paper-2"
          >
            View report
          </Link>
        )}
        {job.status === "failed" && <span className="max-w-xs truncate text-xs text-danger-500" title={job.error ?? undefined}>{job.error ?? "Failed"}</span>}
      </div>
    </div>
  );
}

export function BacktestRunsView() {
  const [jobs, setJobs] = useState<BacktestJobSummary[] | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    try {
      const list = await listBacktestJobs();
      setJobs(list);
    } catch {
      // A transient poll failure isn't worth surfacing as an error banner —
      // the next tick tries again; only an empty initial load stays null.
    }
  }

  useEffect(() => {
    refresh();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    const active = jobs?.some((j) => j.status === "queued" || j.status === "running") ?? false;
    if (active && !pollRef.current) {
      pollRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    } else if (!active && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [jobs]);

  async function handleCancel(id: string) {
    await cancelBacktestJob(id);
    refresh();
  }

  if (jobs === null) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }

  const running = jobs.filter((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const finished = jobs.filter((j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled");

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="mb-1 font-display text-xl text-ink">Run History</h1>
          <p className="text-sm text-muted">Backtests run one at a time, up to 3 queued or running at once.</p>
        </div>
        <Link
          to="/backtest/new"
          className="inline-flex items-center rounded-md bg-ink px-[22px] py-[11px] text-sm font-semibold text-paper transition duration-100 ease-in hover:-translate-y-px hover:brightness-[1.06] active:translate-y-0 active:brightness-[0.96]"
        >
          New Run
        </Link>
      </div>

      {running.length === 0 && queued.length === 0 && finished.length === 0 && (
        <div className="border border-line bg-paper px-5 py-10 text-center text-sm text-muted">No backtests yet.</div>
      )}

      {(running.length > 0 || queued.length > 0) && (
        <section className="mb-10 border border-line bg-paper">
          <div className="border-b border-line bg-paper-2 px-5 py-3">
            <h2 className="text-[13px] font-semibold text-ink">In progress</h2>
          </div>
          <div className="divide-y divide-line">
            {running.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
            {queued.map((job, i) => (
              <JobRow key={job.id} job={job} queuePosition={i + 1} onCancel={handleCancel} />
            ))}
          </div>
        </section>
      )}

      {finished.length > 0 && (
        <section className="border border-line bg-paper">
          <div className="border-b border-line bg-paper-2 px-5 py-3">
            <h2 className="text-[13px] font-semibold text-ink">History</h2>
          </div>
          <div className="divide-y divide-line">
            {finished.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
