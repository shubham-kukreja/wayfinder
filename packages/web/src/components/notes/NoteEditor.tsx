import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "@wayfinder/engine";
import { MentionMenu } from "./MentionMenu.js";
import { MentionChip } from "./MentionChip.js";
import { buildSnapshotCandidates, fetchSnapshotVersionCandidates, filterCandidates, type MentionCandidate } from "../../lib/mentionIndex.js";
import { mentionToken, parseBody } from "../../lib/mentionTokens.js";

// contentEditable is driven from React on every keystroke elsewhere in this
// app's stack (there's no rich-text surface yet to follow), so this editor
// treats the DOM as the source of truth while typing and only syncs back
// into React's `body` string on blur / before save / when a mention is
// inserted — re-rendering on every keystroke would fight the browser for
// caret position the same way a controlled <input> would if you replaced
// its value on every change.
export function NoteEditor({
  body,
  onChange,
  snapshot,
  placeholder,
  autoFocus,
}: {
  body: string;
  onChange: (body: string) => void;
  snapshot: Snapshot | null;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ query: string; range: Range; top: number; left: number } | null>(null);
  const [versionCandidates, setVersionCandidates] = useState<MentionCandidate[]>([]);
  // Starts out-of-sync with the incoming `body` (rather than initialized to
  // it) so the sync effect below always does its first DOM render on mount —
  // a contentEditable div starts genuinely empty regardless of what `body`
  // already holds when this component appears.
  const lastSyncedBody = useRef<string | null>(null);

  const localCandidates = useMemo(() => (snapshot ? buildSnapshotCandidates(snapshot) : []), [snapshot]);
  const candidates = useMemo(() => [...localCandidates, ...versionCandidates], [localCandidates, versionCandidates]);
  const candidateById = useMemo(() => {
    const map = new Map<string, MentionCandidate>();
    for (const c of candidates) map.set(`${c.entityType}:${c.entityId}`, c);
    return map;
  }, [candidates]);

  useEffect(() => {
    fetchSnapshotVersionCandidates().then(setVersionCandidates).catch(() => {});
  }, []);

  // Renders `body` into DOM nodes once (mount) and whenever it changes from
  // *outside* this component (loading a different note) — never on every
  // keystroke, which is tracked via lastSyncedBody instead.
  useEffect(() => {
    if (!editorRef.current || body === lastSyncedBody.current) return;
    editorRef.current.innerHTML = "";
    renderSegments(editorRef.current, body, candidateById);
    lastSyncedBody.current = body;
  }, [body, candidateById]);

  // Candidates arrive after mount (the snapshot fetch, the versions fetch),
  // often after the body has already rendered its chips without a resolved
  // value. This repaints existing chips in place — swapping label/value/color
  // — without touching surrounding text nodes or the caret, so a chip picks
  // up its live value as soon as data shows up instead of only on next edit.
  useEffect(() => {
    if (!editorRef.current || candidateById.size === 0) return;
    const chips = editorRef.current.querySelectorAll<HTMLElement>("[data-mention-type][data-mention-id]");
    chips.forEach((node) => {
      const key = `${node.dataset.mentionType}:${node.dataset.mentionId}`;
      const candidate = candidateById.get(key);
      if (candidate) node.replaceWith(buildChipNode(candidate));
    });
  }, [candidateById]);

  useEffect(() => {
    if (autoFocus) editorRef.current?.focus();
  }, [autoFocus]);

  const syncBody = useCallback(() => {
    if (!editorRef.current) return;
    const next = serializeEditor(editorRef.current);
    lastSyncedBody.current = next;
    onChange(next);
  }, [onChange]);

  function closeMenu() {
    setMenu(null);
  }

  function handleInput() {
    detectSlashTrigger();
    syncBody();
  }

  function detectSlashTrigger() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return closeMenu();
    const range = selection.getRangeAt(0);
    if (!editorRef.current.contains(range.startContainer)) return closeMenu();

    const node = range.startContainer;
    const text = node.textContent?.slice(0, range.startOffset) ?? "";
    // Sleeve/version labels are multi-word ("Small Cap", "Q2 2026 review"),
    // so the query can contain single spaces — but two in a row means the
    // sentence moved on, and a "/" preceded by a letter (a URL, "and/or")
    // is never the start of a mention.
    const match = /(?:^|\s)\/([\w.:-]+(?: [\w.:-]+)*)?$/.exec(text);
    if (!match) return closeMenu();

    const rect = range.getBoundingClientRect();
    const editorRect = editorRef.current.getBoundingClientRect();
    // Anchors to the caret, but positioned relative to the editor container
    // (not the viewport) so the menu stays put if the page scrolls under it.
    setMenu({
      query: match[1] ?? "",
      range: range.cloneRange(),
      top: rect.bottom - editorRect.top + 4,
      left: Math.min(rect.left - editorRect.left, editorRect.width - 340),
    });
  }

  function handlePick(candidate: MentionCandidate) {
    if (!menu || !editorRef.current) return;
    const { range } = menu;
    const node = range.startContainer;
    const text = node.textContent ?? "";
    const beforeSlash = text.slice(0, range.startOffset).replace(/\/[\w.:-]+(?: [\w.:-]+)*$/, "");
    const afterCaret = text.slice(range.startOffset);

    const chip = buildChipNode(candidate);
    const trailingSpace = document.createTextNode(" ");

    if (node.nodeType === Node.TEXT_NODE && node.parentNode) {
      const beforeNode = document.createTextNode(beforeSlash);
      const afterNode = document.createTextNode(afterCaret);
      node.parentNode.replaceChild(afterNode, node);
      afterNode.parentNode!.insertBefore(trailingSpace, afterNode);
      afterNode.parentNode!.insertBefore(chip, trailingSpace);
      afterNode.parentNode!.insertBefore(beforeNode, chip);

      const newRange = document.createRange();
      newRange.setStart(trailingSpace, 1);
      newRange.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(newRange);
    }

    closeMenu();
    editorRef.current.focus();
    syncBody();
  }

  const filtered = menu ? filterCandidates(candidates, menu.query) : [];

  return (
    <div className="relative">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={syncBody}
        onKeyDown={(e) => {
          if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab" || e.key === "Escape")) {
            e.preventDefault();
          }
        }}
        data-placeholder={placeholder}
        className="note-editor min-h-[60vh] w-full text-[16px] leading-[1.7] text-ink outline-none [&:empty]:before:text-muted [&:empty]:before:content-[attr(data-placeholder)]"
      />
      {menu && <MentionMenu query={menu.query} candidates={filtered} style={{ top: menu.top, left: menu.left }} onPick={handlePick} onClose={closeMenu} />}
    </div>
  );
}

