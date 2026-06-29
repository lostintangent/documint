/**
 * Table-specific vertical navigation. This layer overrides the default
 * line-based up/down behavior so table cells move by row and column first,
 * then fall back to the surrounding document when the caret exits the table.
 */
import { type CaretTarget, type DocumentLayout } from "../layout";
import {
  type EditableRegion,
  type EditorState,
  resolveIndexedBlock,
  resolveRegion,
  resolveRegionOutsideRoot,
  resolveTableCellRegionByTablePath,
} from "../state";
import { placeCaretAtLineY } from "./line";

export type VerticalTableRegionTarget = {
  currentRegion: EditableRegion;
  targetRegion: EditableRegion | null;
};

export function resolveVerticalTableRegionTarget(
  state: EditorState,
  direction: -1 | 1,
): VerticalTableRegionTarget | null {
  const currentRegion = resolveRegion(state.documentIndex, state.selection.focus.regionPath);

  if (!currentRegion) {
    return null;
  }

  const currentCell = currentRegion.tableCellPosition;
  const tableBlock = resolveIndexedBlock(state.documentIndex, currentRegion.blockPath);

  if (!currentCell || tableBlock?.block.type !== "table") {
    return null;
  }

  const targetRegion =
    resolveTableCellRegionByTablePath(
      state.documentIndex,
      tableBlock.path,
      currentCell.rowIndex + direction,
      currentCell.cellIndex,
    ) ?? resolveRegionOutsideRoot(state.documentIndex, tableBlock.rootIndex, direction);

  return { currentRegion, targetRegion };
}

export function moveCaretVerticallyInTable(
  state: EditorState,
  layout: DocumentLayout,
  caret: CaretTarget,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const target = resolveVerticalTableRegionTarget(state, direction);

  if (!target) {
    return null;
  }

  const { currentRegion, targetRegion } = target;

  if (!targetRegion) {
    return state;
  }

  const currentExtent = layout.regionBounds.get(currentRegion.path);
  const targetExtent = layout.regionBounds.get(targetRegion.path);

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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
