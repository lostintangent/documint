// Core read algebra over `DocumentIndex`: path lookups, block extents,
// document-flow navigation, shape predicates, and small projections used by
// anchors, selection, layout, renderer frames, and commands.

import { type Block } from "@/document";
import type {
  DocumentIndex,
  IndexedBlock,
  IndexedInline,
  IndexedTableCell,
  IndexedText,
} from "./types";

export type EditorIndexPosition = {
  offset: number;
  path: string;
};

export type EditorPositionOrder = number;

export type ResolvedEditorPosition = EditorIndexPosition & {
  order: EditorPositionOrder;
};

export type UniqueEditorPathWithTextMatch = {
  ambiguous: boolean;
  path: string | null;
};

// Lookups -------------------------------------------------------------------

export function resolveIndexedBlock(documentIndex: DocumentIndex, blockPath: string) {
  return documentIndex.blockIndex.get(blockPath) ?? null;
}

export function resolveBlockByPath(documentIndex: DocumentIndex, blockPath: string) {
  return resolveIndexedBlock(documentIndex, blockPath)?.block ?? null;
}

// Resolves the editor-coordinate text exposed by a block or table-cell path.
// Structural and inert block paths return null.
export function resolveIndexedText(
  documentIndex: DocumentIndex,
  path: string,
): IndexedText | null {
  const indexedBlock = resolveIndexedBlock(documentIndex, path);

  if (indexedBlock) {
    return isTextBlock(indexedBlock) ? indexedBlock : null;
  }

  return resolveIndexedTableCell(documentIndex, path);
}

export function resolveEditorTextAtPath(
  documentIndex: DocumentIndex,
  path: string,
): string | null {
  return resolveIndexedText(documentIndex, path)?.text ?? null;
}

export function resolveIndexedTextInlines(
  indexedText: IndexedText,
): readonly IndexedInline[] | null {
  return "inlines" in indexedText ? indexedText.inlines : null;
}

export function resolveIndexedTextKind(indexedText: IndexedText): "inlines" | "source" {
  return "inlines" in indexedText ? "inlines" : "source";
}

export function resolveInlinesAtPath(
  documentIndex: DocumentIndex,
  path: string,
): readonly IndexedInline[] | null {
  const indexedText = resolveIndexedText(documentIndex, path);

  return indexedText ? resolveIndexedTextInlines(indexedText) : null;
}

// Block paths resolve to themselves; table-cell paths resolve to the containing table block.
export function resolveIndexedBlockContainingPath(
  documentIndex: DocumentIndex,
  path: string,
): IndexedBlock | null {
  const indexedBlock = resolveIndexedBlock(documentIndex, path);
  if (indexedBlock) {
    return indexedBlock;
  }

  const cell = resolveIndexedTableCell(documentIndex, path);
  return cell ? resolveIndexedBlock(documentIndex, cell.tablePath) : null;
}

export function resolveIndexedTableCell(
  documentIndex: DocumentIndex,
  path: string,
): IndexedTableCell | null {
  return documentIndex.tableCellIndex.get(path) ?? null;
}

export function resolveRootBlock(documentIndex: DocumentIndex, rootIndex: number) {
  return documentIndex.document.blocks[rootIndex] ?? null;
}

export function countRootBlocks(documentIndex: DocumentIndex) {
  return documentIndex.roots.length;
}

export function resolveSiblingRootBlock(
  documentIndex: DocumentIndex,
  rootIndex: number,
  direction: -1 | 1,
) {
  return resolveRootBlock(documentIndex, rootIndex + direction);
}

// Comment projection --------------------------------------------------------

export function resolveCommentThreadIndicesForPath(
  documentIndex: DocumentIndex,
  path: string,
): readonly number[] {
  return documentIndex.commentContainerIndex.get(path) ?? [];
}

// Block extents -------------------------------------------------------------

export function blockContainsBlock(parent: IndexedBlock, child: IndexedBlock) {
  return (
    parent.blockArrayIndex <= child.blockArrayIndex &&
    child.blockRangeEnd <= parent.blockRangeEnd
  );
}

export function resolveParentIndexedBlock(
  documentIndex: DocumentIndex,
  indexedBlock: IndexedBlock,
) {
  return indexedBlock.parentBlockPath
    ? resolveIndexedBlock(documentIndex, indexedBlock.parentBlockPath)
    : null;
}

