// §12.4 cold-start state: "Show the allocation as neutral by default with
// an honest explanation that the framework isn't yet informative. Never
// render a 3-observation percentile as signal." This must be impossible
// to miss but not alarming — it's an expected, temporary state, not an
// error.
export function ColdStartBanner({ insufficientCount, totalCount }: { insufficientCount: number; totalCount: number }) {
  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
      <p className="text-sm font-medium text-blue-900">Not yet informative</p>
      <p className="mt-0.5 text-sm text-blue-800">
        {insufficientCount} of {totalCount} series have too little history for a real percentile (minimum 24 observations). The
        allocation below is neutral by policy, not a signal — it will start reflecting real market conditions once enough history
        accumulates.
      </p>
    </div>
  );
}
