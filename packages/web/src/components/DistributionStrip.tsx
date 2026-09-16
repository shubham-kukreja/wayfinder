// §12.2 History surface: "a distribution strip with a marker communicates
// '82nd percentile' far better than the number." Uses the same square,
// green-filled visual language as the dashboard sliders, but remains read-only.
export function DistributionStrip({ percentile }: { percentile: number | null }) {
  if (percentile === null) {
    return <div className="h-2 w-full border border-line bg-paper-2" title="Insufficient history" />;
  }
  const clamped = Math.min(100, Math.max(0, percentile));
  return (
    <div className="relative h-2 w-full border border-line bg-paper-2" title={`${percentile.toFixed(0)}th percentile`}>
      <div className="absolute inset-y-0 left-0 bg-brand-100" style={{ width: `${clamped}%` }} />
      <div className="absolute top-1/2 h-3 w-1 -translate-y-1/2 bg-brand-500" style={{ left: `calc(${clamped}% - 2px)` }} />
    </div>
  );
}
