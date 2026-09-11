// Complete document comparison reinserts detected deletions into the current document,
// then re-anchors every change against that complete display document.
import { rebuildTableBlock, spliceDocument } from "../../build";
import {
  childBlockPath,
  getBlockChildren,
  rebuildBlockChildren,
  rootBlockPath,
  tableCellPath,
  tableCellPathContextFromPath,
  tableRowPath,
} from "../../model";
import type { Block, Document, TableBlock, TableRow } from "../../model";
import type { DocumentNodeAnchor } from "../anchors/node";
import {
  detectDocumentChanges,
  requireDocumentNodeAnchor,
  type DetectionState,
  type DocumentChange,
} from "./detection";

type ComparisonBuildState = {
  readonly comparisonPathByCurrentPath: Map<string, string>;
  readonly detection: DetectionState;
  readonly deletedNodePaths: string[];
};

export function compareDocuments(
  previousDocument: Document,
  currentDocument: Document,
): { readonly changes: readonly DocumentChange[]; readonly document: Document } {
  const detection = detectDocumentChanges(previousDocument, currentDocument, true);
  if (!detection.deletedBlocksByPath && !detection.deletedRowsByPath) {
    return { changes: detection.changes, document: currentDocument };
  }

  return buildComparisonDocument(currentDocument, detection);
}

function buildComparisonDocument(currentDocument: Document, detection: DetectionState) {
  const state: ComparisonBuildState = {
    comparisonPathByCurrentPath: new Map(),
    detection,
    deletedNodePaths: [],
  };
  const blocks = insertDeletedBlocks(currentDocument.blocks, rootBlockPath, rootBlockPath, state);
  const document = spliceDocument(currentDocument, 0, currentDocument.blocks.length, blocks);
  const changes: DocumentChange[] = detection.changes.map((change) => {
    const path = documentNodePathInComparison(change.anchor, state);

    if (!path) {
      throw new Error(`Unable to place document change at ${change.anchor.path}`);
    }

    return { ...change, anchor: requireDocumentNodeAnchor(document, path) };
  });

  for (const path of state.deletedNodePaths) {
    changes.push({
      anchor: requireDocumentNodeAnchor(document, path),
      kind: "deleted",
    });
  }

  return { changes, document };
}

function insertDeletedBlocks(
  currentBlocks: Block[],
  currentPathForIndex: (index: number) => string,
  comparisonPathForIndex: (index: number) => string,
  state: ComparisonBuildState,
): Block[] {
  const comparisonBlocks: Block[] = [];
  let changed = false;

  for (let currentIndex = 0; currentIndex <= currentBlocks.length; currentIndex += 1) {
    const currentPath = currentPathForIndex(currentIndex);
    const deletedBlocks = state.detection.deletedBlocksByPath?.get(currentPath);

    for (const block of deletedBlocks ?? []) {
      state.deletedNodePaths.push(comparisonPathForIndex(comparisonBlocks.length));
      comparisonBlocks.push(block);
      changed = true;
    }

    const currentBlock = currentBlocks[currentIndex];
    if (!currentBlock) {
      continue;
    }

    const comparisonPath = comparisonPathForIndex(comparisonBlocks.length);
    if (comparisonPath !== currentPath) {
      state.comparisonPathByCurrentPath.set(currentPath, comparisonPath);
    }
    if (currentBlock.type === "table") {
      const comparisonTable = insertDeletedTableRows(
        currentBlock,
        currentPath,
        comparisonPath,
        state,
      );
      comparisonBlocks.push(comparisonTable);
      changed ||= comparisonTable !== currentBlock;
      continue;
    }

    const currentChildren = getBlockChildren(currentBlock);
    if (!currentChildren) {
      comparisonBlocks.push(currentBlock);
      continue;
    }

    const comparisonChildren = insertDeletedBlocks(
      currentChildren,
      (index) => childBlockPath(currentPath, index),
      (index) => childBlockPath(comparisonPath, index),
      state,
    );
    comparisonBlocks.push(
      comparisonChildren === currentChildren
        ? currentBlock
        : rebuildBlockChildren(currentBlock, comparisonChildren),
    );
    changed ||= comparisonChildren !== currentChildren;
  }

  return changed ? comparisonBlocks : currentBlocks;
}

function insertDeletedTableRows(
  currentTable: TableBlock,
  currentTablePath: string,
  comparisonTablePath: string,
  state: ComparisonBuildState,
) {
  const comparisonRows: TableRow[] = [];
  let changed = false;

  for (let currentIndex = 0; currentIndex <= currentTable.rows.length; currentIndex += 1) {
    const currentPath = tableRowPath(currentTablePath, currentIndex);
    const deletedRows = state.detection.deletedRowsByPath?.get(currentPath);

    for (const row of deletedRows ?? []) {
      const comparisonPath = tableRowPath(comparisonTablePath, comparisonRows.length);
      for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
        state.deletedNodePaths.push(tableCellPath(comparisonPath, cellIndex));
      }
      comparisonRows.push(row);
      changed = true;
    }

    const currentRow = currentTable.rows[currentIndex];
    if (!currentRow) {
      continue;
    }

    const comparisonPath = tableRowPath(comparisonTablePath, comparisonRows.length);
    if (comparisonPath !== currentPath) {
      state.comparisonPathByCurrentPath.set(currentPath, comparisonPath);
    }
    comparisonRows.push(currentRow);
  }

  return changed ? rebuildTableBlock(currentTable, comparisonRows) : currentTable;
}

function documentNodePathInComparison(anchor: DocumentNodeAnchor, state: ComparisonBuildState) {
  if (anchor.kind === "block") {
    return state.comparisonPathByCurrentPath.get(anchor.path) ?? anchor.path;
  }

  const cell = tableCellPathContextFromPath(anchor.path);
  if (!cell) {
    return null;
  }

  const currentRowPath = tableRowPath(cell.tablePath, cell.rowIndex);
  const comparisonRowPath = state.comparisonPathByCurrentPath.get(currentRowPath) ?? currentRowPath;
  return tableCellPath(comparisonRowPath, cell.cellIndex);
}
