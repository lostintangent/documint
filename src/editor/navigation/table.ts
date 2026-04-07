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
import { setCanvasSelection, type EditorState } from "../model/state";

export function moveCaretVerticallyInTable(
  state: EditorState,
  layout: ViewportLayout,
  caret: CaretTarget,
  direction: -1 | 1,
) {
  const currentContainer =
    state.documentEditor.regionIndex.get(state.selection.focus.regionId) ?? null;

  if (!currentContainer) {
    return null;
  }

  const currentCell = state.documentEditor.tableCellIndex.get(currentContainer.id) ?? null;
  const tableBlock = state.documentEditor.blockIndex.get(currentContainer.blockId) ?? null;

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

  const currentExtent = layout.regionExtents.get(currentContainer.id);
  const targetExtent = layout.regionExtents.get(targetContainer.id);

  if (!currentExtent || !targetExtent) {
    return state;
  }

  const targetY =
    targetExtent.top +
    clamp(
      caret.top + caret.height / 2 - currentExtent.top,
      0,
      Math.max(0, targetExtent.bottom - targetExtent.top - 1),
    );
  const hit = resolveEditorHitAtPoint(layout, state, {
    x: resolveCaretVisualLeft(state, layout, caret) + 1,
    y: targetY,
  });

  if (!hit) {
    return state;
  }

  return setCanvasSelection(state, {
    regionId: hit.regionId,
    offset: hit.offset,
  });
}

function findTableRowSiblingContainer(
  state: EditorState,
  tableBlockId: string,
  rowIndex: number,
  cellIndex: number,
) {
  return (
    state.documentEditor.regions.find((container) => {
      if (container.blockId !== tableBlockId) {
        return false;
      }

      const position = state.documentEditor.tableCellIndex.get(container.id);
      return position?.rowIndex === rowIndex && position.cellIndex === cellIndex;
    }) ?? null
  );
}

function findTableExitContainer(
  state: EditorState,
  tableBlockId: string,
  direction: -1 | 1,
) {
  const regions = state.documentEditor.regions;
  const firstIndex = regions.findIndex((container) => container.blockId === tableBlockId);

  if (firstIndex === -1) {
    return null;
  }

  let lastIndex = firstIndex;

  while (
    lastIndex + 1 < regions.length &&
    regions[lastIndex + 1]!.blockId === tableBlockId
  ) {
    lastIndex += 1;
  }

  return direction < 0
    ? regions[firstIndex - 1] ?? null
    : regions[lastIndex + 1] ?? null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
