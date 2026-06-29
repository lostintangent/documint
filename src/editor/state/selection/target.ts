// Declarative selection targets and target resolution. Actions declare where
// the selection should land after a mutation. Two families, two lifetimes:
// coordinate targets (`target.root`/`target.blockPath`/`target.path`/
// `target.tableCell`) are positional intent, resolved against the rebuilt
// document after the commit; `target.block` references a block inside the
// action's own payload and is materialized into a path by dispatch *before*
// the edit applies, because object identity does not survive document
// construction. Actions should reference blocks they placed in their own
// payload and fall back to coordinates only for destinations outside it.

import { isBlockPath, rootBlockPath, type Block } from "@/document";
import {
  resolvePrimaryRegionForBlockPath,
  resolveRegion,
  resolveRootBlock,
  resolveRootPrimaryRegion,
  resolveTableCellRegionByTablePath,
} from "../index/query";
import type { DocumentIndex } from "../index/types";
import type { EditorSelection } from "./index";

type SelectionOffset = number | "end";

export type RegionPathSelectionTarget = {
  focusOffset?: SelectionOffset;
  kind: "region-path";
  offset: SelectionOffset;
  path: string;
};

export type SelectionTarget =
  | {
      kind: "block-primary-region";
      block: Block;
      offset: SelectionOffset;
    }
  | RegionPathSelectionTarget
  | {
      cellIndex: number;
      kind: "table-cell";
      offset: SelectionOffset;
      rootIndex: number;
      rowIndex: number;
    }
  | {
      kind: "root-primary-region";
      offset: SelectionOffset;
      rootIndex: number;
    }
  | {
      blockPath: string;
      kind: "block-path-primary-region";
      offset: SelectionOffset;
    };

// SelectionTarget is editor-action vocabulary: commands use it to declare
// where the selection should land after the reducer commits a mutation.
export const target = {
  // Select the primary editable region of a block included in this action's
  // replacement payload. Used by structural commands that build or move the
  // exact block that should receive the caret.
  block(block: Block, offset: SelectionOffset = 0): SelectionTarget {
    return {
      block,
      kind: "block-primary-region",
      offset,
    };
  },

  // Select an editable region by index path, optionally as a range. Used after
  // inline/text edits where the same region should be remapped through a block
  // rebuild.
  path(
    path: string,
    offset: SelectionOffset = 0,
    focusOffset: SelectionOffset = offset,
  ): RegionPathSelectionTarget {
    return {
      focusOffset,
      kind: "region-path",
      offset,
      path,
    };
  },

  // Select a table cell by row/column in a table root. Used by table editing
  // because cells are not blocks and row/column is the user's intent.
  tableCell(
    rootIndex: number,
    rowIndex: number,
    cellIndex: number,
    offset: SelectionOffset = 0,
  ): SelectionTarget {
    return {
      cellIndex,
      kind: "table-cell",
      offset,
      rootIndex,
      rowIndex,
    };
  },

  // Select the primary editable region of a root by post-edit index. Used when
  // the target root is outside the action payload or only known by shifted
  // coordinate.
  root(rootIndex: number, offset: SelectionOffset = 0): SelectionTarget {
    return {
      kind: "root-primary-region",
      offset,
      rootIndex,
    };
  },

  // Select the primary editable region for a block path after the commit.
  blockPath(blockPath: string, offset: SelectionOffset = 0): SelectionTarget {
    if (!isBlockPath(blockPath)) {
      throw new Error(`Invalid block path selection target: ${blockPath}`);
    }

    return {
      blockPath,
      kind: "block-path-primary-region",
      offset,
    };
  },
};

export function resolveSelectionTarget(
  documentIndex: DocumentIndex,
  selection: SelectionTarget | null,
): EditorSelection | null {
  if (!selection) {
    return null;
  }

  if (selection.kind === "block-primary-region") {
    // Block references are only meaningful against the action payload they
    // came from; dispatch must materialize them before resolution. Reaching
    // this point means an action kind that doesn't support block targets
    // carried one — fail loudly instead of silently losing the caret.
    throw new Error("block-primary-region targets must be materialized by dispatch.");
  }

  if (selection.kind === "root-primary-region") {
    const region = resolveRootPrimaryRegion(documentIndex, selection.rootIndex);

    return region
      ? createCollapsedSelection(region.path, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  if (selection.kind === "block-path-primary-region") {
    const region = resolvePrimaryRegionForBlockPath(documentIndex, selection.blockPath);

    return region
      ? createCollapsedSelection(region.path, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  if (selection.kind === "table-cell") {
    const rootBlock = resolveRootBlock(documentIndex, selection.rootIndex);

    if (!rootBlock || rootBlock.type !== "table") {
      return null;
    }

    const region = resolveTableCellRegionByTablePath(
      documentIndex,
      rootBlockPath(selection.rootIndex),
      selection.rowIndex,
      selection.cellIndex,
    );

    return region
      ? createCollapsedSelection(region.path, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  const region = resolveRegion(documentIndex, selection.path);

  if (!region) {
    return null;
  }

  const anchorOffset = resolveRegionOffset(region.text, selection.offset);
  const focusOffset = resolveRegionOffset(region.text, selection.focusOffset ?? selection.offset);
  return {
    anchor: {
      regionPath: region.path,
      offset: anchorOffset,
    },
    focus: {
      regionPath: region.path,
      offset: focusOffset,
    },
  };
}

function createCollapsedSelection(regionPath: string, offset: number): EditorSelection {
  const point = { offset, regionPath };

  return {
    anchor: point,
    focus: point,
  };
}

function resolveRegionOffset(text: string, offset: SelectionOffset) {
  return offset === "end" ? text.length : Math.max(0, Math.min(offset, text.length));
}
