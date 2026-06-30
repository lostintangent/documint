// Selection semantics for the editor state layer. This module owns core
// selection types plus normalization/range resolution, and re-exports focused
// selection target/query/formatting modules so callers can keep importing from
// `state/selection`.

import type { DocumentIndex } from "../index/types";
import { compareEditorPositions } from "../index/query";
import type { EditorState } from "../types";

export type EditorSelectionPoint = {
  path: string;
  offset: number;
};

export type EditorSelection = {
  anchor: EditorSelectionPoint;
  focus: EditorSelectionPoint;
};

export type NormalizedEditorSelection = {
  collapsed: boolean;
  end: EditorSelectionPoint;
  start: EditorSelectionPoint;
};

export type EditorSelectionRange = {
  endOffset: number;
  path: string;
  startOffset: number;
};

export function isSelectionCollapsed(selection: EditorSelection): boolean {
  return areSelectionPointsEqual(selection.anchor, selection.focus);
}

export function areSelectionPointsEqual(
  left: EditorSelectionPoint,
  right: EditorSelectionPoint,
) {
  return left.path === right.path && left.offset === right.offset;
}

export function normalizeSelection(state: EditorState): NormalizedEditorSelection;
export function normalizeSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): NormalizedEditorSelection;
export function normalizeSelection(
  stateOrIndex: EditorState | DocumentIndex,
  selection?: EditorSelection,
): NormalizedEditorSelection {
  const documentIndex = "documentIndex" in stateOrIndex ? stateOrIndex.documentIndex : stateOrIndex;
  const sel = "documentIndex" in stateOrIndex ? stateOrIndex.selection : selection!;
  const collapsed = isSelectionCollapsed(sel);
  const orientation = compareEditorPositions(documentIndex, sel.anchor, sel.focus);

  if (orientation <= 0) {
    return {
      collapsed,
      end: sel.focus,
      start: sel.anchor,
    };
  }

  return {
    collapsed,
    end: sel.anchor,
    start: sel.focus,
  };
}

export * from "./target";
export * from "./query";
export * from "./formatting";
