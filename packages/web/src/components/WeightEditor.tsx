// §4/§12.2: running total shown live, "normalise to 100%" as a one-click
// action rather than blocking input while the user is mid-edit.
export function WeightEditor({
  title,
  weights,
  labels,
  onChange,
  friction = false,
}: {
  title: string;
  weights: Record<string, number>;
  labels?: Record<string, string>;
  onChange: (next: Record<string, number>) => void;
  friction?: boolean;
}) {
  const sum = Object.values(weights).reduce((s, v) => s + v, 0);
  const isBalanced = Math.abs(sum - 1) < 0.001;

  function setWeight(key: string, value: number) {
    onChange({ ...weights, [key]: value });
  }

  function normalise() {
    if (sum === 0) return;
    const next = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / sum]));
    onChange(next);
  }

  return (
    <div className={`rounded-lg border p-4 ${friction ? "border-amber-300 bg-amber-50/40" : "border-neutral-200 bg-white"}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        <span className={`text-xs tabular-nums ${isBalanced ? "text-neutral-400" : "text-amber-600 font-medium"}`}>
          sum {(sum * 100).toFixed(1)}%
          {!isBalanced && (
            <button onClick={normalise} className="ml-2 rounded border border-amber-400 px-1.5 py-0.5 text-amber-700 hover:bg-amber-100">
              Normalise
            </button>
          )}
        </span>
      </div>
      <div className="space-y-2">
        {Object.entries(weights).map(([key, value]) => (
          <div key={key} className="grid grid-cols-[100px_1fr_50px] items-center gap-3 text-sm">
            <span className="truncate text-neutral-600">{labels?.[key] ?? key}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={value}
              onChange={(e) => setWeight(key, Number(e.target.value))}
              className="w-full"
            />
            <span className="text-right tabular-nums text-neutral-800">{(value * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
