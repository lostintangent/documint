// Core read algebra over `DocumentIndex`: path lookups, block/region extents,
// document-flow navigation, shape predicates, and small projections used by
// anchors, selection, layout, renderer frames, and commands.

import {
  rootBlockPath,
  tableCellPath,
  tableRowPath,
  type Block,
} from "@/document";
import type { IndexedBlock, DocumentIndex, EditableRegion } from "./types";

export type EditorIndexPosition = {
  offset: number;
  regionPath: string;
};

const EMPTY_THREAD_INDICES: readonly number[] = [];
const EMPTY_REGIONS: readonly EditableRegion[] = [];

// Lookups -------------------------------------------------------------------

export function resolveRegion(documentIndex: DocumentIndex, regionPath: string) {
  return documentIndex.regionIndex.get(regionPath) ?? null;
}

export function resolveIndexedBlock(documentIndex: DocumentIndex, blockPath: string) {
  return documentIndex.blockIndex.get(blockPath) ?? null;
}

export function resolveBlockByPath(documentIndex: DocumentIndex, blockPath: string) {
  return resolveIndexedBlock(documentIndex, blockPath)?.block ?? null;
}

export function resolveRootBlock(documentIndex: DocumentIndex, rootIndex: number) {
  return documentIndex.document.blocks[rootIndex] ?? null;
}

export function countRootBlocks(documentIndex: DocumentIndex) {
  return documentIndex.roots.length;
}

export function resolveRootRegions(documentIndex: DocumentIndex, rootIndex: number) {
  return documentIndex.roots[rootIndex]?.regions ?? EMPTY_REGIONS;
}

export function resolveSiblingRootBlock(
  documentIndex: DocumentIndex,
  rootIndex: number,
  direction: -1 | 1,
) {
  return resolveRootBlock(documentIndex, rootIndex + direction);
}

export function resolveIndexedBlockForRegion(documentIndex: DocumentIndex, regionPath: string) {
  const region = resolveRegion(documentIndex, regionPath);

  return region ? resolveIndexedBlock(documentIndex, region.blockPath) : null;
}

// Comment projection --------------------------------------------------------

export function resolveCommentThreadIndicesForRegion(
  documentIndex: DocumentIndex,
  region: EditableRegion,
): readonly number[] {
  return documentIndex.commentContainerIndex.get(region.containerPath) ?? EMPTY_THREAD_INDICES;
}

// Block and region extents --------------------------------------------------

export function firstRegionInBlock(
  documentIndex: DocumentIndex,
  indexedBlock: IndexedBlock,
): EditableRegion | null {
  return indexedBlock.regionRangeStart < indexedBlock.regionRangeEnd
    ? (documentIndex.regions[indexedBlock.regionRangeStart] ?? null)
    : null;
}

export function lastRegionInBlock(
  documentIndex: DocumentIndex,
  indexedBlock: IndexedBlock,
): EditableRegion | null {
  return indexedBlock.regionRangeStart < indexedBlock.regionRangeEnd
    ? (documentIndex.regions[indexedBlock.regionRangeEnd - 1] ?? null)
    : null;
}

export function resolvePrimaryRegionForBlockPath(
  documentIndex: DocumentIndex,
  blockPath: string,
): EditableRegion | null {
  const indexedBlock = resolveIndexedBlock(documentIndex, blockPath);

  return indexedBlock ? firstRegionInBlock(documentIndex, indexedBlock) : null;
}

export function resolveRootPrimaryRegion(documentIndex: DocumentIndex, rootIndex: number) {
  const block = resolveRootBlock(documentIndex, rootIndex);

  return block ? resolvePrimaryRegionForBlockPath(documentIndex, rootBlockPath(rootIndex)) : null;
}

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

export function resolveTableCellRegionByTablePath(
  documentIndex: DocumentIndex,
  tableBlockPath: string,
  rowIndex: number,
  cellIndex: number,
) {
  const indexedTable = resolveIndexedBlock(documentIndex, tableBlockPath);

  if (!indexedTable || indexedTable.block.type !== "table") {
    return null;
  }

  return resolveRegion(
    documentIndex,
    tableCellPath(tableRowPath(indexedTable.path, rowIndex), cellIndex),
  );
}

// Document flow -------------------------------------------------------------

export function compareEditorPositions(
  documentIndex: DocumentIndex,
  a: EditorIndexPosition,
  b: EditorIndexPosition,
  options: { unknown?: "before" | "throw" } = {},
): number {
  const unknown = options.unknown ?? "throw";
  const aOrder = resolvePositionOrder(documentIndex, a, unknown);
  const bOrder = resolvePositionOrder(documentIndex, b, unknown);

  return aOrder !== bOrder ? aOrder - bOrder : a.offset - b.offset;
}

