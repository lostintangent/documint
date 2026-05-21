// Owns the selection highlight painted on the content canvas. The user's
// caret lives on the overlay canvas (see `painters/caret`); the selection
// highlight stays here so range selections don't repaint on blink ticks.
// Shared range-on-line geometry is in `line-range.ts` so the comment
// underline can reuse it without depending on selection.

import type { DocumentLayout } from "@/editor/layout";
import type { EditorState, NormalizedEditorSelection } from "@/editor/state";
import type { EditorTheme } from "@/types";
import { resolveLineRangeRect } from "./line-range";

const selectionMinimumWidth = 2;
const selectionVerticalInset = 1;
const selectionVerticalTrim = 2;

export type SelectionRegionOrderRange = {
  end: number;
  start: number;
};

export function resolveSelectionRegionOrderRange(
  editorState: EditorState,
  normalizedSelection: NormalizedEditorSelection,
): SelectionRegionOrderRange | null {
  const regionOrderIndex = editorState.documentIndex.regionOrderIndex;
  const start = regionOrderIndex.get(normalizedSelection.start.regionId);
  const end = regionOrderIndex.get(normalizedSelection.end.regionId);

  return start === undefined || end === undefined ? null : { end, start };
}

export function paintSelectionHighlight(
  context: CanvasRenderingContext2D,
  editorState: EditorState,
  line: DocumentLayout["lines"][number],
  normalizedSelection: NormalizedEditorSelection,
  selectionRegionOrderRange: SelectionRegionOrderRange | null,
  theme: EditorTheme,
) {
  if (!selectionRegionOrderRange) {
    return;
  }

  const lineRegionOrder = editorState.documentIndex.regionOrderIndex.get(line.regionId);

  if (
    lineRegionOrder === undefined ||
    lineRegionOrder < selectionRegionOrderRange.start ||
    lineRegionOrder > selectionRegionOrderRange.end
  ) {
    return;
  }

  const overlapStart =
    lineRegionOrder === selectionRegionOrderRange.start
      ? Math.max(line.start, normalizedSelection.start.offset)
      : line.start;
  const overlapEnd =
    lineRegionOrder === selectionRegionOrderRange.end
      ? Math.min(line.end, normalizedSelection.end.offset)
      : line.end;

  if (overlapEnd <= overlapStart) {
    return;
  }

  const { left, width } = resolveLineRangeRect(
    editorState,
    line,
    overlapStart,
    overlapEnd,
    selectionMinimumWidth,
  );

  context.fillStyle = theme.selectionBackground;
  context.fillRect(
    left,
    line.top + selectionVerticalInset,
    width,
    line.height - selectionVerticalTrim,
  );
}
