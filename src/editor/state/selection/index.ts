// Selection semantics for the editor state layer. This module owns core
// selection types plus normalization/range resolution, and re-exports focused
// selection target/query/formatting modules so callers can keep importing from
// `state/selection`.

import type { DocumentIndex, EditableRegion } from "../index/types";
import { compareEditorPositions, resolveRegion } from "../index/query";
import type { EditorState } from "../types";

export { resolveRegion } from "../index/query";

export type EditorSelectionPoint = {
  regionId: string;
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
  regionId: string;
  startOffset: number;
};

export type ResolvedRegionRange = {
  endOffset: number;
  region: EditableRegion;
  selection: EditorSelection;
  startOffset: number;
};

export function resolveRegionRange(
  documentIndex: DocumentIndex,
  regionId: string,
  startOffset: number,
  endOffset: number,
  options: { allowCollapsed?: boolean } = {},
): ResolvedRegionRange | null {
  const region = resolveRegion(documentIndex, regionId);

  if (!region || startOffset > endOffset) {
    return null;
  }

  const start = clampOffset(startOffset, region.text.length);
  const end = clampOffset(endOffset, region.text.length);

  if (start === end && options.allowCollapsed !== true) {
    return null;
  }

  return {
    endOffset: end,
    region,
    selection: {
      anchor: { regionId, offset: start },
      focus: { regionId, offset: end },
    },
    startOffset: start,
  };
}

export function isSelectionCollapsed(selection: EditorSelection): boolean {
  return (
    selection.anchor.regionId === selection.focus.regionId &&
    selection.anchor.offset === selection.focus.offset
  );
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

function clampOffset(offset: number, length: number) {
  return Math.max(0, Math.min(offset, length));
}

export * from "./target";
export * from "./query";
export * from "./formatting";
