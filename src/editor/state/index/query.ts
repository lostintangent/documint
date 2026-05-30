// Core query algebra over `DocumentIndex`. Consumers above the index should
// compose these primitives instead of reaching into lookup maps, structural
// paths, or flow-order fields directly.

import {
  findBlockByChildIndices,
  parseBlockChildIndices,
  tableCellPath,
  tableRowPath,
  type Block,
} from "@/document";
import type { IndexedBlock, DocumentIndex, EditableRegion } from "./types";

export type EditorIndexPosition = {
  offset: number;
  regionId: string;
};

export function resolveRegion(documentIndex: DocumentIndex, regionId: string) {
  return documentIndex.regionIndex.get(regionId) ?? null;
}

export function resolveRegionByPath(documentIndex: DocumentIndex, path: string) {
  return documentIndex.regionPathIndex.get(path) ?? null;
}

export function resolveIndexedBlock(documentIndex: DocumentIndex, blockId: string) {
  return documentIndex.blockIndex.get(blockId) ?? null;
}

export function resolveBlock(documentIndex: DocumentIndex, blockId: string) {
  return resolveIndexedBlock(documentIndex, blockId)?.block ?? null;
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

export function resolveIndexedBlockForRegion(documentIndex: DocumentIndex, regionId: string) {
  const region = resolveRegion(documentIndex, regionId);

  return region ? resolveIndexedBlock(documentIndex, region.block.id) : null;
}

export function resolveParentIndexedBlock(
  documentIndex: DocumentIndex,
  indexedBlock: IndexedBlock,
) {
  return indexedBlock.parentBlockId
    ? resolveIndexedBlock(documentIndex, indexedBlock.parentBlockId)
    : null;
}

export function isRootIndexedBlock(indexedBlock: IndexedBlock) {
  return indexedBlock.parentBlockId === null;
}

export function resolveBlockPathForRegion(documentIndex: DocumentIndex, regionId: string) {
  return resolveIndexedBlockForRegion(documentIndex, regionId)?.path ?? null;
}

export function resolveRootPrimaryRegion(documentIndex: DocumentIndex, rootIndex: number) {
  const block = resolveRootBlock(documentIndex, rootIndex);

  return block ? resolvePrimaryRegion(documentIndex, block.id) : null;
}

export function resolveDescendantPrimaryRegion(
  documentIndex: DocumentIndex,
  rootIndex: number,
  childIndices: readonly number[],
) {
  const block = findBlockByChildIndices(resolveRootBlock(documentIndex, rootIndex), childIndices);

  return block ? resolvePrimaryRegion(documentIndex, block.id) : null;
}

export function resolvePrimaryRegion(
  documentIndex: DocumentIndex,
  blockId: string,
): EditableRegion | null {
  const indexedBlock = resolveIndexedBlock(documentIndex, blockId);

  if (!indexedBlock) {
    return null;
  }

  const regionId = indexedBlock.regionIds[0];

  if (regionId) {
    return resolveRegion(documentIndex, regionId);
  }

  for (
    let index = indexedBlock.blockArrayIndex + 1;
    index < documentIndex.blocks.length;
    index += 1
  ) {
    const descendant = documentIndex.blocks[index]!;

    if (descendant.rootIndex !== indexedBlock.rootIndex || descendant.depth <= indexedBlock.depth) {
      break;
    }

    const descendantRegionId = descendant.regionIds[0];

    if (descendantRegionId) {
      return resolveRegion(documentIndex, descendantRegionId);
    }
  }

  return null;
}

export function resolveTableCellRegion(
  documentIndex: DocumentIndex,
  tableBlockId: string,
  rowIndex: number,
  cellIndex: number,
) {
  const indexedTable = resolveIndexedBlock(documentIndex, tableBlockId);

  if (!indexedTable || indexedTable.block.type !== "table") {
    return null;
  }

  return resolveRegionByPath(
    documentIndex,
    tableCellPath(tableRowPath(indexedTable.path, rowIndex), cellIndex),
  );
}

export function findAncestorIndexedBlock(
  documentIndex: DocumentIndex,
  blockId: string | null,
  type: Block["type"],
) {
  let current = blockId ? resolveIndexedBlock(documentIndex, blockId) : null;

  while (current) {
    if (current.block.type === type) {
      return current;
    }

    current = current.parentBlockId
      ? resolveIndexedBlock(documentIndex, current.parentBlockId)
      : null;
  }

  return null;
}

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

export function previousRegionInFlow(documentIndex: DocumentIndex, regionId: string) {
  const region = resolveRegion(documentIndex, regionId);

  if (!region || region.documentOrder === 0) {
    return null;
  }

  return documentIndex.regions[region.documentOrder - 1] ?? null;
}

export function nextRegionInFlow(documentIndex: DocumentIndex, regionId: string) {
  const region = resolveRegion(documentIndex, regionId);

  if (!region) {
    return null;
  }

  return documentIndex.regions[region.documentOrder + 1] ?? null;
}

export function previousBlockInFlow(documentIndex: DocumentIndex, blockId: string) {
  return findAdjacentBlockInFlow(documentIndex, blockId, -1);
}

export function nextBlockInFlow(documentIndex: DocumentIndex, blockId: string) {
  return findAdjacentBlockInFlow(documentIndex, blockId, 1);
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
  const range = documentIndex.roots[rootIndex]?.regionRange;

  if (!range) {
    return null;
  }

  return direction < 0
    ? (documentIndex.regions[range.start - 1] ?? null)
    : (documentIndex.regions[range.end] ?? null);
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

export function resolveActiveBlockKey(
  documentIndex: DocumentIndex,
  point: EditorIndexPosition,
): string | null {
  const focusedRegion = resolveRegion(documentIndex, point.regionId);
  const focusedBlock = focusedRegion
    ? resolveIndexedBlock(documentIndex, focusedRegion.block.id)
    : null;

  if (!focusedRegion || !focusedBlock?.path) {
    return null;
  }

  return focusedBlock.block.type === "table"
    ? `cell:${focusedRegion.path}`
    : `block:${focusedBlock.path}`;
}

export function resolveBlockChildIndices(indexedBlock: { path: string }) {
  return parseBlockChildIndices(indexedBlock.path);
}

export function resolveTableCellPosition(region: EditableRegion) {
  return region.tableCellPosition;
}

const EMPTY_THREAD_INDICES: readonly number[] = [];
const EMPTY_REGIONS: readonly EditableRegion[] = [];

export function resolveCommentThreadIndicesForRegion(
  documentIndex: DocumentIndex,
  region: EditableRegion,
): readonly number[] {
  return documentIndex.commentContainerIndex.get(region.semanticRegionId) ?? EMPTY_THREAD_INDICES;
}

export function createSemanticRegionIndex(documentIndex: DocumentIndex) {
  return new Map(documentIndex.regions.map((region) => [region.semanticRegionId, region]));
}

function resolvePositionOrder(
  documentIndex: DocumentIndex,
  point: EditorIndexPosition,
  unknown: "before" | "throw",
) {
  const region = resolveRegion(documentIndex, point.regionId);

  if (region) {
    return region.documentOrder;
  }

  if (unknown === "before") {
    return -1;
  }

  throw new Error(`Unknown canvas region: ${point.regionId}`);
}

function findAdjacentBlockInFlow(
  documentIndex: DocumentIndex,
  fromBlockId: string,
  direction: -1 | 1,
) {
  const startBlock = resolveIndexedBlock(documentIndex, fromBlockId);

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
