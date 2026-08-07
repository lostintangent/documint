// Document change detection is bounded anchor matching, not a complete edit script.
// Algorithm:
// - Trim unchanged edges with semantic content hashes.
// - Skip empty, oversized, or low-context broad root windows instead of guessing.
// - Walk remaining block and table arrays left-to-right with small lookahead.
// - Recurse into nested blocks and table cells, emitting anchored block/cell changes.
// - Track work and target budgets; if either is exhausted, return no changes.
import {
  childBlockPath,
  getBlockChildren,
  rootBlockPath,
  tableCellPath,
  tableRowPath,
} from "../model";
import type { Block, Document, TableBlock, TableCell, TableRow } from "../model";
import {
  createDocumentNodeAnchor,
  documentNodeAnchorKey,
  type DocumentNodeAnchor,
} from "./anchors/node";
import {
  type DocumentNodeContentHash,
  estimateDocumentNodeContentHashCost,
  estimateTableCellContentHashCost,
  estimateTableRowContentHashCost,
  resolveBlockContentHash,
  resolveTableCellContentHash,
  resolveTableRowContentHash,
} from "./content-hash";

export type DocumentChangeKind = "added" | "modified";

// A node that changed between two snapshots, identified by its content-addressable
// `DocumentNodeAnchor` — which already carries the snapshot path and the block vs
// table-cell kind, so there is no separate change "target".
export type DocumentChange =
  | { readonly anchor: DocumentNodeAnchor; readonly kind: "added" }
  | {
      readonly anchor: DocumentNodeAnchor;
      readonly kind: "modified";
      readonly previousAnchor: DocumentNodeAnchor;
    };

type DiffContext = {
  nextDocument: Document;
  overBudget: boolean;
  previousDocument: Document;
  changeKeys: Set<string>;
  changes: DocumentChange[];
  visitedNodes: number;
};

type TrimmedWindow = {
  nextEnd: number;
  nextStart: number;
  previousEnd: number;
  previousStart: number;
};

const maxChangedRootRatio = 0.45;
const maxBlockSimilarityLookahead = 8;
const minBroadRootWindowStableRoots = 4;
const maxRootWindow = 96;
const maxChanges = 64;
const maxVisitedNodes = 800;

export function findDocumentChanges(
  previousDocument: Document,
  nextDocument: Document,
): readonly DocumentChange[] {
  const context: DiffContext = {
    nextDocument,
    overBudget: false,
    previousDocument,
    changeKeys: new Set(),
    changes: [],
    visitedNodes: 0,
  };

  collectRootBlockChanges(previousDocument, nextDocument, context);
  return context.overBudget ? [] : context.changes;
}

function collectRootBlockChanges(
  previousDocument: Document,
  nextDocument: Document,
  context: DiffContext,
) {
  const previousBlocks = previousDocument.blocks;
  const nextBlocks = nextDocument.blocks;
  const window = trimMatchingEdges(previousBlocks, nextBlocks, context, {
    same: (previousBlock, nextBlock) =>
      haveSameDocumentNodeContentHash(context, previousBlock, nextBlock),
  });

  const totalRoots = Math.max(previousBlocks.length, nextBlocks.length);
  const rootWindow = Math.max(
    window.previousEnd - window.previousStart,
    window.nextEnd - window.nextStart,
  );

  if (
    shouldSkipRootWindow({
      context,
      nextBlocks,
      totalRoots,
      previousBlocks,
      rootWindow,
      window,
    })
  ) {
    return;
  }

  diffBlockArray({
    nextBlocks,
    nextEnd: window.nextEnd,
    nextStart: window.nextStart,
    pathForIndex: rootBlockPath,
    previousPathForIndex: rootBlockPath,
    previousBlocks,
    previousEnd: window.previousEnd,
    previousStart: window.previousStart,
    context,
  });
}

