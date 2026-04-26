/**
 * Table-specific vertical navigation. This layer overrides the default
 * line-based up/down behavior so table cells move by row and column first,
 * then fall back to the surrounding document when the caret exits the table.
 */
import {
  resolveCaretVisualLeft,
  resolveEditorHitAtPoint,
  type CaretTarget,
  type ViewportLayout,
} from "../layout";
import { resolveTableCellRegion, setSelectionPoint, type EditorState } from "../state";

// Small rightward nudge when hit-testing at a caret's visual X to avoid
// landing exactly on a cell boundary and resolving to the wrong column.
const HIT_TEST_X_NUDGE = 1;

export function moveCaretVerticallyInTable(
  state: EditorState,
  layout: ViewportLayout,
  caret: CaretTarget,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const currentContainer =
    state.documentIndex.regionIndex.get(state.selection.focus.regionId) ?? null;

  if (!currentContainer) {
    return null;
  }

  const currentCell = state.documentIndex.tableCellIndex.get(currentContainer.id) ?? null;
  const tableBlock = state.documentIndex.blockIndex.get(currentContainer.blockId) ?? null;

  if (!currentCell || tableBlock?.type !== "table") {
    return null;
  }

  const targetContainer =
    findTableRowSiblingContainer(
      state,
      tableBlock.id,
      currentCell.rowIndex + direction,
      currentCell.cellIndex,
    ) ?? findTableExitContainer(state, tableBlock.id, direction);

  if (!targetContainer) {
    return state;
  }

  const currentExtent = layout.regionBounds.get(currentContainer.id);
  const targetExtent = layout.regionBounds.get(targetContainer.id);

  if (!currentExtent || !targetExtent) {
    return state;
  }

  const targetY =
    targetExtent.top +
    clamp(
      caret.top + caret.height / 2 - currentExtent.top,
      0,
      // -1 keeps the target point strictly inside the cell, not on its bottom border.
      Math.max(0, targetExtent.bottom - targetExtent.top - 1),
    );
  const hit = resolveEditorHitAtPoint(layout, state, {
    x: resolveCaretVisualLeft(state, layout, caret) + HIT_TEST_X_NUDGE,
    y: targetY,
  });

  if (!hit) {
    return state;
  }

  return setSelectionPoint(state, hit.regionId, hit.offset, extendSelection);
}

function findTableRowSiblingContainer(
  state: EditorState,
  tableBlockId: string,
  rowIndex: number,
  cellIndex: number,
) {
  return resolveTableCellRegion(state.documentIndex, tableBlockId, rowIndex, cellIndex);
}

function findTableExitContainer(state: EditorState, tableBlockId: string, direction: -1 | 1) {
  const tableEntry = state.documentIndex.blockIndex.get(tableBlockId);
  const regions = state.documentIndex.regions;
  const range = tableEntry
    ? state.documentIndex.roots[tableEntry.rootIndex]?.regionRange
    : undefined;

  if (!range) {
    return null;
  }

  return direction < 0 ? (regions[range.start - 1] ?? null) : (regions[range.end] ?? null);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
