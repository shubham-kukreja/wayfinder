import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { useNavigate } from "react-router-dom";
import type { NoteEntityType, NoteWidgetSize } from "../../lib/notesApi.js";
import type { MentionCandidate } from "../../lib/mentionIndex.js";
import { NoteWidgetBlock } from "./NoteWidgetBlock.js";

// Same entity → route mapping ReferenceRail uses for its own "referenced"
// list — a mention chip is the same link, just inline in the text instead
// of in the side rail.
const ENTITY_ROUTE: Record<NoteEntityType, (id: string) => string> = {
  datapoint: () => "/model/datapoints",
  sleeve: () => "/overview",
  signal: () => "/overview",
  rubric: () => "/model/inputs",
  snapshot: (id) => `/reviews/history?open=${encodeURIComponent(id)}`,
};

// Mirrors the app's own pill language (Pill.tsx: neutral fill, ink text)
// rather than a tinted-per-entity background — this app never tints a
// surface by an arbitrary hex, so a mention chip shouldn't either. The
// entity's own color survives only as the identifying dot.
//
// The chip is given a fixed height (20px, matching this editor's own text
// line-height at font-size 16px/line-height 1.7) instead of letting
// padding determine its height — padding-derived height was always a
// couple pixels taller than the surrounding text's line box, and that
// extra height was added below the text rather than split evenly above
// and below, so the chip visibly drooped relative to plain text on the
// same line no matter what vertical-align was set to. A fixed height that
// matches the line box exactly removes the mismatch instead of trying to
// center around it.
export const mentionInlineSpec = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      entityType: { default: "datapoint" },
      entityId: { default: "" },
      label: { default: "" },
      value: { default: "" },
      color: { default: "#8A8A90" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const navigate = useNavigate();
      const { entityType, entityId, label, value, color } = props.inlineContent.props;
      return (
        <span
          contentEditable={false}
          role="button"
          tabIndex={0}
          onClick={() => navigate(ENTITY_ROUTE[entityType as NoteEntityType](entityId))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") navigate(ENTITY_ROUTE[entityType as NoteEntityType](entityId));
          }}
          className="relative mx-0.5 inline-flex h-5 cursor-pointer select-none items-center gap-1.5 rounded-sm bg-paper-2 px-2 align-middle text-[13px] font-semibold leading-none text-ink transition-colors duration-100 ease-in hover:bg-line"
          style={{ top: "-1.2px" }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          {label}
          {value && <span className="font-mono text-[12px] font-medium text-muted">{value}</span>}
        </span>
      );
    },
  },
);

export function mentionInlineContent(candidate: MentionCandidate) {
  return {
    type: "mention" as const,
    props: {
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      label: candidate.label,
      value: candidate.value ?? "",
      color: candidate.color,
    },
  };
}

export interface MentionInlineProps {
  entityType: NoteEntityType;
  entityId: string;
  label: string;
  value: string;
  color: string;
}

// A widget block is a first-class block in the document — it drags and
// reorders with every other block for free (BlockNote's own drag handle),
// which is the whole reason for this rewrite: the old editor treated a
// widget as a {{token}} spliced into a text string, so "move it" meant
// hand-written DOM surgery. Sizing stays a per-block prop, same as before.
export const widgetBlockSpec = createReactBlockSpec(
  {
    type: "widget",
    propSchema: {
      widgetType: { default: "allocation" },
      size: { default: "medium" },
      widgetId: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => (
      <NoteWidgetBlock
        widget={{
          id: props.block.props.widgetId,
          widgetType: props.block.props.widgetType,
          size: props.block.props.size as NoteWidgetSize,
          position: 0,
        }}
        onResize={(size) => props.editor.updateBlock(props.block, { props: { ...props.block.props, size } })}
        onRemove={() => props.editor.removeBlocks([props.block])}
      />
    ),
  },
);

export const noteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    widget: widgetBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: mentionInlineSpec,
  },
});

export type NoteBlock = (typeof noteSchema)["Block"];
