// Declarative selection targets and target resolution. Actions produce these
// stable references, and the reducer materializes them after document edits.

import {
  resolveDescendantPrimaryRegion,
  resolveRegion,
  resolveRegionByPath,
  resolveRootBlock,
  resolveRootPrimaryRegion,
  resolveTableCellRegion,
} from "../index/query";
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

export function resolveSelectionTarget(
  documentIndex: DocumentIndex,
  selection: SelectionTarget | null,
): EditorSelection | null {
  if (!selection) {
    return null;
  }

  if (selection.kind === "root-primary-region") {
    const region = resolveRootPrimaryRegion(documentIndex, selection.rootIndex);

    return region
      ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  if (selection.kind === "descendant-primary-region") {
    const region = resolveDescendantPrimaryRegion(
      documentIndex,
      selection.rootIndex,
      selection.childIndices,
    );

    return region
      ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  if (selection.kind === "region") {
    const region = resolveRegion(documentIndex, selection.regionId);

    return region
      ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  if (selection.kind === "table-cell") {
    const rootBlock = resolveRootBlock(documentIndex, selection.rootIndex);

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