function shouldSkipRootWindow({
  context,
  nextBlocks,
  totalRoots,
  previousBlocks,
  rootWindow,
  window,
}: {
  context: DiffContext;
  nextBlocks: readonly Block[];
  totalRoots: number;
  previousBlocks: readonly Block[];
  rootWindow: number;
  window: TrimmedWindow;
}) {
  if (rootWindow === 0 || rootWindow > maxRootWindow) {
    return true;
  }

  if (totalRoots < 8 || rootWindow / totalRoots <= maxChangedRootRatio) {
    return false;
  }

  const matchStats = estimateRootWindowMatchStats({
    context,
    nextBlocks,
    previousBlocks,
    window,
  });

  if (matchStats.unstableRootRatio <= maxChangedRootRatio) {
    return false;
  }

  if (matchStats.stableRoots >= minBroadRootWindowStableRoots) {
    return false;
  }

  // Broad same-length outline edits have no stable paragraph anchors, but
  // heading-to-heading pairs still produce precise, bounded changes.
  if (hasOnlyHeadingRootChanges({ context, nextBlocks, previousBlocks, window })) {
    return false;
  }

  return true;
}

function estimateRootWindowMatchStats({
  context,
  nextBlocks,
  previousBlocks,
  window,
}: {
  context: DiffContext;
  nextBlocks: readonly Block[];
  previousBlocks: readonly Block[];
  window: TrimmedWindow;
}) {
  const previousHashes = countBlockContentHashes(
    previousBlocks,
    window.previousStart,
    window.previousEnd,
    context,
  );
  const nextHashes = countBlockContentHashes(nextBlocks, window.nextStart, window.nextEnd, context);
  const rootWindow = Math.max(
    window.previousEnd - window.previousStart,
    window.nextEnd - window.nextStart,
  );
  let stableRoots = 0;

  for (const [hash, previousCount] of previousHashes) {
    stableRoots += Math.min(previousCount, nextHashes.get(hash) ?? 0);
  }

  return {
    stableRoots,
    unstableRootRatio: rootWindow === 0 ? 0 : (rootWindow - stableRoots) / rootWindow,
  };
}

function countBlockContentHashes(
  blocks: readonly Block[],
  start: number,
  end: number,
  context: DiffContext,
) {
  const hashes = new Map<DocumentNodeContentHash, number>();

  for (let index = start; index < end && !shouldStopDiffing(context); index += 1) {
    const block = blocks[index]!;
    if (chargeDiffCost(context, estimateDocumentNodeContentHashCost(block))) {
      break;
    }

    const hash = resolveBlockContentHash(block);
    hashes.set(hash, (hashes.get(hash) ?? 0) + 1);
  }

  return hashes;
}

function hasOnlyHeadingRootChanges({
  context,
  nextBlocks,
  previousBlocks,
  window,
}: {
  context: DiffContext;
  nextBlocks: readonly Block[];
  previousBlocks: readonly Block[];
  window: TrimmedWindow;
}) {
  const previousLength = window.previousEnd - window.previousStart;
  const nextLength = window.nextEnd - window.nextStart;
  if (previousLength !== nextLength || previousLength === 0) {
    return false;
  }

  let changedRoots = 0;
  for (let offset = 0; offset < previousLength && !shouldStopDiffing(context); offset += 1) {
    const previousBlock = previousBlocks[window.previousStart + offset]!;
    const nextBlock = nextBlocks[window.nextStart + offset]!;

    if (haveSameDocumentNodeContentHash(context, previousBlock, nextBlock)) {
      continue;
    }

    if (previousBlock.type !== "heading" || nextBlock.type !== "heading") {
      return false;
    }

    changedRoots += 1;
  }

  return changedRoots > 0;
}