export function findAncestorIndexedBlockByPath(
  documentIndex: DocumentIndex,
  blockPath: string | null,
  type: Block["type"],
) {
  let current = blockPath ? resolveIndexedBlock(documentIndex, blockPath) : null;

  while (current) {
    if (current.block.type === type) {
      return current;
    }

    current = resolveParentIndexedBlock(documentIndex, current);
  }

  return null;
}

export function resolveIndexedTableCellByTablePath(
  documentIndex: DocumentIndex,
  tableBlockPath: string,
  rowIndex: number,
  cellIndex: number,
) {
  const indexedTable = resolveIndexedBlock(documentIndex, tableBlockPath);

  if (!indexedTable || indexedTable.kind !== "cells") {
    return null;
  }

  return indexedTable.tableCellRows[rowIndex]?.[cellIndex] ?? null;
}

// Document flow -------------------------------------------------------------

export function compareEditorPositions(
  documentIndex: DocumentIndex,
  a: EditorIndexPosition,
  b: EditorIndexPosition,
  options: { unknown?: "before" | "throw" } = {},
): number {
  if (a.path === b.path) {
    return a.offset - b.offset;
  }

  return compareResolvedEditorPositions(
    resolveEditorPosition(documentIndex, a, options),
    resolveEditorPosition(documentIndex, b, options),
  );
}

export function resolveEditorPosition(
  documentIndex: DocumentIndex,
  point: EditorIndexPosition,
  options: { unknown?: "before" | "throw" } = {},
): ResolvedEditorPosition {
  return {
    ...point,
    order: resolvePositionOrder(documentIndex, point, options.unknown ?? "throw"),
  };
}

export function compareResolvedEditorPositions(
  a: ResolvedEditorPosition,
  b: ResolvedEditorPosition,
): number {
  if (a.path === b.path) {
    return a.offset - b.offset;
  }

  const order = a.order - b.order;

  return order !== 0 ? order : a.offset - b.offset;
}

export function forEachEditorPathWithText(
  documentIndex: DocumentIndex,
  visit: (path: string, text: string, containingBlock: IndexedBlock) => false | void,
  options: { direction?: -1 | 1; rootIndex?: number } = {},
) {
  const blocks =
    options.rootIndex === undefined
      ? documentIndex.blocks
      : documentIndex.roots[options.rootIndex]?.blocks;

  if (!blocks) {
    return;
  }

  const direction = options.direction ?? 1;
  for (
    let index = direction > 0 ? 0 : blocks.length - 1;
    index >= 0 && index < blocks.length;
    index += direction
  ) {
    if (visitEditorPathsWithTextInBlock(blocks[index]!, direction, visit) === false) {
      return;
    }
  }
}

export function findEditorPathWithText(
  documentIndex: DocumentIndex,
  predicate: (path: string, text: string, containingBlock: IndexedBlock) => boolean,
  options: { direction?: -1 | 1; rootIndex?: number } = {},
) {
  let match: string | null = null;

  forEachEditorPathWithText(
    documentIndex,
    (path, text, indexedBlock) => {
      if (!predicate(path, text, indexedBlock)) {
        return;
      }

      match = path;
      return false;
    },
    options,
  );

  return match;
}

export function findUniqueEditorPathWithText(
  documentIndex: DocumentIndex,
  predicate: (path: string, text: string, containingBlock: IndexedBlock) => boolean,
  options: { direction?: -1 | 1; rootIndex?: number } = {},
): UniqueEditorPathWithTextMatch {
  let match: string | null = null;
  let ambiguous = false;

  forEachEditorPathWithText(
    documentIndex,
    (path, text, indexedBlock) => {
      if (!predicate(path, text, indexedBlock)) {
        return;
      }

      if (match !== null) {
        ambiguous = true;
        return false;
      }

      match = path;
    },
    options,
  );

  return { ambiguous, path: ambiguous ? null : match };
}

export function countEditorPathsWithText(documentIndex: DocumentIndex) {
  return documentIndex.pathsWithTextCount;
}

export function previousBlockInFlow(documentIndex: DocumentIndex, blockPath: string) {
  return findAdjacentBlockInFlow(documentIndex, blockPath, -1);
}

export function nextBlockInFlow(documentIndex: DocumentIndex, blockPath: string) {
  return findAdjacentBlockInFlow(documentIndex, blockPath, 1);
}

