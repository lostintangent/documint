// Read-only projections from the current selection. These helpers let UI and
// command code ask semantic questions like "what block/span is active?"
// without reimplementing region and inline lookup.

import type { Mark } from "@/document";
import { regionInlines } from "../index/inlines";
import {
  compareEditorPositions,
  resolveIndexedBlock,
  resolveIndexedBlockForRegion,
  resolveParentIndexedBlock,
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

export function selectionIntersectsRegion(
  state: EditorState,
  regionId: string,
  selection: NormalizedEditorSelection = normalizeSelection(state),
) {
  const region = resolveRegion(state.documentIndex, regionId);
  if (!region) {
    return false;
  }

  if (selection.collapsed) {
    return selection.start.regionId === regionId;
  }

  return (
    compareEditorPositions(state.documentIndex, selection.start, {
      offset: region.text.length,
      regionId,
    }) <= 0 &&
    compareEditorPositions(state.documentIndex, selection.end, {
      offset: 0,
      regionId,
    }) >= 0
  );
}

export function selectionIntersectsBlock(
  state: EditorState,
  blockId: string,
  selection: NormalizedEditorSelection = normalizeSelection(state),
) {
  const target = resolveIndexedBlock(state.documentIndex, blockId);
  if (!target) {
    return false;
  }

  for (const point of [selection.start, selection.end]) {
    const focusedBlock = resolveIndexedBlockForRegion(state.documentIndex, point.regionId);
    if (focusedBlock && isIndexedBlockWithinTarget(state, focusedBlock.block.id, blockId)) {
      return true;
    }
  }

  if (selection.collapsed) {
    return false;
  }

  for (const regionId of blockAndDescendantRegionIds(state, target)) {
    if (selectionIntersectsRegion(state, regionId, selection)) {
      return true;
    }
  }

  return false;
}

function* blockAndDescendantRegionIds(state: EditorState, target: IndexedBlock) {
  for (const regionId of target.regionIds) {
    yield regionId;
  }

  for (
    let index = target.blockArrayIndex + 1;
    index < state.documentIndex.blocks.length;
    index += 1
  ) {
    const descendant = state.documentIndex.blocks[index]!;

    if (descendant.rootIndex !== target.rootIndex || descendant.depth <= target.depth) {
      break;
    }

    for (const regionId of descendant.regionIds) {
      yield regionId;
    }
  }
}

function resolveInlineAtAnchor(state: EditorState): IndexedInline | null {
  const container = resolveRegion(state.documentIndex, state.selection.anchor.regionId);

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

function isIndexedBlockWithinTarget(
  state: EditorState,
  blockId: string,
  targetBlockId: string,
) {
  let current = resolveIndexedBlock(state.documentIndex, blockId);

  while (current) {
    if (current.block.id === targetBlockId) {
      return true;
    }

    current = resolveParentIndexedBlock(state.documentIndex, current);
  }

  return false;
}
