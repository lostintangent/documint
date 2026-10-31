// Typed semantic tree walkers and walker-based queries shared across
// document, comments, editor, and tests.
//
// The traversal engine here is observe-only (`visitDocument`,
// `visitBlockTree`). For walk-and-rebuild use the `mapBlockTree` primitive
// below. Both engines speak the canonical path vocabulary from `../model/paths`,
// so a node's path here is the same structural address used by anchors and the
// editor index.

import { getBlockChildren, rebuildBlockChildren } from "../model/containers";
import { childContainerPath, indexedPath, tableCellPath, tableRowPath } from "../model/paths";
import type { Block, Document, Inline, TableBlock, TableCell, TableRow } from "../model/types";

type VisitControl = "skip" | "stop" | void;

type PathVisitContext = {
  path: string;
};

type TableCellVisitContext = {
  cellIndex: number;
  path: string;
  row: TableRow;
  rowIndex: number;
  table: TableBlock;
};

type DocumentVisitor = {
  enterBlock?: (block: Block, context: PathVisitContext) => VisitControl;
  enterInlineContainer?: (nodes: readonly Inline[], context: PathVisitContext) => VisitControl;
  enterInline?: (node: Inline) => VisitControl;
  enterTableCell?: (cell: TableCell, context: TableCellVisitContext) => VisitControl;
};

type TraversalState = {
  stopped: boolean;
};

export function visitDocument(document: Document, visitor: DocumentVisitor): void {
  visitBlockTree(document.blocks, visitor);
}

export function visitBlockTree(
  blocks: Block[],
  visitor: DocumentVisitor,
  options: { startIndex?: number } = {},
): void {
  visitBlocks(blocks, visitor, { stopped: false }, "root", options.startIndex ?? 0);
}

// Locate `target` within `roots` by object identity and return its structural
// coordinates. This is for uncommitted payload trees where a reference is the
// only name a caller has for "the block I just built".
export function findBlockChildIndicesByReference(
  roots: readonly Block[],
  target: Block,
): { childIndices: number[]; rootOffset: number } | null {
  for (const [rootOffset, root] of roots.entries()) {
    const childIndices = findChildIndicesByReference(root, target);

    if (childIndices) {
      return { childIndices, rootOffset };
    }
  }

  return null;
}

function findChildIndicesByReference(block: Block, target: Block): number[] | null {
  if (block === target) {
    return [];
  }

  const children = getBlockChildren(block);

  if (!children) {
    return null;
  }

  for (const [index, child] of children.entries()) {
    const childIndices = findChildIndicesByReference(child, target);

    if (childIndices) {
      return [index, ...childIndices];
    }
  }

  return null;
}

function visitBlocks(
  blocks: Block[],
  visitor: DocumentVisitor,
  state: TraversalState,
  pathPrefix: string,
  startIndex: number,
) {
  for (const [index, block] of blocks.entries()) {
    if (state.stopped) {
      return;
    }

    const path = indexedPath(pathPrefix, startIndex + index);
    const enterResult = visitor.enterBlock?.(block, { path });

    if (stopTraversal(enterResult, state)) {
      return;
    }

    if (enterResult === "skip") {
      continue;
    }

    const children = getBlockChildren(block);

    if (children) {
      visitBlocks(children, visitor, state, childContainerPath(path), 0);
      continue;
    }

    switch (block.type) {
      case "heading":
      case "paragraph":
        visitInlineContainer(block.children, visitor, state, path);
        break;
      case "table":
        visitTableCells(block, visitor, state, path);
        break;
      // Leaf blocks (code, directive, divider, raw) have no children to walk.
    }
  }
}

function visitTableCells(
  table: TableBlock,
  visitor: DocumentVisitor,
  state: TraversalState,
  tablePath: string,
) {
  for (const [rowIndex, row] of table.rows.entries()) {
    for (const [cellIndex, cell] of row.cells.entries()) {
      if (state.stopped) {
        return;
      }

      const path = tableCellPath(tableRowPath(tablePath, rowIndex), cellIndex);
      const enterResult = visitor.enterTableCell?.(cell, {
        cellIndex,
        path,
        row,
        rowIndex,
        table,
      });

      if (stopTraversal(enterResult, state)) {
        return;
      }

      if (enterResult === "skip") {
        continue;
      }

      visitInlineContainer(cell.children, visitor, state, path);
    }
  }
}

// Inline nodes are only walked for visitors that observe them, so block- and
// cell-only visitors never pay for inline traversal.
function visitInlineContainer(
  nodes: Inline[],
  visitor: DocumentVisitor,
  state: TraversalState,
  path: string,
) {
  const enterResult = visitor.enterInlineContainer?.(nodes, { path });

  if (!stopTraversal(enterResult, state) && enterResult !== "skip" && visitor.enterInline) {
    visitInlines(nodes, visitor, state);
  }
}