export function resolveAdjacentEditorPathWithTextInFlow(
  documentIndex: DocumentIndex,
  path: string,
  direction: -1 | 1,
) {
  const cell = resolveIndexedTableCell(documentIndex, path);
  if (cell) {
    const table = resolveIndexedBlock(documentIndex, cell.tablePath);
    const fallbackStart =
      direction < 0
        ? (table?.blockArrayIndex ?? -1)
        : (table?.blockRangeEnd ?? documentIndex.blocks.length);

    return (
      findTableCellPathInFlow(table, direction, cell) ??
      findEditorPathWithTextFromBlock(documentIndex, fallbackStart, direction)
    );
  }

  const indexedBlock = resolveIndexedBlock(documentIndex, path);
  if (!indexedBlock || !isTextBlock(indexedBlock)) {
    return null;
  }

  return findEditorPathWithTextFromBlock(
    documentIndex,
    direction < 0 ? indexedBlock.blockArrayIndex : indexedBlock.blockRangeEnd,
    direction,
  );
}

export function resolveDocumentTextPathBoundary(
  documentIndex: DocumentIndex,
  boundary: "end" | "start",
) {
  return findEditorPathWithTextInBlockSlice(
    documentIndex.blocks,
    0,
    documentIndex.blocks.length,
    directionForBoundary(boundary),
  );
}

export function resolveBlockTextPathBoundary(
  documentIndex: DocumentIndex,
  blockPath: string,
  boundary: "end" | "start",
) {
  const block = resolveIndexedBlock(documentIndex, blockPath);
  if (!block) {
    return null;
  }

  return findEditorPathWithTextInBlockSlice(
    documentIndex.blocks,
    block.blockArrayIndex,
    block.blockRangeEnd,
    directionForBoundary(boundary),
  );
}

export function resolveAdjacentEditorPathWithTextOutsideBlock(
  documentIndex: DocumentIndex,
  blockPath: string,
  direction: -1 | 1,
) {
  const block = resolveIndexedBlock(documentIndex, blockPath);
  if (!block) {
    return null;
  }

  return direction < 0
    ? findEditorPathWithTextInBlockSlice(documentIndex.blocks, 0, block.blockArrayIndex, -1)
    : findEditorPathWithTextInBlockSlice(
        documentIndex.blocks,
        block.blockRangeEnd,
        documentIndex.blocks.length,
        1,
      );
}

// Shape and classification --------------------------------------------------

export function isRootIndexedBlock(indexedBlock: IndexedBlock) {
  return indexedBlock.parentBlockPath === null;
}

export function isInertBlock(indexedBlock: IndexedBlock): boolean {
  return indexedBlock.kind === "void";
}

export function isContainerBlock(indexedBlock: IndexedBlock): boolean {
  return indexedBlock.kind === "blocks";
}

export function hasSameEditorTextPathShape(
  previousIndex: DocumentIndex,
  previousPath: string,
  nextIndex: DocumentIndex,
  nextPath: string,
) {
  const previousBlock = resolveIndexedBlockContainingPath(previousIndex, previousPath);
  const nextBlock = resolveIndexedBlockContainingPath(nextIndex, nextPath);
  const previousText = resolveIndexedText(previousIndex, previousPath);
  const nextText = resolveIndexedText(nextIndex, nextPath);

  if (!previousBlock || !nextBlock || !previousText || !nextText) {
    return false;
  }

  if (
    previousBlock.block.type !== nextBlock.block.type ||
    resolveIndexedTextKind(previousText) !== resolveIndexedTextKind(nextText)
  ) {
    return false;
  }

  const previousCell = resolveIndexedTableCell(previousIndex, previousPath);
  const nextCell = resolveIndexedTableCell(nextIndex, nextPath);

  if (!previousCell || !nextCell) {
    return previousCell === nextCell;
  }

  return (
    previousCell.rowIndex === nextCell.rowIndex &&
    previousCell.cellIndex === nextCell.cellIndex
  );
}

// Active handles ------------------------------------------------------------

export function resolveActiveBlockKey(
  documentIndex: DocumentIndex,
  point: EditorIndexPosition,
): string | null {
  const focusedBlock = resolveIndexedBlockContainingPath(documentIndex, point.path);

  if (!focusedBlock) {
    return null;
  }

  return focusedBlock.block.type === "table"
    ? `cell:${point.path}`
    : `block:${focusedBlock.path}`;
}

function resolvePositionOrder(
  documentIndex: DocumentIndex,
  point: EditorIndexPosition,
  unknown: "before" | "throw",
): EditorPositionOrder {
  const indexedBlock = resolveIndexedBlock(documentIndex, point.path);

  if (indexedBlock) {
    if (!isTextBlock(indexedBlock)) {
      return resolveUnknownPositionOrder(point.path, unknown);
    }

    return indexedBlock.editorOrder;
  }

  const cell = resolveIndexedTableCell(documentIndex, point.path);
  if (cell) {
    return cell.editorOrder;
  }

  return resolveUnknownPositionOrder(point.path, unknown);
}

