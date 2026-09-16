// A single editable cap/threshold value - unlike WeightEditor, these
// are independent numbers with no "must sum to 100%" constraint (a max
// tilt cap and a sector sleeve cap have nothing to do with each other),
// so no running-total/normalise affordance applies here.
export function CapEditor({
  label,
  value,
  onChange,
  isPercent = true,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  isPercent?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_60px] items-center gap-3 text-sm">
      <span className="truncate text-ink-2">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
      <span className="text-right tabular-nums text-ink-2">{isPercent ? `${(value * 100).toFixed(0)}%` : value}</span>
    </div>
  );
}
