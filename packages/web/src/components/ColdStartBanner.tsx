// §12.4 cold-start state: "Show the allocation as neutral by default with
// an honest explanation that the framework isn't yet informative. Never
// render a 3-observation percentile as signal." This must be impossible
// to miss but not alarming — it's an expected, temporary state, not an
// error.
export function ColdStartBanner({ insufficientCount, totalCount }: { insufficientCount: number; totalCount: number }) {
  return (
    <div className="mb-6 rounded-lg border border-line bg-paper-2 px-4 py-3">
      <p className="text-sm font-semibold text-ink">Not yet informative</p>
      <p className="mt-0.5 max-w-measure text-sm text-ink-2">
        {insufficientCount} of {totalCount} series have too little history for a real percentile (minimum 24 observations). The
        allocation below is neutral by policy, not a signal — it will start reflecting real market conditions once enough history
        accumulates.
      </p>
    </div>
  );
}
