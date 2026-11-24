import { useEffect, useState } from "react";
import { rubricApi, rubricScore, type CoreRubric } from "../lib/draftApi.js";
import { formatScore } from "../lib/format.js";

// A rubric score's questions, from core (GET /v1/rubrics/{key}). Picking
// answers previews the score; the answers become a set_rubric draft edit,
// saved with the page's other changes.
export function CoreRubricPicker({
  scoreKey,
  answers,
  onChange,
}: {
  scoreKey: string;
  answers: Record<string, string> | undefined;
  onChange: (answers: Record<string, string> | undefined, score: number | null) => void;
}) {
  const [rubric, setRubric] = useState<CoreRubric | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rubricApi
      .get(scoreKey)
      .then(setRubric)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [scoreKey]);

  if (error) return <p className="text-xs text-danger-500">Could not load the rubric: {error}</p>;
  if (!rubric) return <p className="text-xs text-muted">Loading rubric…</p>;

  const current = rubric.current?.answers ?? {};
  const picked = answers ?? current;
  const preview = rubricScore(rubric, picked);

  function pick(condition: string, option: string) {
    const next = { ...picked, [condition]: option };
    const same = rubric!.conditions.every((c) => next[c.id] === current[c.id]);
    onChange(same ? undefined : next, rubricScore(rubric!, next));
  }

  return (
    <div className="rounded-sm border border-line bg-paper-2 p-3">
      <div className="space-y-3">
        {rubric.conditions.map((c) => (
          <div key={c.id}>
            <p className="mb-1.5 text-xs font-semibold text-ink">{c.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {c.options.map((o) => {
                const active = picked[c.id] === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => pick(c.id, o.id)}
                    className={`rounded-sm border px-2.5 py-1 text-xs transition-colors duration-100 ${
                      active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-2 hover:border-ink"
                    }`}
                  >
                    {o.id.replaceAll("_", " ")}
                    <span className={`ml-1.5 font-mono ${active ? "text-paper/80" : "text-muted"}`}>
                      {o.add > 0 ? "+" : ""}
                      {o.add}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-xs">
        <span className="text-muted">
          Base {rubric.base}
          {rubric.current && <> · last answered {rubric.current.answered_at}</>}
        </span>
        <span className="font-mono font-semibold text-ink">
          {preview === null ? "Answer every question" : `Score ${formatScore(preview)}`}
        </span>
      </div>
    </div>
  );
}
