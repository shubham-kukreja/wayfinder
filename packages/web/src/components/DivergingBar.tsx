// §12.2: diverging bars centred on 50 — the pivot (neutral score) is
// structural to the framework, not a decoration, so it's the fixed
// midpoint every bar grows from in either direction.
export function DivergingBar({ value, max = 50 }: { value: number; max?: number }) {
  const deviation = value - 50;
  const pct = Math.min(100, (Math.abs(deviation) / max) * 100);
  const isPositive = deviation >= 0;

  return (
    <div className="relative h-5 w-full">
      <div className="absolute left-1/2 top-0 h-full w-px bg-neutral-300" />
      <div className="flex h-full w-full">
        <div className="flex w-1/2 justify-end">
          {!isPositive && (
            <div
              className="h-full rounded-l-sm bg-rose-400"
              style={{ width: `${pct}%` }}
              title={`${value.toFixed(1)}`}
            />
          )}
        </div>
        <div className="flex w-1/2 justify-start">
          {isPositive && (
            <div
              className="h-full rounded-r-sm bg-emerald-500"
              style={{ width: `${pct}%` }}
              title={`${value.toFixed(1)}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