export function previousRegionInFlow(documentIndex: DocumentIndex, regionPath: string) {
  const region = resolveRegion(documentIndex, regionPath);

  if (!region || region.regionArrayIndex === 0) {
    return null;
  }

  return documentIndex.regions[region.regionArrayIndex - 1] ?? null;
}

export function nextRegionInFlow(documentIndex: DocumentIndex, regionPath: string) {
  const region = resolveRegion(documentIndex, regionPath);

  if (!region) {
    return null;
  }

  return documentIndex.regions[region.regionArrayIndex + 1] ?? null;
}

export function previousBlockInFlow(documentIndex: DocumentIndex, blockPath: string) {
  return findAdjacentBlockInFlow(documentIndex, blockPath, -1);
}

export function nextBlockInFlow(documentIndex: DocumentIndex, blockPath: string) {
  return findAdjacentBlockInFlow(documentIndex, blockPath, 1);
}

export function firstInFlowRegionOfRoot(documentIndex: DocumentIndex, rootIndex: number) {
  return resolveRootRegions(documentIndex, rootIndex)[0] ?? null;
}

export function resolveDocumentBoundaryRegion(
  documentIndex: DocumentIndex,
  boundary: "end" | "start",
) {
  return boundary === "start"
    ? (documentIndex.regions[0] ?? null)
    : (documentIndex.regions.at(-1) ?? null);
}

export function resolveRegionOutsideRoot(
  documentIndex: DocumentIndex,
  rootIndex: number,
  direction: -1 | 1,
) {
  const root = documentIndex.roots[rootIndex];
  const rootBlock = root?.blocks[0] ?? null;

  if (!root || !rootBlock || root.regions.length === 0) {
    return null;
  }

  return direction < 0
    ? (documentIndex.regions[rootBlock.regionRangeStart - 1] ?? null)
    : (documentIndex.regions[rootBlock.regionRangeEnd] ?? null);
}

// Shape and classification --------------------------------------------------

export function hasSameEditableRegionShape(
  left: EditableRegion,
  right: EditableRegion,
) {
  return (
    left.block.type === right.block.type &&
    left.content.kind === right.content.kind &&
    hasSameTableCellPosition(left, right)
  );
}

export function hasSameTableCellPosition(left: EditableRegion, right: EditableRegion) {
  if (!left.tableCellPosition || !right.tableCellPosition) {
    return left.tableCellPosition === right.tableCellPosition;
  }

  return (
    left.tableCellPosition.rowIndex === right.tableCellPosition.rowIndex &&
    left.tableCellPosition.cellIndex === right.tableCellPosition.cellIndex
  );
}

export function findUniqueEditableRegion(
  documentIndex: DocumentIndex,
  predicate: (region: EditableRegion) => boolean,
) {
  let match: EditableRegion | null = null;

  for (const region of documentIndex.regions) {
    if (!predicate(region)) {
      continue;
    }

    if (match) {
      return null;
    }

    match = region;
  }

  return match;
}

export function isRootIndexedBlock(indexedBlock: IndexedBlock) {
  return indexedBlock.parentBlockPath === null;
}

export function isInertBlock(indexedBlock: IndexedBlock): boolean {
  return indexedBlock.kind === "inert";
}

export function isContainerBlock(indexedBlock: IndexedBlock): boolean {
  return indexedBlock.kind === "container";
}

export function isInlineRegion(region: EditableRegion): boolean {
  return region.content.kind === "inlines";
}

export function isSourceRegion(region: EditableRegion): boolean {
  return region.content.kind === "source";
}

// Active handles ------------------------------------------------------------

export function resolveActiveBlockKey(
  documentIndex: DocumentIndex,
  point: EditorIndexPosition,
): string | null {
  const focusedRegion = resolveRegion(documentIndex, point.regionPath);
  const focusedBlock = focusedRegion
    ? resolveIndexedBlock(documentIndex, focusedRegion.blockPath)
    : null;

  if (!focusedRegion || !focusedBlock) {
    return null;
  }

  return focusedBlock.block.type === "table"
    ? `cell:${focusedRegion.path}`
    : `block:${focusedBlock.path}`;
}

function resolvePositionOrder(
  documentIndex: DocumentIndex,
  point: EditorIndexPosition,
  unknown: "before" | "throw",
) {
  const region = resolveRegion(documentIndex, point.regionPath);

  if (region) {
    return region.regionArrayIndex;
  }

  if (unknown === "before") {
    return -1;
  }

  throw new Error(`Unknown canvas region: ${point.regionPath}`);
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
