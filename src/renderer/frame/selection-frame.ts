import { resolveRegion, type EditorState, type NormalizedEditorSelection } from "@/editor/state";

export type SelectionRegionOrderRange = {
  end: number;
  start: number;
};

export function resolveSelectionRegionOrderRange(
  editorState: EditorState,
  normalizedSelection: NormalizedEditorSelection,
): SelectionRegionOrderRange | null {
  const start = resolveRegion(
    editorState.documentIndex,
    normalizedSelection.start.regionPath,
  )?.regionArrayIndex;
  const end = resolveRegion(
    editorState.documentIndex,
    normalizedSelection.end.regionPath,
  )?.regionArrayIndex;

  return start === undefined || end === undefined ? null : { end, start };
}