function visitInlines(nodes: Inline[], visitor: DocumentVisitor, state: TraversalState) {
  for (const node of nodes) {
    if (state.stopped) {
      return;
    }

    const enterResult = visitor.enterInline?.(node);

    if (stopTraversal(enterResult, state)) {
      return;
    }

    if (enterResult !== "skip" && node.type === "link") {
      visitInlines(node.children, visitor, state);
    }
  }
}

// Maps an inline list in semantic order, recursing through link children and
// handing their mapped output to the link's visitor call. This is the producing
// complement to the observe-only inline visitor above: callers that need nested
// output (for example DOM/React rendering) should use this instead of walking
// link children themselves.
export function mapInlines<T>(
  nodes: readonly Inline[],
  visit: (node: Inline, children: T[] | null) => T | null,
): T[] {
  const result: T[] = [];

  for (const node of nodes) {
    const mapped = visit(node, node.type === "link" ? mapInlines(node.children, visit) : null);

    if (mapped !== null) {
      result.push(mapped);
    }
  }

  return result;
}

function stopTraversal(result: VisitControl, state: TraversalState): boolean {
  if (result !== "stop") {
    return false;
  }

  state.stopped = true;
  return true;
}

// --- Tree transforms (map) -------------------------------------------------
//
// Walk-and-rebuild primitive for transforming the document tree in place.
// Unlike the visit* family above, this PRODUCES a new tree rather than just
// observing one. The visit function decides whether to recurse into a node's
// structural children (via `context.recurse()`) and what the result at that
// position should be. This gives callers both bottom-up and top-down idioms:
//
//   - Bottom-up: call `recurse()` first, then transform the rebuilt block.
//     The boundary-collapse rebuild uses this shape to drop list items that
//     no longer lead with a paragraph or heading.
//   - Top-down with early termination: return a replacement without calling
//     `recurse()`. The boundary-collapse rebuild uses this for victim/absorber
//     substitution — the replaced subtree is never re-walked.
//
// Identity preservation: when no transformation occurs at any depth, the
// returned array is === to the input. Callers can rely on `result === blocks`
// as a "nothing changed" check.
//
// Tables are leaves from a block-tree perspective (their inline content lives
// under `rows[].cells[].children`). Inline transforms inside tables (or
// anywhere else) are caller-managed — the inline tree is shallow enough that
// dedicated walkers haven't earned their keep here.

type BlockMapContext = {
  // The structural parent of the current block, or `null` at the root. Useful
  // for transforms whose decision depends on what kind of container holds the
  // block (e.g. "remove this paragraph unless its parent is a listItem, in
  // which case the listItem owns the removal").
  parent: Block | null;
  // Recurse into the block's structural children (via the container registry)
  // and return the block with mapped children. For non-container blocks
  // (paragraph, heading, code, table, divider, raw, directive) returns the
  // block unchanged. Identity-preserving when nothing changed.
  recurse: () => Block;
  // Path string to the current block. Matches the convention used by anchors,
  // path lookup, and the visit* family above.
  path: string;
};

type BlockMapVisitor = (block: Block, context: BlockMapContext) => Block | Block[] | null;

// Transform a block array, returning a new array with each block replaced by
// the visitor's return value (`Block`, `Block[]`, or `null` to drop). Returns
// the input array unchanged (===) when no block was transformed at any depth.
//
// The trailing two parameters (`pathPrefix`, `parent`) are recursion
// bookkeeping — external callers always omit them. They're exposed as
// defaulted parameters rather than hidden behind a wrapper so this primitive
// stays a single function with no indirection.
export function mapBlockTree(
  blocks: Block[],
  visit: BlockMapVisitor,
  /** @internal recursion bookkeeping */ pathPrefix = "root",
  /** @internal recursion bookkeeping */ parent: Block | null = null,
): Block[] {
  let didChange = false;
  const result: Block[] = [];

  for (const [index, block] of blocks.entries()) {
    const path = indexedPath(pathPrefix, index);
    const visited = visit(block, {
      parent,
      path,
      recurse: () => recurseBlockChildren(block, visit, childContainerPath(path)),
    });

    if (visited === null) {
      didChange = true;
      continue;
    }

    if (Array.isArray(visited)) {
      didChange = true;
      result.push(...visited);
      continue;
    }

    if (visited !== block) {
      didChange = true;
    }
    result.push(visited);
  }

  return didChange ? result : blocks;
}

// Rebuild a changed container canonically. Only changed ancestors are rebuilt,
// preserving unaffected child references while keeping cached `plainText`
// correct without a later whole-document normalization pass.
function recurseBlockChildren(block: Block, visit: BlockMapVisitor, childrenPath: string): Block {
  const children = getBlockChildren(block);

  if (!children) {
    return block;
  }

  const next = mapBlockTree(children, visit, childrenPath, block);

  if (next === children) {
    return block;
  }

  return rebuildBlockChildren(block, next);
}
