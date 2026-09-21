import type { NoteWidget, NoteWidgetSize } from "../../lib/notesApi.js";
import { AllocationWidget } from "./AllocationWidget.js";
import { SignalHeatmapWidget } from "./SignalHeatmapWidget.js";
import { AllocationTableWidget } from "./AllocationTableWidget.js";
import { StateSummaryWidget } from "./StateSummaryWidget.js";

// Only three sizes are offered in the toolbar — small/medium/full — since
// "large" sat close enough to "full" in practice that the fourth option
// was just extra clicking to tell apart. The schema/store still accept
// "large" (existing notes may have it saved), it just isn't offered going
// forward; SIZE_CLASS below keeps it mapped so an old note renders the same
// as it always did.
const OFFERED_SIZES: NoteWidgetSize[] = ["small", "medium", "full"];
// max-w-full (not max-w-none) on "full" so the widget still respects the
// block's own container instead of overflowing it — the block itself is a
// block-level element with its own horizontal padding, so "full" means
// "fill this block," not "escape it."
const SIZE_CLASS: Record<NoteWidgetSize, string> = { small: "max-w-xs", medium: "max-w-lg", large: "max-w-3xl", full: "max-w-full" };

// A plain letter reads faster than any glyph could — S/M/L is a scale
// everyone already knows (clothing sizes, t-shirt sizing in UI), so it
// doesn't need a legend the way an abstract fill-bar icon would.
const SIZE_LABEL: Record<NoteWidgetSize, string> = { small: "S", medium: "M", large: "L", full: "L" };

export const WIDGET_TITLES: Record<string, string> = {
  allocation: "Allocation",
  heatmap: "Model drivers",
  table: "Allocation table",
  status: "Model status",
};

const WIDGET_RENDERERS: Record<string, (size: NoteWidgetSize) => JSX.Element> = {
  allocation: (size) => <AllocationWidget size={size} />,
  heatmap: (size) => <SignalHeatmapWidget size={size} />,
  table: () => <AllocationTableWidget />,
  status: () => <StateSummaryWidget />,
};

// A widget sits in its own block (never inline with text, unlike a mention
// chip) since it's a small dashboard, not a value — sizing it is the one
// piece of direct manipulation the editor offers beyond typing. overflow-x-
// auto on the render slot means a wide table (the heatmap at "full" in a
// narrow note column) scrolls inside its own box instead of blowing out the
// page.
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

  // Same card shell as every section on Overview and Parameters: a plain
  // `border border-line bg-paper` box (no radius, no shadow — this app
  // never uses either for a card), with a `bg-paper-2` header strip
  // separated by its own border-bottom rather than the whole card tinted.
  return (
    <div className={`group relative w-full border border-line bg-paper ${SIZE_CLASS[widget.size]}`}>
      <div className="flex items-center justify-between border-b border-line bg-paper-2 px-5 py-3">
        <span className="text-[13px] font-semibold text-ink">{WIDGET_TITLES[widget.widgetType] ?? widget.widgetType}</span>
        {/* Hover-to-reveal only works with a pointer, so these stay visible
            below `sm` (touch devices) and only hide-then-reveal at desktop
            widths where hover is a real signal. */}
        <div className="flex items-center gap-0.5 opacity-100 transition-opacity duration-100 ease-in sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {OFFERED_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onResize(s)}
              title={s}
              aria-label={`${s} size`}
              className={`flex h-6 w-7 items-center justify-center text-[11px] font-semibold transition-colors duration-100 ease-in ${
                widget.size === s ? "bg-ink text-paper" : "text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              {SIZE_LABEL[s]}
            </button>
          ))}
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove widget"
            className="ml-1 flex h-6 w-6 items-center justify-center text-muted transition-colors duration-100 ease-in hover:bg-paper hover:text-danger-500"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
      <div className="overflow-x-auto p-5">{render ? render(widget.size) : <p className="text-[12px] text-muted">Unknown widget type "{widget.widgetType}".</p>}</div>
    </div>
  );
}