function diffBlockArray({
  context,
  nextBlocks,
  nextEnd,
  nextStart,
  pathForIndex,
  previousPathForIndex,
  previousBlocks,
  previousEnd,
  previousStart,
}: {
  context: DiffContext;
  nextBlocks: readonly Block[];
  nextEnd: number;
  nextStart: number;
  pathForIndex: (index: number) => string;
  previousPathForIndex: (index: number) => string;
  previousBlocks: readonly Block[];
  previousEnd: number;
  previousStart: number;
}) {
  let previousIndex = previousStart;
  let nextIndex = nextStart;

  while (nextIndex < nextEnd && !shouldStopDiffing(context)) {
    const nextBlock = nextBlocks[nextIndex]!;
    const previousBlock = previousBlocks[previousIndex] ?? null;

    if (!previousBlock || previousIndex >= previousEnd) {
      recordAdded(pathForIndex(nextIndex), context);
      nextIndex += 1;
      continue;
    }

    if (haveSameDocumentNodeContentHash(context, previousBlock, nextBlock)) {
      previousIndex += 1;
      nextIndex += 1;
      continue;
    }

    if (
      hasBetterFollowingBlockMatch(
        context,
        previousBlock,
        nextBlock,
        nextBlocks,
        nextIndex + 1,
        nextEnd,
      )
    ) {
      recordAdded(pathForIndex(nextIndex), context);
      nextIndex += 1;
      continue;
    }

    const previousContentHashAppearsLater = blockContentHashAppearsInRange(
      nextBlocks,
      nextIndex + 1,
      nextEnd,
      resolveBlockContentHash(previousBlock),
      context,
    );
    const nextContentHashAppearsLater = blockContentHashAppearsInRange(
      previousBlocks,
      previousIndex + 1,
      previousEnd,
      resolveBlockContentHash(nextBlock),
      context,
    );

    if (previousContentHashAppearsLater && !nextContentHashAppearsLater) {
      recordAdded(pathForIndex(nextIndex), context);
      nextIndex += 1;
      continue;
    }

    if (nextContentHashAppearsLater && !previousContentHashAppearsLater) {
      previousIndex += 1;
      continue;
    }

    diffBlocks(
      previousBlock,
      nextBlock,
      previousPathForIndex(previousIndex),
      pathForIndex(nextIndex),
      context,
    );
    previousIndex += 1;
    nextIndex += 1;
  }

  for (; nextIndex < nextEnd && !shouldStopDiffing(context); nextIndex += 1) {
    recordAdded(pathForIndex(nextIndex), context);
  }
}

function diffBlocks(
  previousBlock: Block,
  nextBlock: Block,
  previousPath: string,
  nextPath: string,
  context: DiffContext,
) {
  if (
    chargeDiffCost(context) ||
    haveSameDocumentNodeContentHash(context, previousBlock, nextBlock)
  ) {
    return;
  }

  if (previousBlock.type !== nextBlock.type) {
    recordModified(previousPath, nextPath, context);
    return;
  }

  if (previousBlock.type === "table" && nextBlock.type === "table") {
    diffTableRowsAndCells(previousBlock, nextBlock, previousPath, nextPath, context);
    return;
  }

  if (didBlockMetadataChange(previousBlock, nextBlock)) {
    recordModified(previousPath, nextPath, context);
    return;
  }

  const previousChildren = getBlockChildren(previousBlock);
  const nextChildren = getBlockChildren(nextBlock);
  if (previousChildren && nextChildren) {
    diffBlockArray({
      context,
      nextBlocks: nextChildren,
      nextEnd: nextChildren.length,
      nextStart: 0,
      pathForIndex: (index) => childBlockPath(nextPath, index),
      previousPathForIndex: (index) => childBlockPath(previousPath, index),
      previousBlocks: previousChildren,
      previousEnd: previousChildren.length,
      previousStart: 0,
    });
    return;
  }

  recordModified(previousPath, nextPath, context);
}

function diffTableRowsAndCells(
  previousTable: TableBlock,
  nextTable: TableBlock,
  previousPath: string,
  nextPath: string,
  context: DiffContext,
) {
  const metadataChanged =
    previousTable.align.length !== nextTable.align.length ||
    previousTable.align.some((align, index) => align !== nextTable.align[index]);
  const window = trimMatchingEdges(previousTable.rows, nextTable.rows, context, {
    same: (previousRow, nextRow) => haveSameTableRowContentHash(context, previousRow, nextRow),
  });

  if (metadataChanged) {
    addTrimmedTableRowChanges(previousTable, nextTable, previousPath, nextPath, window, context);
  }

  let previousIndex = window.previousStart;
  let nextIndex = window.nextStart;
  while (nextIndex < window.nextEnd && !shouldStopDiffing(context)) {
    const previousRow = previousTable.rows[previousIndex] ?? null;
    const nextRow = nextTable.rows[nextIndex]!;

    if (!previousRow || previousIndex >= window.previousEnd) {
      recordAddedTableRow(nextPath, nextIndex, nextRow, context);
      nextIndex += 1;
      continue;
    }

    const followingNextRow = nextIndex + 1 < window.nextEnd ? nextTable.rows[nextIndex + 1]! : null;
    if (
      followingNextRow &&
      tableRowSimilarity(context, previousRow, followingNextRow) >
        tableRowSimilarity(context, previousRow, nextRow)
    ) {
      recordAddedTableRow(nextPath, nextIndex, nextRow, context);
      nextIndex += 1;
      continue;
    }

    diffTableRowCells(
      previousRow,
      nextRow,
      previousPath,
      nextPath,
      previousIndex,
      nextIndex,
      context,
    );
    previousIndex += 1;
    nextIndex += 1;
  }
}

