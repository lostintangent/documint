// Typed semantic tree walkers and walker-based queries shared across
// document, comments, editor, and tests.
import type {
  Block,
  Document,
  Inline,
  ListItemBlock,
  TableBlock,
  TableCell,
  TableRow,
} from "./types";

export type VisitControl = "skip" | "stop" | void;

export type BlockVisitContext = {
  blockAncestors: readonly Block[];
  depth: number;
  parentBlock: Block | null;
  path: string;
};

export type InlineVisitContext = {
  block: Block | null;
  blockAncestors: readonly Block[];
  inlineAncestors: readonly Inline[];
  parentInline: Inline | null;
  path: string;
};

export type TableCellVisitContext = {
  blockAncestors: readonly Block[];
  cellIndex: number;
  path: string;
  row: TableRow;
  rowIndex: number;
  table: TableBlock;
};

export type DocumentVisitor = {
  enterBlock?: (block: Block, context: BlockVisitContext) => VisitControl;
  leaveBlock?: (block: Block, context: BlockVisitContext) => VisitControl;
  enterInline?: (node: Inline, context: InlineVisitContext) => VisitControl;
  leaveInline?: (node: Inline, context: InlineVisitContext) => VisitControl;
  enterTableCell?: (cell: TableCell, context: TableCellVisitContext) => VisitControl;
  leaveTableCell?: (cell: TableCell, context: TableCellVisitContext) => VisitControl;
};

type TraversalState = {
  stopped: boolean;
};

type BlockTraversalOptions = {
  blockAncestors: readonly Block[];
  depth: number;
  parentBlock: Block | null;
  pathPrefix: string;
};

type InlineTraversalOptions = {
  block: Block | null;
  blockAncestors: readonly Block[];
  inlineAncestors: readonly Inline[];
  parentInline: Inline | null;
  pathPrefix: string;
};

export function visitDocument(document: Document, visitor: DocumentVisitor) {
  visitBlocks(document.blocks, visitor, createTraversalState(), createRootBlockTraversalOptions());
}

export function visitBlockTree(blocks: Block[], visitor: DocumentVisitor) {
  visitBlocks(blocks, visitor, createTraversalState(), createRootBlockTraversalOptions());
}

export function visitInlineTree(nodes: Inline[], visitor: DocumentVisitor) {
  visitInlines(nodes, visitor, createTraversalState(), {
    block: null,
    blockAncestors: [],
    inlineAncestors: [],
    parentInline: null,
    pathPrefix: "root",
  });
}

export function findBlockById(subject: Document | Block[], blockId: string): Block | null {
  let match: Block | null = null;
  const visitor: DocumentVisitor = {
    enterBlock(block) {
      if (block.id === blockId) {
        match = block;
        return "stop";
      }
    },
  };

  if (Array.isArray(subject)) {
    visitBlockTree(subject, visitor);
  } else {
    visitDocument(subject, visitor);
  }

  return match;
}

function visitBlocks(
  blocks: Block[],
  visitor: DocumentVisitor,
  state: TraversalState,
  options: BlockTraversalOptions,
) {
  for (const [index, block] of blocks.entries()) {
    if (state.stopped) {
      return;
    }

    const path = `${options.pathPrefix}.${index}`;
    const context: BlockVisitContext = {
      blockAncestors: options.blockAncestors,
      depth: options.depth,
      parentBlock: options.parentBlock,
      path,
    };
    const enterResult = visitor.enterBlock?.(block, context);

    if (stopTraversal(enterResult, state)) {
      return;
    }

    if (enterResult !== "skip") {
      switch (block.type) {
        case "list":
          visitChildBlocks(block.items, block, visitor, state, options, path);
          break;
        case "blockquote":
        case "listItem":
          visitChildBlocks(block.children, block, visitor, state, options, path);
          break;
        case "heading":
        case "paragraph":
          visitInlines(block.children, visitor, state, {
            block,
            blockAncestors: [...options.blockAncestors, block],
            inlineAncestors: [],
            parentInline: null,
            pathPrefix: `${path}.children`,
          });
          break;
        case "table":
          visitTableCells(block, visitor, state, {
            blockAncestors: [...options.blockAncestors, block],
            pathPrefix: path,
          });
          break;
        case "code":
        case "directive":
        case "divider":
        case "raw":
          break;
      }
    }

    if (state.stopped) {
      return;
    }

    if (stopTraversal(visitor.leaveBlock?.(block, context), state)) {
      return;
    }
  }
}

function visitInlines(
  nodes: Inline[],
  visitor: DocumentVisitor,
  state: TraversalState,
  options: InlineTraversalOptions,
) {
  for (const [index, node] of nodes.entries()) {
    if (state.stopped) {
      return;
    }

    const path = `${options.pathPrefix}.${index}`;
    const context: InlineVisitContext = {
      block: options.block,
      blockAncestors: options.blockAncestors,
      inlineAncestors: options.inlineAncestors,
      parentInline: options.parentInline,
      path,
    };
    const enterResult = visitor.enterInline?.(node, context);

    if (stopTraversal(enterResult, state)) {
      return;
    }

    if (enterResult !== "skip") {
      if (node.type === "link") {
        visitChildInlines(node.children, node, visitor, state, options, path);
      }
    }

    if (state.stopped) {
      return;
    }

    if (stopTraversal(visitor.leaveInline?.(node, context), state)) {
      return;
    }
  }
}

