// Read-only projections from the current selection. These helpers let UI and
// command code ask semantic questions like "what block/span is active?"
// without reimplementing region and inline lookup.

import type { Mark } from "@/document";
import { regionInlines } from "../index/inlines";
import {
  blockContainsBlock,
  compareEditorPositions,
  firstRegionInBlock,
  lastRegionInBlock,
  resolveIndexedBlockForRegion,
  resolveIndexedBlock,
  resolveRegion,
} from "../index/query";
import type { IndexedBlock, IndexedInline } from "../index/types";
import type { EditorState } from "../types";
import {
  isSelectionCollapsed,
  normalizeSelection,
  type EditorSelectionRange,
  type NormalizedEditorSelection,
} from "./index";

export type SelectionBlockContext = {
  blockPath: string;
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
  regionPath: string;
  text: string;
};

export function getCaretTextContext(state: EditorState): CaretTextContext | null {
  if (!isSelectionCollapsed(state.selection)) {
    return null;
  }

  const region = resolveRegion(state.documentIndex, state.selection.focus.regionPath);

  return region
    ? {
        offset: state.selection.focus.offset,
        regionPath: region.path,
        text: region.text,
      }
    : null;
}

export function getSelectionContext(state: EditorState): SelectionContext {
  const container = resolveRegion(state.documentIndex, state.selection.anchor.regionPath);
  const block = container
    ? resolveIndexedBlock(state.documentIndex, container.blockPath)
    : null;
  const inline = resolveInlineAtAnchor(state);

  return {
    block: block
      ? {
          blockPath: block.path,
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
    normalized.start.regionPath !== normalized.end.regionPath ||
    normalized.start.offset === normalized.end.offset
  ) {
    return null;
  }

  return {
    endOffset: normalized.end.offset,
    regionPath: normalized.start.regionPath,
    startOffset: normalized.start.offset,
  };
}

export function selectionIntersectsRegion(
  state: EditorState,
  regionPath: string,
  selection: NormalizedEditorSelection = normalizeSelection(state),
) {
  const region = resolveRegion(state.documentIndex, regionPath);
  if (!region) {
    return false;
  }

  if (selection.collapsed) {
    return selection.start.regionPath === regionPath;
  }

  return (
    compareEditorPositions(state.documentIndex, selection.start, {
      offset: region.text.length,
      regionPath,
    }) <= 0 &&
    compareEditorPositions(state.documentIndex, selection.end, {
      offset: 0,
      regionPath,
    }) >= 0
  );
}

export function selectionIntersectsBlockPath(
  state: EditorState,
  blockPath: string,
  selection: NormalizedEditorSelection = normalizeSelection(state),
) {
  const target = resolveIndexedBlock(state.documentIndex, blockPath);
  if (!target) {
    return false;
  }

  for (const point of [selection.start, selection.end]) {
    const focusedBlock = resolveIndexedBlockForRegion(state.documentIndex, point.regionPath);
    if (focusedBlock && isIndexedBlockWithinTarget(focusedBlock, target)) {
      return true;
    }
  }

  if (selection.collapsed) {
    return false;
  }

  const firstRegion = firstRegionInBlock(state.documentIndex, target);
  const lastRegion = lastRegionInBlock(state.documentIndex, target);

  if (!firstRegion || !lastRegion) {
    return false;
  }

  return (
    compareEditorPositions(state.documentIndex, selection.start, {
      offset: lastRegion.text.length,
      regionPath: lastRegion.path,
    }) <= 0 &&
    compareEditorPositions(state.documentIndex, selection.end, {
      offset: 0,
      regionPath: firstRegion.path,
    }) >= 0
  );
}

function resolveInlineAtAnchor(state: EditorState): IndexedInline | null {
  const container = resolveRegion(state.documentIndex, state.selection.anchor.regionPath);

  if (!container) {
    return null;
  }

  const offset = state.selection.anchor.offset;
  const inlines = regionInlines(container);

  return (
    inlines.find((entry) => offset > entry.start && offset < entry.end) ??
    inlines.find((entry) => entry.end === offset) ??
    inlines.find((entry) => entry.start === offset) ??
    null
  );
}

function isIndexedBlockWithinTarget(block: IndexedBlock, target: IndexedBlock) {
  return blockContainsBlock(target, block);
}