function didBlockMetadataChange(previousBlock: Block, nextBlock: Block) {
  switch (nextBlock.type) {
    case "list":
      return (
        previousBlock.type !== "list" ||
        previousBlock.ordered !== nextBlock.ordered ||
        previousBlock.start !== nextBlock.start ||
        previousBlock.compact !== nextBlock.compact
      );
    case "listItem":
      return (
        previousBlock.type !== "listItem" ||
        previousBlock.checked !== nextBlock.checked ||
        previousBlock.compact !== nextBlock.compact
      );
    default:
      return false;
  }
}

function blockContentHashAppearsInRange(
  blocks: readonly Block[],
  start: number,
  end: number,
  contentHash: DocumentNodeContentHash,
  context: DiffContext,
) {
  for (let index = start; index < end && !shouldStopDiffing(context); index += 1) {
    const block = blocks[index]!;
    if (chargeDiffCost(context, estimateDocumentNodeContentHashCost(block))) {
      return false;
    }

    if (resolveBlockContentHash(block) === contentHash) {
      return true;
    }
  }
  return false;
}

function haveSameDocumentNodeContentHash(context: DiffContext, left: Block, right: Block) {
  if (left === right) {
    return true;
  }

  if (
    chargeDiffCost(
      context,
      estimateDocumentNodeContentHashCost(left) + estimateDocumentNodeContentHashCost(right),
    )
  ) {
    return false;
  }

  return resolveBlockContentHash(left) === resolveBlockContentHash(right);
}

function haveSameTableRowContentHash(context: DiffContext, left: TableRow, right: TableRow) {
  if (left.cells.length !== right.cells.length) {
    return false;
  }

  if (
    chargeDiffCost(
      context,
      estimateTableRowContentHashCost(left) + estimateTableRowContentHashCost(right),
    )
  ) {
    return false;
  }

  return resolveTableRowContentHash(left) === resolveTableRowContentHash(right);
}

function diffTableRowCells(
  previousRow: TableRow,
  nextRow: TableRow,
  previousTablePath: string,
  nextTablePath: string,
  previousRowIndex: number,
  nextRowIndex: number,
  context: DiffContext,
) {
  const window = trimMatchingEdges(previousRow.cells, nextRow.cells, context, {
    same: (previousCell, nextCell) => haveSameTableCellContentHash(context, previousCell, nextCell),
  });

  let previousCellIndex = window.previousStart;
  let nextCellIndex = window.nextStart;
  while (nextCellIndex < window.nextEnd && !shouldStopDiffing(context)) {
    const previousCell =
      previousCellIndex < window.previousEnd
        ? (previousRow.cells[previousCellIndex] ?? null)
        : null;
    const nextCell = nextRow.cells[nextCellIndex]!;

    if (!previousCell) {
      recordAdded(tableCellPath(tableRowPath(nextTablePath, nextRowIndex), nextCellIndex), context);
      nextCellIndex += 1;
      continue;
    }

    const followingNextCell =
      nextCellIndex + 1 < window.nextEnd ? nextRow.cells[nextCellIndex + 1]! : null;
    if (
      followingNextCell &&
      tableCellSimilarity(context, previousCell, followingNextCell) >
        tableCellSimilarity(context, previousCell, nextCell)
    ) {
      recordAdded(tableCellPath(tableRowPath(nextTablePath, nextRowIndex), nextCellIndex), context);
      nextCellIndex += 1;
      continue;
    }

    recordModified(
      tableCellPath(tableRowPath(previousTablePath, previousRowIndex), previousCellIndex),
      tableCellPath(tableRowPath(nextTablePath, nextRowIndex), nextCellIndex),
      context,
    );
    previousCellIndex += 1;
    nextCellIndex += 1;
  }
}