function resolveUnknownPositionOrder(
  path: string,
  unknown: "before" | "throw",
): EditorPositionOrder {
  if (unknown === "before") {
    return -1;
  }

  throw new Error(`Unknown editor path: ${path}`);
}

function isTextBlock(
  indexedBlock: IndexedBlock,
): indexedBlock is Extract<IndexedBlock, { kind: "inlines" | "source" }> {
  return indexedBlock.kind === "inlines" || indexedBlock.kind === "source";
}

function editorPathWithTextForBlock(indexedBlock: IndexedBlock, direction: -1 | 1): string | null {
  let path: string | null = null;

  visitEditorPathsWithTextInBlock(indexedBlock, direction, (candidatePath) => {
    path = candidatePath;
    return false;
  });

  return path;
}

function findEditorPathWithTextFromBlock(
  documentIndex: DocumentIndex,
  blockArrayIndex: number,
  direction: -1 | 1,
): string | null {
  return direction < 0
    ? findEditorPathWithTextInBlockSlice(documentIndex.blocks, 0, blockArrayIndex, -1)
    : findEditorPathWithTextInBlockSlice(
        documentIndex.blocks,
        blockArrayIndex,
        documentIndex.blocks.length,
        1,
      );
}

function findEditorPathWithTextInBlockSlice(
  blocks: readonly IndexedBlock[],
  start: number,
  end: number,
  direction: -1 | 1,
): string | null {
  for (
    let index = direction > 0 ? start : end - 1;
    index >= start && index < end;
    index += direction
  ) {
    const path = editorPathWithTextForBlock(blocks[index]!, direction);
    if (path) {
      return path;
    }
  }

  return null;
}

function directionForBoundary(boundary: "end" | "start"): -1 | 1 {
  return boundary === "start" ? 1 : -1;
}

function visitEditorPathsWithTextInBlock(
  indexedBlock: IndexedBlock,
  direction: -1 | 1,
  visit: (path: string, text: string, containingBlock: IndexedBlock) => false | void,
) {
  if (isTextBlock(indexedBlock)) {
    return visit(indexedBlock.path, indexedBlock.text, indexedBlock);
  }

  if (indexedBlock.kind !== "cells") {
    return;
  }

  return visitTableCellPaths(indexedBlock, direction, visit);
}

function findTableCellPathInFlow(
  indexedBlock: IndexedBlock | null,
  direction: -1 | 1,
  after?: { rowIndex: number; cellIndex: number },
): string | null {
  let path: string | null = null;

  visitTableCellPaths(
    indexedBlock,
    direction,
    (cellPath) => {
      path = cellPath;
      return false;
    },
    after,
  );

  return path;
}

function visitTableCellPaths(
  indexedBlock: IndexedBlock | null,
  direction: -1 | 1,
  visit: (path: string, text: string, containingBlock: IndexedBlock) => false | void,
  after?: { rowIndex: number; cellIndex: number },
) {
  if (!indexedBlock) {
    return;
  }

  if (indexedBlock.kind !== "cells") {
    return;
  }

  const rows = indexedBlock.tableCellRows;
  let rowIndex = after?.rowIndex ?? (direction < 0 ? rows.length - 1 : 0);

  for (; rowIndex >= 0 && rowIndex < rows.length; rowIndex += direction) {
    const row = rows[rowIndex]!;
    let cellIndex =
      after && rowIndex === after.rowIndex
        ? after.cellIndex + direction
        : direction < 0
          ? row.length - 1
          : 0;

    for (; cellIndex >= 0 && cellIndex < row.length; cellIndex += direction) {
      const cell = row[cellIndex]!;
      if (visit(cell.path, cell.text, indexedBlock) === false) {
        return false;
      }
    }
  }
}

function findAdjacentBlockInFlow(
  documentIndex: DocumentIndex,
  fromBlockPath: string,
  direction: -1 | 1,
) {
  const startBlock = resolveIndexedBlock(documentIndex, fromBlockPath);

  if (!startBlock) {
    return null;
  }

  const { blocks } = documentIndex;

  for (
    let index = startBlock.blockArrayIndex + direction;
    index >= 0 && index < blocks.length;
    index += direction
  ) {
    const indexedBlock = blocks[index]!;

    if (!isContainerBlock(indexedBlock)) {
      return indexedBlock;
    }
  }

  return null;
}
