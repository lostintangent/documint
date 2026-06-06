import type { EditorState, NormalizedEditorSelection } from "@/editor/state";

export type SelectionRegionOrderRange = {
  end: number;
  start: number;
};

export function resolveSelectionRegionOrderRange(
  editorState: EditorState,
  normalizedSelection: NormalizedEditorSelection,
): SelectionRegionOrderRange | null {
  const regionIndex = editorState.documentIndex.regionIndex;
  const start = regionIndex.get(normalizedSelection.start.regionId)?.documentOrder;
  const end = regionIndex.get(normalizedSelection.end.regionId)?.documentOrder;

  return start === undefined || end === undefined ? null : { end, start };
}
