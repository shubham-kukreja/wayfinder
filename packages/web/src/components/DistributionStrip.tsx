// §12.2 History surface: "a distribution strip with a marker communicates
// '82nd percentile' far better than the number." Renders a flat gradient
// bar with a marker at the series' current percentile position.
export function DistributionStrip({ percentile }: { percentile: number | null }) {
  if (percentile === null) {
    return <div className="h-2 w-full rounded-full bg-neutral-100" title="Insufficient history" />;
  }
  return (
    <div className="relative h-2 w-full rounded-full bg-gradient-to-r from-blue-200 via-neutral-200 to-rose-200">
      <div
        className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded-full bg-neutral-900"
        style={{ left: `calc(${percentile}% - 2px)` }}
        title={`${percentile.toFixed(0)}th percentile`}
      />
    </div>
  );
}
