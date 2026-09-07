import { useState } from "react";
import type { RubricUiSpec } from "@wayfinder/engine";

// §12.2: "Rubric scores get the rubric, not a number box — the user
// picks 'RBI cutting, growth in line, CPI easing' and gets 75."
export function RubricPicker({
  spec,
  scoreId,
  currentValue,
  onEvaluate,
}: {
  spec: RubricUiSpec;
  scoreId: string;
  currentValue: number;
  onEvaluate: (values: Record<string, number>) => void;
}) {
  const [selection, setSelection] = useState<Record<string, string>>({});

  const result = spec.evaluate(selection);
  const isComplete = result !== null;
  const previewValue = result?.[scoreId] ?? currentValue;

  function setField(key: string, value: string) {
    const next = { ...selection, [key]: value };
    setSelection(next);
    const evaluated = spec.evaluate(next);
    if (evaluated) onEvaluate(evaluated);
  }

  return (
    <div className="space-y-2 rounded-md bg-neutral-50 p-3">
      {spec.fields.map((field) => (
        <div key={field.key} className="grid grid-cols-[160px_1fr] items-center gap-2">
          <span className="text-xs text-neutral-500">{field.label}</span>
          <select
            value={selection[field.key] ?? ""}
            onChange={(e) => setField(field.key, e.target.value)}
            className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-800"
          >
            <option value="" disabled>
              Select…
            </option>
            {field.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-neutral-200 pt-2 text-xs">
        <span className="text-neutral-500">{isComplete ? "Resulting score" : "Pick every condition to compute a score"}</span>
        <span className={`font-medium tabular-nums ${isComplete ? "text-neutral-900" : "text-neutral-400"}`}>{previewValue.toFixed(1)}</span>
      </div>
    </div>
  );
}
