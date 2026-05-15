// Read-only projections from the current selection. These helpers let UI and
// command code ask semantic questions like "what block/span is active?"
// without reimplementing region and inline lookup.

import type { Mark } from "@/document";
import type { EditorInline } from "../index/types";
import type { EditorState } from "../types";
import { isSelectionCollapsed, normalizeSelection, type EditorSelectionRange } from "./index";

export type SelectionBlockContext = {
  blockId: string;
  depth: number;
  nodeType: string;
  text: string;
};

export type SelectionSpanContext =
  | { kind: "link"; url: string }
  | { kind: "marks"; marks: Mark[] }
  | { kind: "none" };

export type SelectionContext = {
  block: SelectionBlockContext | null;
  span: SelectionSpanContext;
};

export type CaretTextContext = {
  offset: number;
  regionId: string;
  text: string;
};

export function getCaretTextContext(state: EditorState): CaretTextContext | null {
  if (!isSelectionCollapsed(state.selection)) {
    return null;
  }

  const region = state.documentIndex.regionIndex.get(state.selection.focus.regionId);

  return region
    ? {
        offset: state.selection.focus.offset,
        regionId: region.id,
        text: region.text,
      }
    : null;
}

export function getSelectionContext(state: EditorState): SelectionContext {
  const container = state.documentIndex.regionIndex.get(state.selection.anchor.regionId) ?? null;
  const block = container ? (state.documentIndex.blockIndex.get(container.blockId) ?? null) : null;
  const inline = resolveInlineAtAnchor(state);

  return {
    block: block
      ? {
          blockId: block.id,
          depth: block.depth,
          nodeType: block.type,
          text: container?.text ?? "",
        }
      : null,
    span: inline?.link
      ? { kind: "link", url: inline.link.url }
      : inline && inline.marks.length > 0
        ? { kind: "marks", marks: inline.marks }
        : { kind: "none" },
  };
}

export function resolveImageAtSelection(state: EditorState): EditorInline | null {
  const inline = resolveInlineAtAnchor(state);
  return inline?.kind === "image" ? inline : null;
}

export function getSelectionRange(state: EditorState): EditorSelectionRange | null {
  const normalized = normalizeSelection(state.documentIndex, state.selection);

  if (
    normalized.start.regionId !== normalized.end.regionId ||
    normalized.start.offset === normalized.end.offset
  ) {
    return null;
  }

  return {
    endOffset: normalized.end.offset,
    regionId: normalized.start.regionId,
    startOffset: normalized.start.offset,
  };
}

function resolveInlineAtAnchor(state: EditorState): EditorInline | null {
  const container = state.documentIndex.regionIndex.get(state.selection.anchor.regionId) ?? null;

  if (!container) {
    return null;
  }

  const offset = state.selection.anchor.offset;

  return (
    container.inlines.find((entry) => offset > entry.start && offset < entry.end) ??
    container.inlines.find((entry) => entry.end === offset) ??
    container.inlines.find((entry) => entry.start === offset) ??
    null
  );
}