function tableRowSimilarity(context: DiffContext, previousRow: TableRow, nextRow: TableRow) {
  const width = Math.min(previousRow.cells.length, nextRow.cells.length);
  let score = 0;

  for (let index = 0; index < width && !shouldStopDiffing(context); index += 1) {
    score += tableCellSimilarity(context, previousRow.cells[index]!, nextRow.cells[index]!);
  }

  return score;
}

function blockSimilarity(context: DiffContext, previousBlock: Block, nextBlock: Block) {
  if (
    chargeDiffCost(
      context,
      estimateDocumentNodeContentHashCost(previousBlock) +
        estimateDocumentNodeContentHashCost(nextBlock),
    )
  ) {
    return 0;
  }

  if (resolveBlockContentHash(previousBlock) === resolveBlockContentHash(nextBlock)) {
    return 2;
  }

  const previousText = previousBlock.plainText.trim();
  const nextText = nextBlock.plainText.trim();
  if (previousText.length === 0 || nextText.length === 0) {
    return 0;
  }

  if (chargeDiffCost(context, estimateTextComparisonCost(previousText, nextText))) {
    return 0;
  }

  return previousText.includes(nextText) || nextText.includes(previousText) ? 1 : 0;
}

function hasBetterFollowingBlockMatch(
  context: DiffContext,
  previousBlock: Block,
  nextBlock: Block,
  nextBlocks: readonly Block[],
  start: number,
  end: number,
) {
  const currentScore = blockSimilarity(context, previousBlock, nextBlock);
  const lookaheadEnd = Math.min(end, start + maxBlockSimilarityLookahead);

  for (let index = start; index < lookaheadEnd && !shouldStopDiffing(context); index += 1) {
    if (blockSimilarity(context, previousBlock, nextBlocks[index]!) > currentScore) {
      return true;
    }
  }

  return false;
}

function tableCellSimilarity(context: DiffContext, previousCell: TableCell, nextCell: TableCell) {
  if (
    chargeDiffCost(
      context,
      estimateTableCellContentHashCost(previousCell) + estimateTableCellContentHashCost(nextCell),
    )
  ) {
    return 0;
  }

  if (resolveTableCellContentHash(previousCell) === resolveTableCellContentHash(nextCell)) {
    return 2;
  }

  const previousText = previousCell.plainText.trim();
  const nextText = nextCell.plainText.trim();
  if (previousText.length === 0 || nextText.length === 0) {
    return 0;
  }

  if (chargeDiffCost(context, estimateTextComparisonCost(previousText, nextText))) {
    return 0;
  }

  return previousText.includes(nextText) || nextText.includes(previousText) ? 1 : 0;
}

function addTrimmedTableRowChanges(
  previousTable: TableBlock,
  nextTable: TableBlock,
  previousTablePath: string,
  nextTablePath: string,
  window: TrimmedWindow,
  context: DiffContext,
) {
  for (
    let rowIndex = 0;
    rowIndex < window.previousStart && !shouldStopDiffing(context);
    rowIndex += 1
  ) {
    recordModifiedTableRow(
      previousTablePath,
      nextTablePath,
      rowIndex,
      rowIndex,
      previousTable.rows[rowIndex]!,
      nextTable.rows[rowIndex]!,
      context,
    );
  }

  const suffixRows = previousTable.rows.length - window.previousEnd;
  for (let offset = 0; offset < suffixRows && !shouldStopDiffing(context); offset += 1) {
    const previousRowIndex = window.previousEnd + offset;
    const nextRowIndex = window.nextEnd + offset;
    recordModifiedTableRow(
      previousTablePath,
      nextTablePath,
      previousRowIndex,
      nextRowIndex,
      previousTable.rows[previousRowIndex]!,
      nextTable.rows[nextRowIndex]!,
      context,
    );
  }
}

