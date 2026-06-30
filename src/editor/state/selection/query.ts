// Read-only projections from the current selection. These helpers let UI and
// command code ask semantic questions like "what block/span is active?"
// without reimplementing path and inline lookup.

import type { Mark } from "@/document";
import {
  blockContainsBlock,
  compareEditorPositions,
  resolveBlockTextPathBoundary,
  resolveIndexedBlock,
  resolveInlinesAtPath,
  resolveIndexedBlockContainingPath,
  resolveEditorTextAtPath,
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
  path: string;
  text: string;
};

export function getCaretTextContext(state: EditorState): CaretTextContext | null {
  if (!isSelectionCollapsed(state.selection)) {
    return null;
  }

  const text = resolveEditorTextAtPath(state.documentIndex, state.selection.focus.path);

  return text !== null
    ? {
        offset: state.selection.focus.offset,
        path: state.selection.focus.path,
        text,
      }
    : null;
}

export function getSelectionContext(state: EditorState): SelectionContext {
  const block = resolveIndexedBlockContainingPath(state.documentIndex, state.selection.anchor.path);
  const text = resolveEditorTextAtPath(state.documentIndex, state.selection.anchor.path) ?? "";
  const inline = resolveInlineAtAnchor(state);

  return {
    block: block
      ? {
          blockPath: block.path,
          depth: block.depth,
          nodeType: block.block.type,
          text,
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
    normalized.start.path !== normalized.end.path ||
    normalized.start.offset === normalized.end.offset
  ) {
    return null;
  }

  return {
    endOffset: normalized.end.offset,
    path: normalized.start.path,
    startOffset: normalized.start.offset,
  };
}

export function selectionIntersectsPath(
  state: EditorState,
  path: string,
  selection: NormalizedEditorSelection = normalizeSelection(state),
) {
  const text = resolveEditorTextAtPath(state.documentIndex, path);
  if (text === null) {
    return false;
  }

  if (selection.collapsed) {
    return selection.start.path === path;
  }

  return (
    compareEditorPositions(state.documentIndex, selection.start, {
      offset: text.length,
      path,
    }) <= 0 &&
    compareEditorPositions(state.documentIndex, selection.end, {
      offset: 0,
      path,
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
    const focusedBlock = resolveIndexedBlockContainingPath(state.documentIndex, point.path);
    if (focusedBlock && isIndexedBlockWithinTarget(focusedBlock, target)) {
      return true;
    }
  }

  if (selection.collapsed) {
    return false;
  }

  const firstPath = resolveBlockTextPathBoundary(state.documentIndex, blockPath, "start");
  const lastPath = resolveBlockTextPathBoundary(state.documentIndex, blockPath, "end");
  const lastText = lastPath ? resolveEditorTextAtPath(state.documentIndex, lastPath) : null;

  if (!firstPath || !lastPath || lastText === null) {
    return false;
  }

  return (
    compareEditorPositions(state.documentIndex, selection.start, {
      offset: lastText.length,
      path: lastPath,
    }) <= 0 &&
    compareEditorPositions(state.documentIndex, selection.end, {
      offset: 0,
      path: firstPath,
    }) >= 0
  );
}

function resolveInlineAtAnchor(state: EditorState): IndexedInline | null {
  const inlines = resolveInlinesAtPath(state.documentIndex, state.selection.anchor.path);
  if (!inlines) {
    return null;
  }

  const offset = state.selection.anchor.offset;

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
