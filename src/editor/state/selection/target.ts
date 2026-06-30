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
  resolveEditorTextAtPath,
  resolveBlockTextPathBoundary,
  resolveIndexedTableCellByTablePath,
} from "../index/query";
import type { DocumentIndex } from "../index/types";
import type { EditorSelection } from "./index";

type SelectionOffset = number | "end";

export type PathSelectionTarget = {
  focusOffset?: SelectionOffset;
  kind: "path";
  offset: SelectionOffset;
  path: string;
};

export type SelectionTarget =
  | {
      kind: "block";
      block: Block;
      offset: SelectionOffset;
    }
  | PathSelectionTarget
  | {
      cellIndex: number;
      kind: "table-cell";
      offset: SelectionOffset;
      rowIndex: number;
      tablePath: string;
    }
  | {
      kind: "root";
      offset: SelectionOffset;
      rootIndex: number;
    }
  | {
      blockPath: string;
      kind: "block-path";
      offset: SelectionOffset;
    };

// SelectionTarget is editor-action vocabulary: commands use it to declare
// where the selection should land after the reducer commits a mutation.
export const target = {
  // Select the first editable path of a block included in this action's
  // replacement payload. Used by structural commands that build or move the
  // exact block that should receive the caret.
  block(block: Block, offset: SelectionOffset = 0): SelectionTarget {
    return {
      block,
      kind: "block",
      offset,
    };
  },

  // Select an editor path, optionally as a range. Used after inline/text edits
  // where the same path should be remapped through a block rebuild.
  path(
    path: string,
    offset: SelectionOffset = 0,
    focusOffset: SelectionOffset = offset,
  ): PathSelectionTarget {
    return {
      focusOffset,
      kind: "path",
      offset,
      path,
    };
  },

  // Select a table cell by row/column in a table block. Used by table editing
  // because cells are not blocks and row/column is the user's intent.
  tableCell(
    tablePath: string,
    rowIndex: number,
    cellIndex: number,
    offset: SelectionOffset = 0,
  ): SelectionTarget {
    if (!isBlockPath(tablePath)) {
      throw new Error(`Invalid table path selection target: ${tablePath}`);
    }

    return {
      cellIndex,
      kind: "table-cell",
      offset,
      rowIndex,
      tablePath,
    };
  },

  // Select the first editable path of a root by post-edit index. Used when the
  // target root is outside the action payload or only known by shifted
  // coordinate.
  root(rootIndex: number, offset: SelectionOffset = 0): SelectionTarget {
    return {
      kind: "root",
      offset,
      rootIndex,
    };
  },

  // Select the first editable path for a block path after the commit.
  blockPath(blockPath: string, offset: SelectionOffset = 0): SelectionTarget {
    if (!isBlockPath(blockPath)) {
      throw new Error(`Invalid block path selection target: ${blockPath}`);
    }

    return {
      blockPath,
      kind: "block-path",
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

  if (selection.kind === "block") {
    // Block references are only meaningful against the action payload they
    // came from; dispatch must materialize them before resolution. Reaching
    // this point means an action kind that doesn't support block targets
    // carried one — fail loudly instead of silently losing the caret.
    throw new Error("block targets must be materialized by dispatch.");
  }

  if (selection.kind === "root") {
    const path = resolveBlockTextPathBoundary(
      documentIndex,
      rootBlockPath(selection.rootIndex),
      "start",
    );

    return path ? createCollapsedSelectionAtPath(documentIndex, path, selection.offset) : null;
  }

  if (selection.kind === "block-path") {
    const path = resolveBlockTextPathBoundary(
      documentIndex,
      selection.blockPath,
      "start",
    );

    return path ? createCollapsedSelectionAtPath(documentIndex, path, selection.offset) : null;
  }

  if (selection.kind === "table-cell") {
    const path = resolveIndexedTableCellByTablePath(
      documentIndex,
      selection.tablePath,
      selection.rowIndex,
      selection.cellIndex,
    )?.path;

    return path ? createCollapsedSelectionAtPath(documentIndex, path, selection.offset) : null;
  }

  return createSelectionAtPath(
    documentIndex,
    selection.path,
    selection.offset,
    selection.focusOffset ?? selection.offset,
  );
}

function createSelectionAtPath(
  documentIndex: DocumentIndex,
  path: string,
  anchor: SelectionOffset,
  focus: SelectionOffset,
): EditorSelection | null {
  const text = resolveEditorTextAtPath(documentIndex, path);

  if (text === null) {
    return null;
  }

  const anchorOffset = resolveEditorOffset(text, anchor);
  const focusOffset = resolveEditorOffset(text, focus);
  return {
    anchor: {
      path,
      offset: anchorOffset,
    },
    focus: {
      path,
      offset: focusOffset,
    },
  };
}

function createCollapsedSelectionAtPath(
  documentIndex: DocumentIndex,
  path: string,
  offset: SelectionOffset,
): EditorSelection | null {
  return createSelectionAtPath(documentIndex, path, offset, offset);
}

function resolveEditorOffset(text: string, offset: SelectionOffset) {
  return offset === "end" ? text.length : Math.max(0, Math.min(offset, text.length));
}
