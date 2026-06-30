import {
  resolveEditorPosition,
  type DocumentIndex,
  type NormalizedEditorSelection,
  type ResolvedEditorPosition,
} from "@/editor/state";

export type SelectionPathRange = {
  end: ResolvedEditorPosition;
  start: ResolvedEditorPosition;
};

export function resolveSelectionPathRange(
  documentIndex: DocumentIndex,
  normalizedSelection: NormalizedEditorSelection,
): SelectionPathRange | null {
  if (
    normalizedSelection.start.path === normalizedSelection.end.path &&
    normalizedSelection.start.offset === normalizedSelection.end.offset
  ) {
    return null;
  }

  return {
    end: resolveEditorPosition(documentIndex, normalizedSelection.end, { unknown: "before" }),
    start: resolveEditorPosition(documentIndex, normalizedSelection.start, { unknown: "before" }),
  };
}