function buildChipNode(candidate: MentionCandidate): HTMLElement {
  const span = document.createElement("span");
  span.setAttribute("data-mention-type", candidate.entityType);
  span.setAttribute("data-mention-id", candidate.entityId);
  span.contentEditable = "false";
  span.className = "mx-0.5 inline-flex select-none items-center gap-1.5 rounded-md border px-1.5 py-0.5 align-baseline text-[13px] font-semibold";
  span.style.background = `${candidate.color}1a`;
  span.style.borderColor = `${candidate.color}4d`;
  span.style.color = candidate.color;

  const dot = document.createElement("span");
  dot.className = "h-1.5 w-1.5 shrink-0 rounded-full";
  dot.style.background = candidate.color;
  span.appendChild(dot);
  span.appendChild(document.createTextNode(candidate.label));
  if (candidate.value) {
    const val = document.createElement("span");
    val.className = "font-mono text-[12px] opacity-80";
    val.textContent = candidate.value;
    span.appendChild(document.createTextNode(" "));
    span.appendChild(val);
  }
  return span;
}

function renderSegments(container: HTMLElement, body: string, candidateById: Map<string, MentionCandidate>): void {
  const segments = parseBody(body);
  for (const seg of segments) {
    if (seg.type === "text") {
      container.appendChild(document.createTextNode(seg.text ?? ""));
    } else if (seg.entityType && seg.entityId) {
      const candidate = candidateById.get(`${seg.entityType}:${seg.entityId}`);
      container.appendChild(buildChipNode(candidate ?? { entityType: seg.entityType, entityId: seg.entityId, label: seg.entityId, meta: "", value: null, color: "#8A8A90" }));
    }
  }
}

// Walks the live DOM back into the {{type:id}} token string — the inverse
// of renderSegments — so what gets saved and searched is always plain text.
function serializeEditor(container: HTMLElement): string {
  let out = "";
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node instanceof HTMLElement && node.dataset.mentionType && node.dataset.mentionId) {
      out += mentionToken(node.dataset.mentionType as never, node.dataset.mentionId);
    } else if (node instanceof HTMLElement && node.tagName === "BR") {
      out += "\n";
    } else if (node instanceof HTMLElement) {
      out += node.textContent ?? "";
    }
  }
  return out;
}

export { MentionChip };
