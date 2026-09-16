import { Slider } from "./ui/Slider.js";
import { signalLabel } from "../lib/signalLabels.js";

// §4/§12.2: running total shown live, "normalise to 100%" as a one-click
// action rather than blocking input while the user is mid-edit.
//
// Card styling follows the dashboard: 4px corners from the theme, a bordered
// header strip on paper-2, and values set in tabular mono so digits stay in
// column as they change under the slider.
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
    <div className={`border ${friction ? "border-warn-200" : "border-line"} bg-paper`}>
      <div
        className={`flex items-center justify-between border-b px-4 py-2.5 ${
          friction ? "border-warn-200 bg-warn-50/60" : "border-line bg-paper-2"
        }`}
      >
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-[11px] tabular-nums ${isBalanced ? "text-muted" : "font-medium text-warn-600"}`}
          >
            {(sum * 100).toFixed(1)}%
          </span>
          {!isBalanced && (
            <button
              onClick={normalise}
              className="border border-warn-200 bg-paper px-2 py-0.5 text-[11px] font-medium text-warn-600 transition duration-100 ease-in hover:bg-warn-50"
            >
              Normalise
            </button>
          )}
        </div>
      </div>

      <div className="divide-y divide-line">
        {Object.entries(weights).map(([key, value]) => (
          <div key={key} className="px-4 py-3">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <label htmlFor={`w-${title}-${key}`} className="text-[13px] text-ink-2">
                {labels?.[key] ?? signalLabel(key)}
              </label>
              <span className="font-mono text-[13px] font-medium tabular-nums text-ink">
                {(value * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              id={`w-${title}-${key}`}
              value={value}
              onChange={(e) => setWeight(key, Number(e.target.value))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
