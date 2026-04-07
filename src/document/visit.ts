// Typed semantic tree walkers shared across document, comments, editor, and tests.
import type {
  Block,
  Document,
  Inline,
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
        case "blockquote":
        case "list":
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
        case "thematicBreak":
        case "unsupported":
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
