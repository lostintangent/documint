/**
 * Table-specific vertical navigation. This layer overrides the default
 * line-based up/down behavior so table cells move by row and column first,
 * then fall back to the surrounding document when the caret exits the table.
 */
import { type CaretTarget, type DocumentLayout } from "../layout";
import type { EditorState } from "../state";
import {
  resolveBlockEntry,
  resolveRegion,
  resolveRegionOutsideRoot,
  resolveTableCellPosition,
  resolveTableCellRegion,
} from "../state/index/query";
import { placeCaretAtLineY } from "./line";

export function moveCaretVerticallyInTable(
  state: EditorState,
  layout: DocumentLayout,
  caret: CaretTarget,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const currentContainer = resolveRegion(state.documentIndex, state.selection.focus.regionId);

  if (!currentContainer) {
    return null;
  }

  const currentCell = resolveTableCellPosition(currentContainer);
  const tableBlock = resolveBlockEntry(state.documentIndex, currentContainer.block.id);

  if (!currentCell || tableBlock?.block.type !== "table") {
    return null;
  }

  const targetContainer =
    resolveTableCellRegion(
      state.documentIndex,
      tableBlock.block.id,
      currentCell.rowIndex + direction,
      currentCell.cellIndex,
    ) ?? findTableExitContainer(state, tableBlock.block.id, direction);

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

  return placeCaretAtLineY(state, layout, caret, targetY, extendSelection);
}

function findTableExitContainer(state: EditorState, tableBlockId: string, direction: -1 | 1) {
  const tableEntry = resolveBlockEntry(state.documentIndex, tableBlockId);

  return tableEntry
    ? resolveRegionOutsideRoot(state.documentIndex, tableEntry.rootIndex, direction)
    : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
