import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import type { NoteEntityType, NoteWidgetSize } from "../../lib/notesApi.js";
import type { MentionCandidate } from "../../lib/mentionIndex.js";
import { NoteWidgetBlock } from "./NoteWidgetBlock.js";

// Mirrors the app's own pill language (Pill.tsx: neutral fill, ink text)
// rather than a tinted-per-entity background — this app never tints a
// surface by an arbitrary hex, so a mention chip shouldn't either. The
// entity's own color survives only as the identifying dot.
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
    render: (props) => (
      <span
        contentEditable={false}
        className="mx-0.5 inline-flex select-none items-center gap-1.5 border border-line bg-paper-2 px-2.5 py-0.5 align-baseline text-[13px] font-semibold text-ink"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: props.inlineContent.props.color }} />
        {props.inlineContent.props.label}
        {props.inlineContent.props.value && <span className="font-mono text-[12px] font-medium text-muted">{props.inlineContent.props.value}</span>}
      </span>
    ),
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
