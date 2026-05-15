// Declarative selection targets and target resolution. Actions produce these
// stable references, and the reducer materializes them after document edits.

import { findBlockById, getBlockChildren, type Block } from "@/document";
import { createTableCellRegionKey } from "../index/shared";
import type { DocumentIndex } from "../index/types";
import type { EditorSelection } from "./index";

export type RegionRangePathSelectionTarget = {
  endOffset: number;
  kind: "region-range-path";
  path: string;
  startOffset: number;
};

export type SelectionTarget =
  | {
      kind: "descendant-primary-region";
      childIndices: number[];
      offset: number | "end";
      rootIndex: number;
    }
  | {
      kind: "region";
      offset: number | "end";
      regionId: string;
    }
  | {
      blockId: string;
      kind: "block-primary-region";
      offset: number | "end";
    }
  | {
      kind: "region-path";
      offset: number | "end";
      path: string;
    }
  | RegionRangePathSelectionTarget
  | {
      kind: "root-primary-region";
      offset: number | "end";
      rootIndex: number;
    }
  | {
      cellIndex: number;
      kind: "table-cell";
      offset: number | "end";
      rootIndex: number;
      rowIndex: number;
    };

export function createDescendantPrimaryRegionTarget(
  rootIndex: number,
  childIndices: number[],
  offset: number | "end" = 0,
): SelectionTarget {
  return {
    childIndices,
    kind: "descendant-primary-region",
    offset,
    rootIndex,
  };
}

export function createRootPrimaryRegionTarget(
  rootIndex: number,
  offset: number | "end" = 0,
): SelectionTarget {
  return {
    kind: "root-primary-region",
    offset,
    rootIndex,
  };
}

export function createRegionTarget(regionId: string, offset: number | "end" = 0): SelectionTarget {
  return {
    kind: "region",
    offset,
    regionId,
  };
}

// Targets the primary region of a block by id, regardless of where that block
// currently sits in the tree. Useful when a caller knows the surviving block id
// after an edit but its path or region id may have shifted.
export function createBlockPrimaryRegionTarget(
  blockId: string,
  offset: number | "end" = 0,
): SelectionTarget {
  return {
    blockId,
    kind: "block-primary-region",
    offset,
  };
}

export function createTableCellTarget(
  rootIndex: number,
  rowIndex: number,
  cellIndex: number,
  offset: number | "end" = 0,
): SelectionTarget {
  return {
    cellIndex,
    kind: "table-cell",
    offset,
    rootIndex,
    rowIndex,
  };
}

export function resolveRegionByPath(documentIndex: DocumentIndex, path: string) {
  return documentIndex.regionPathIndex.get(path) ?? null;
}

export function resolveTableCellRegion(
  documentIndex: DocumentIndex,
  blockId: string,
  rowIndex: number,
  cellIndex: number,
) {
  const regionId = documentIndex.tableCellRegionIndex.get(
    createTableCellRegionKey(blockId, rowIndex, cellIndex),
  );

  return regionId ? (documentIndex.regionIndex.get(regionId) ?? null) : null;
}

export function resolveSelectionTarget(
  documentIndex: DocumentIndex,
  selection: SelectionTarget | null,
): EditorSelection | null {
  if (!selection) {
    return null;
  }

  if (selection.kind === "root-primary-region") {
    const block = documentIndex.document.blocks[selection.rootIndex];
    const region = block ? resolvePrimaryRegion(documentIndex, block) : null;

    return region
      ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  if (selection.kind === "descendant-primary-region") {
    const rootBlock = documentIndex.document.blocks[selection.rootIndex];
    const block = rootBlock ? resolveDescendantBlock(rootBlock, selection.childIndices) : null;
    const region = block ? resolvePrimaryRegion(documentIndex, block) : null;

    return region
      ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  if (selection.kind === "region") {
    const region = documentIndex.regionIndex.get(selection.regionId) ?? null;

    return region
      ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  if (selection.kind === "block-primary-region") {
    const block = findBlockById(documentIndex.document, selection.blockId);
    const region = block ? resolvePrimaryRegion(documentIndex, block) : null;

    return region
      ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  if (selection.kind === "table-cell") {
    const rootBlock = documentIndex.document.blocks[selection.rootIndex];

    if (!rootBlock || rootBlock.type !== "table") {
      return null;
    }

    const region = resolveTableCellRegion(
      documentIndex,
      rootBlock.id,
      selection.rowIndex,
      selection.cellIndex,
    );

    return region
      ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  const region = resolveRegionByPath(documentIndex, selection.path);

  if (!region) {
    return null;
  }

  if (selection.kind === "region-path") {
    return createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset));
  }

  return {
    anchor: {
      regionId: region.id,
      offset: Math.max(0, Math.min(selection.startOffset, region.text.length)),
    },
    focus: {
      regionId: region.id,
      offset: Math.max(0, Math.min(selection.endOffset, region.text.length)),
    },
  };
}

export function createCollapsedSelection(regionId: string, offset: number): EditorSelection {
  const point = { offset, regionId };

  return {
    anchor: point,
    focus: point,
  };
}

function resolveRegionOffset(text: string, offset: number | "end") {
  return offset === "end" ? text.length : Math.max(0, Math.min(offset, text.length));
}

function resolveDescendantBlock(rootBlock: Block, childIndices: number[]) {
  let current: Block | null = rootBlock;

  for (const childIndex of childIndices) {
    if (!current) {
      return null;
    }

    const children = getBlockChildren(current);

    if (!children) {
      return null;
    }

    current = children[childIndex] ?? null;
  }

  return current;
}

function resolvePrimaryRegion(
  documentIndex: DocumentIndex,
  block: Block,
): DocumentIndex["regions"][number] | null {
  const entry = documentIndex.blockIndex.get(block.id);

  if (!entry) {
    return null;
  }

  const regionId = entry.regionIds[0];

  if (regionId) {
    return documentIndex.regionIndex.get(regionId) ?? null;
  }

  const children = getBlockChildren(block);

  if (!children) {
    return null;
  }

  for (const child of children) {
    const region = resolvePrimaryRegion(documentIndex, child);

    if (region) {
      return region;
    }
  }

  return null;
}
