import { Slider } from "./ui/Slider.js";

// A single editable cap/threshold value - unlike WeightEditor, these
// are independent numbers with no "must sum to 100%" constraint (a max
// tilt cap and a sector sleeve cap have nothing to do with each other),
// so no running-total/normalise affordance applies here.
//
// Label sits above the slider rather than beside it: in a three-column grid
// the side-by-side layout truncated longer captions ("Max consecutive qua…").
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
  const id = `cap-${label.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <div className="px-4 py-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] text-ink-2">
          {label}
        </label>
        <span className="font-mono text-[13px] font-medium tabular-nums text-ink">
          {isPercent ? `${(value * 100).toFixed(0)}%` : value}
        </span>
      </div>
      <Slider id={id} value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
