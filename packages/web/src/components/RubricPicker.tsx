import { useState } from "react";
import type { RubricUiSpec } from "@wayfinder/engine";

// §12.2: "Rubric scores get the rubric, not a number box — the user
// picks 'RBI cutting, growth in line, CPI easing' and gets 75."
export function RubricPicker({
  spec,
  scoreId,
  currentValue,
  onEvaluate,
  onSave,
}: {
  spec: RubricUiSpec;
  scoreId: string;
  currentValue: number;
  onEvaluate: (values: Record<string, number>) => void;
  onSave: (values: Record<string, number>) => Promise<void>;
}) {
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const result = spec.evaluate(selection);
  const isComplete = result !== null;
  const previewValue = result?.[scoreId] ?? currentValue;

  function setField(key: string, value: string) {
    const next = { ...selection, [key]: value };
    setSelection(next);
    setSaved(false);
    const evaluated = spec.evaluate(next);
    if (evaluated) onEvaluate(evaluated);
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(result);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md bg-paper-2 p-3">
      {spec.fields.map((field) => (
        <div key={field.key} className="grid grid-cols-[160px_1fr] items-center gap-2">
          <span className="text-xs text-muted">{field.label}</span>
          <select
            value={selection[field.key] ?? ""}
            onChange={(e) => setField(field.key, e.target.value)}
            className="rounded-md border border-line px-2 py-1 text-xs text-ink-2"
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
      <div className="flex items-center justify-between border-t border-line pt-2 text-xs">
        <span className="text-muted">{isComplete ? "Resulting score" : "Pick every condition to compute a score"}</span>
        <div className="flex items-center gap-2">
          <span className={`font-medium tabular-nums ${isComplete ? "text-ink" : "text-muted"}`}>{previewValue.toFixed(1)}</span>
          <button
            onClick={handleSave}
            disabled={!isComplete || saving}
            className="rounded-md bg-brand-500 px-2 py-1 text-xs font-medium text-white transition duration-100 ease-in hover:brightness-105 hover:-translate-y-px disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {saveError && <p className="text-xs text-danger-500">Save failed: {saveError}</p>}
      {saved && !saveError && <p className="text-xs text-brand-800">Saved to server.</p>}
    </div>
  );
}
