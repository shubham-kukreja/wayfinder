import { useNavigate } from "react-router-dom";
import type { MentionCandidate } from "../../lib/mentionIndex.js";
import type { NoteEntityType } from "../../lib/notesApi.js";

const ENTITY_ROUTE: Record<NoteEntityType, (id: string) => string> = {
  datapoint: () => "/model/datapoints",
  sleeve: () => "/overview",
  signal: () => "/overview",
  rubric: () => "/model/inputs",
  snapshot: (id) => `/reviews/history?open=${encodeURIComponent(id)}`,
};

// Renders a mention as it currently resolves — live value included — never
// as the text that was true when the note was written. `candidate` is
// looked up by the editor from the current snapshot; a miss (the entity
// was renamed or removed) still renders, just without a value, rather than
// breaking the sentence around it.
export function MentionChip({
  entityType,
  entityId,
  candidate,
}: {
  entityType: NoteEntityType;
  entityId: string;
  candidate: MentionCandidate | undefined;
}) {
  const navigate = useNavigate();
  const label = candidate?.label ?? entityId;
  const color = candidate?.color ?? "#8A8A90";

  return (
    <button
      type="button"
      contentEditable={false}
      onClick={() => navigate(ENTITY_ROUTE[entityType](entityId))}
      className="mx-0.5 inline-flex select-none items-center gap-1.5 rounded-md border px-1.5 py-0.5 align-baseline text-[13px] font-semibold"
      style={{ background: `${color}1a`, borderColor: `${color}4d`, color }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {label}
      {candidate?.value && <span className="font-mono text-[12px] opacity-80">{candidate.value}</span>}
    </button>
  );
}
