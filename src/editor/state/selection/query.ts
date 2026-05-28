// Read-only projections from the current selection. These helpers let UI and
// command code ask semantic questions like "what block/span is active?"
// without reimplementing region and inline lookup.

import type { Mark } from "@/document";
import { regionInlines } from "../index/inlines";
import { resolveIndexedBlock, resolveRegion } from "../index/query";
import type { IndexedInline } from "../index/types";
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

  const region = resolveRegion(state.documentIndex, state.selection.focus.regionId);

  return region
    ? {
        offset: state.selection.focus.offset,
        regionId: region.id,
        text: region.text,
      }
    : null;
}

export function getSelectionContext(state: EditorState): SelectionContext {
  const container = resolveRegion(state.documentIndex, state.selection.anchor.regionId);
  const block = container ? resolveIndexedBlock(state.documentIndex, container.block.id) : null;
  const inline = resolveInlineAtAnchor(state);

  return {
    block: block
      ? {
          blockId: block.block.id,
          depth: block.depth,
          nodeType: block.block.type,
          text: container?.text ?? "",
        }
      : null,
    span: inline?.link
      ? { kind: "link", url: inline.link.url }
      : inline && inline.node.type === "text" && inline.node.marks.length > 0
        ? { kind: "marks", marks: inline.node.marks }
        : { kind: "none" },
  };
}

export function resolveImageAtSelection(state: EditorState): IndexedInline | null {
  const inline = resolveInlineAtAnchor(state);
  return inline?.node.type === "image" ? inline : null;
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

function resolveInlineAtAnchor(state: EditorState): IndexedInline | null {
  const container = resolveRegion(state.documentIndex, state.selection.anchor.regionId);

  if (!container) {
    return null;
  }

  const offset = state.selection.anchor.offset;

  return (
    regionInlines(container).find((entry) => offset > entry.start && offset < entry.end) ??
    regionInlines(container).find((entry) => entry.end === offset) ??
    regionInlines(container).find((entry) => entry.start === offset) ??
    null
  );
}