function createTraversalState(): TraversalState {
  return {
    stopped: false,
  };
}

function createRootBlockTraversalOptions(): BlockTraversalOptions {
  return {
    blockAncestors: [],
    depth: 0,
    parentBlock: null,
    pathPrefix: "root",
  };
}

function visitChildBlocks(
  blocks: Block[],
  parentBlock: Block,
  visitor: DocumentVisitor,
  state: TraversalState,
  options: BlockTraversalOptions,
  path: string,
) {
  visitBlocks(blocks, visitor, state, {
    blockAncestors: [...options.blockAncestors, parentBlock],
    depth: options.depth + 1,
    parentBlock,
    pathPrefix: `${path}.children`,
  });
}

function visitChildInlines(
  nodes: Inline[],
  parentInline: Inline,
  visitor: DocumentVisitor,
  state: TraversalState,
  options: InlineTraversalOptions,
  path: string,
) {
  visitInlines(nodes, visitor, state, {
    block: options.block,
    blockAncestors: options.blockAncestors,
    inlineAncestors: [...options.inlineAncestors, parentInline],
    parentInline,
    pathPrefix: `${path}.children`,
  });
}

function visitTableCells(
  table: TableBlock,
  visitor: DocumentVisitor,
  state: TraversalState,
  options: {
    blockAncestors: readonly Block[];
    pathPrefix: string;
  },
) {
  for (const [rowIndex, row] of table.rows.entries()) {
    for (const [cellIndex, cell] of row.cells.entries()) {
      if (state.stopped) {
        return;
      }

      const path = `${options.pathPrefix}.rows.${rowIndex}.cells.${cellIndex}`;
      const context: TableCellVisitContext = {
        blockAncestors: options.blockAncestors,
        cellIndex,
        path,
        row,
        rowIndex,
        table,
      };
      const enterResult = visitor.enterTableCell?.(cell, context);

      if (stopTraversal(enterResult, state)) {
        return;
      }

      if (enterResult !== "skip") {
        visitInlines(cell.children, visitor, state, {
          block: table,
          blockAncestors: options.blockAncestors,
          inlineAncestors: [],
          parentInline: null,
          pathPrefix: `${path}.children`,
        });
      }

      if (state.stopped) {
        return;
      }

      if (stopTraversal(visitor.leaveTableCell?.(cell, context), state)) {
        return;
      }
    }
  }
}

function stopTraversal(result: VisitControl, state: TraversalState) {
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
//     `trimTrailingWhitespace` uses this shape for blockquote/listItem/list.
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

export type BlockMapContext = {
  // The structural parent of the current block, or `null` at the root. Useful
  // for transforms whose decision depends on what kind of container holds the
  // block (e.g. "remove this paragraph unless its parent is a listItem, in
  // which case the listItem owns the removal").
  parent: Block | null;
  // Recurse into the block's structural children (`blockquote.children`,
  // `listItem.children`, `list.items`) and return the block with mapped
  // children. For non-container blocks (paragraph, heading, code, table,
  // divider, raw, directive) returns the block unchanged. Identity-preserving
  // when nothing changed.
  recurse: () => Block;
  // Path string to the current block, formatted as `${prefix}.${index}` and
  // extended with `.children.${index}` at each level. Matches the convention
  // used by `nodeId` and the visit* family above.
  path: string;
};

export type BlockMapVisitor = (
  block: Block,
  context: BlockMapContext,
) => Block | Block[] | null;

// Transform a block array, returning a new array with each block replaced by
// the visitor's return value (`Block`, `Block[]`, or `null` to drop). Returns
// the input array unchanged (===) when no block was transformed at any depth.
export function mapBlockTree(
  blocks: Block[],
  visit: BlockMapVisitor,
  pathPrefix = "root",
  parent: Block | null = null,
): Block[] {
  let didChange = false;
  const result: Block[] = [];

  for (const [index, block] of blocks.entries()) {
    const path = `${pathPrefix}.${index}`;
    const visited = visit(block, {
      parent,
      path,
      recurse: () => recurseBlockChildren(block, visit, `${path}.children`),
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

// Rebuild a container with mapped children using a structural spread, leaving
// the parent's `id` and `plainText` untouched. Both fields are derived from
// children, so they go stale when children change — but every consumer of
// `mapBlockTree` runs before a downstream `createDocument`/`spliceDocument`
// that re-normalizes the whole tree, so the staleness is invisible. Skipping
// the rebuild matters: it's the difference between O(N) and O(N log N) on the
// parse and splice hot paths, where the redundant `plainText` recomputation
// in the rebuilders showed up as a measurable benchmark regression.
function recurseBlockChildren(
  block: Block,
  visit: BlockMapVisitor,
  childrenPath: string,
): Block {
  switch (block.type) {
    case "blockquote":
    case "listItem": {
      const next = mapBlockTree(block.children, visit, childrenPath, block);
      return next === block.children ? block : { ...block, children: next };
    }
    case "list": {
      const next = mapBlockTree(block.items, visit, childrenPath, block) as ListItemBlock[];
      return next === block.items ? block : { ...block, items: next };
    }
    default:
      return block;
  }
}
