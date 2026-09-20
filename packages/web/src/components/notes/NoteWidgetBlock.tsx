import type { NoteWidget, NoteWidgetSize } from "../../lib/notesApi.js";
import { AllocationWidget } from "./AllocationWidget.js";

const SIZE_LABEL: Record<NoteWidgetSize, string> = { small: "Small", medium: "Medium", full: "Full width" };
const SIZE_CLASS: Record<NoteWidgetSize, string> = { small: "max-w-xs", medium: "max-w-lg", full: "max-w-none" };

const WIDGET_RENDERERS: Record<string, (size: NoteWidgetSize) => JSX.Element> = {
  allocation: (size) => <AllocationWidget size={size} />,
};

// A widget sits in its own block (never inline with text, unlike a mention
// chip) since it's a small dashboard, not a value — sizing it is the one
// piece of direct manipulation the editor offers beyond typing.
export function NoteWidgetBlock({
  widget,
  onResize,
  onRemove,
}: {
  widget: NoteWidget;
  onResize: (size: NoteWidgetSize) => void;
  onRemove: () => void;
}) {
  const render = WIDGET_RENDERERS[widget.widgetType];

  return (
    <div className={`group relative my-4 rounded-lg border border-line bg-paper-2 p-4 ${SIZE_CLASS[widget.size]}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Allocation</span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity duration-100 ease-in group-hover:opacity-100">
          {(["small", "medium", "full"] as NoteWidgetSize[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onResize(s)}
              className={`rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${
                widget.size === s ? "bg-ink text-paper" : "text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              {SIZE_LABEL[s]}
            </button>
          ))}
          <button type="button" onClick={onRemove} aria-label="Remove widget" className="ml-1 rounded-sm px-1.5 py-0.5 text-muted hover:bg-paper hover:text-danger-500">
            ✕
          </button>
        </div>
      </div>
      {render ? render(widget.size) : <p className="text-[12px] text-muted">Unknown widget type "{widget.widgetType}".</p>}
    </div>
  );
}