function recordAddedTableRow(
  tablePath: string,
  rowIndex: number,
  row: TableRow,
  context: DiffContext,
) {
  for (
    let cellIndex = 0;
    cellIndex < row.cells.length && !shouldStopDiffing(context);
    cellIndex += 1
  ) {
    recordAdded(tableCellPath(tableRowPath(tablePath, rowIndex), cellIndex), context);
  }
}

function recordModifiedTableRow(
  previousTablePath: string,
  nextTablePath: string,
  previousRowIndex: number,
  nextRowIndex: number,
  previousRow: TableRow,
  nextRow: TableRow,
  context: DiffContext,
) {
  const width = Math.min(previousRow.cells.length, nextRow.cells.length);
  for (let cellIndex = 0; cellIndex < width && !shouldStopDiffing(context); cellIndex += 1) {
    recordModified(
      tableCellPath(tableRowPath(previousTablePath, previousRowIndex), cellIndex),
      tableCellPath(tableRowPath(nextTablePath, nextRowIndex), cellIndex),
      context,
    );
  }

  for (
    let cellIndex = width;
    cellIndex < nextRow.cells.length && !shouldStopDiffing(context);
    cellIndex += 1
  ) {
    recordAdded(tableCellPath(tableRowPath(nextTablePath, nextRowIndex), cellIndex), context);
  }
}

function haveSameTableCellContentHash(
  context: DiffContext,
  left: TableRow["cells"][number],
  right: TableRow["cells"][number],
) {
  if (left === right) {
    return true;
  }

  if (
    chargeDiffCost(
      context,
      estimateTableCellContentHashCost(left) + estimateTableCellContentHashCost(right),
    )
  ) {
    return false;
  }

  return resolveTableCellContentHash(left) === resolveTableCellContentHash(right);
}

function trimMatchingEdges<T>(
  previousItems: readonly T[],
  nextItems: readonly T[],
  context: DiffContext,
  options: {
    same: (previousItem: T, nextItem: T) => boolean;
  },
): TrimmedWindow {
  let previousStart = 0;
  let nextStart = 0;

  while (
    !shouldStopDiffing(context) &&
    previousStart < previousItems.length &&
    nextStart < nextItems.length &&
    options.same(previousItems[previousStart]!, nextItems[nextStart]!)
  ) {
    previousStart += 1;
    nextStart += 1;
  }

  let previousEnd = previousItems.length;
  let nextEnd = nextItems.length;
  while (
    !shouldStopDiffing(context) &&
    previousEnd > previousStart &&
    nextEnd > nextStart &&
    options.same(previousItems[previousEnd - 1]!, nextItems[nextEnd - 1]!)
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return { nextEnd, nextStart, previousEnd, previousStart };
}

function recordAdded(path: string, context: DiffContext) {
  pushChange({ anchor: requireAnchor(context.nextDocument, path), kind: "added" }, context);
}

function recordModified(previousPath: string, nextPath: string, context: DiffContext) {
  pushChange(
    {
      anchor: requireAnchor(context.nextDocument, nextPath),
      kind: "modified",
      previousAnchor: requireAnchor(context.previousDocument, previousPath),
    },
    context,
  );
}

function requireAnchor(document: Document, path: string): DocumentNodeAnchor {
  const anchor = createDocumentNodeAnchor(document, path);
  if (!anchor) {
    throw new Error(`Unable to anchor document change at ${path}`);
  }
  return anchor;
}

function pushChange(target: DocumentChange, context: DiffContext) {
  if (context.changes.length >= maxChanges) {
    context.overBudget = true;
    return;
  }

  const key = `${target.kind}:${documentNodeAnchorKey(target.anchor)}`;
  if (!context.changeKeys.has(key)) {
    context.changeKeys.add(key);
    context.changes.push(target);
  }
}

function chargeDiffCost(context: DiffContext, cost = 1) {
  context.visitedNodes += cost;
  return shouldStopDiffing(context);
}

function estimateTextComparisonCost(left: string, right: string) {
  return Math.max(1, Math.ceil((left.length + right.length) / 256));
}

function shouldStopDiffing(context: DiffContext) {
  if (context.overBudget) {
    return true;
  }

  if (context.changes.length >= maxChanges || context.visitedNodes >= maxVisitedNodes) {
    context.overBudget = true;
    return true;
  }

  return false;
}
