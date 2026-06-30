/**
 * Table-specific vertical navigation. This layer overrides the default
 * line-based up/down behavior so table cells move by row and column first,
 * then fall back to the surrounding document when the caret exits the table.
 */
import { type CaretTarget, type DocumentLayout } from "../layout";
import {
  type EditorState,
  resolveAdjacentEditorPathWithTextOutsideBlock,
  resolveIndexedBlock,
  resolveIndexedTableCell,
  resolveIndexedTableCellByTablePath,
} from "../state";
import { placeCaretAtLineY } from "./line";

export type VerticalTablePathTarget = {
  currentPath: string;
  targetPath: string | null;
};

export function resolveVerticalTablePathTarget(
  state: EditorState,
  direction: -1 | 1,
): VerticalTablePathTarget | null {
  const currentPath = state.selection.focus.path;
  const currentCell = resolveIndexedTableCell(state.documentIndex, currentPath);

  if (!currentCell) {
    return null;
  }

  const tableBlock = resolveIndexedBlock(state.documentIndex, currentCell.tablePath);

  if (tableBlock?.block.type !== "table") {
    return null;
  }

  const targetPath =
    resolveIndexedTableCellByTablePath(
      state.documentIndex,
      tableBlock.path,
      currentCell.rowIndex + direction,
      currentCell.cellIndex,
    )?.path ??
    resolveAdjacentEditorPathWithTextOutsideBlock(
      state.documentIndex,
      tableBlock.path,
      direction,
    );

  return { currentPath, targetPath };
}

export function moveCaretVerticallyInTable(
  state: EditorState,
  layout: DocumentLayout,
  caret: CaretTarget,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const target = resolveVerticalTablePathTarget(state, direction);

  if (!target) {
    return null;
  }

  const { currentPath, targetPath } = target;

  if (!targetPath) {
    return state;
  }

  const currentExtent = layout.pathBounds.get(currentPath);
  const targetExtent = layout.pathBounds.get(targetPath);

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
