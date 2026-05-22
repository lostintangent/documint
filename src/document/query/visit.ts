// Typed semantic tree walkers and walker-based queries shared across
// document, comments, editor, and tests.
//
// The traversal engine here is observe-only (`visitDocument`,
// `visitBlockTree`, `findBlockById`). For walk-and-rebuild use the `mapBlockTree`
// primitive below. Both engines speak the canonical path vocabulary from
// `./paths`, so a node's path here is the same string used by `nodeId` and
// the editor's region index.

import { blockContainerSpec } from "../containers";
import { childContainerPath, indexedPath, tableCellPath, tableRowPath } from "../paths";
import type { Block, Document, Inline, TableBlock, TableCell, TableRow } from "../types";

export type VisitControl = "skip" | "stop" | void;

export type BlockVisitContext = {
  path: string;
};

export type InlineVisitContext = {
  block: Block | null;
  path: string;
};

export type TableCellVisitContext = {
  cellIndex: number;
  path: string;
  row: TableRow;
  rowIndex: number;
  table: TableBlock;
};

export type InlineContainerVisitContext = {
  block: Block;
  container: Block | TableCell;
  kind: "block" | "tableCell";
  path: string;
};

// `enterPlainText` offsets are in **inline text-coordinate space**: a flat
// character stream over an `Inline` array where every node contributes a
// fixed number of characters. This is the document's own coordinate convention,
// and is distinct from the textual projection produced by
// `extractPlainTextFromInlineNodes` (which uses per-kind text like `@name`
// for mentions and `alt` for images). Per-kind contribution:
//
//   lineBreak | image | mention -> 1 char each (atomic stops)
//   code | text                  -> their `length`
//   raw                          -> `source.length`
//   link                         -> recursive sum of children
//
// The editor's selection-offset space is the same space — the editor adopts
// these offsets directly for caret math, hit testing, and region addressing
// — but the document defines the space; the editor is one consumer.
//
// The callback fires only for unmarked text runs (`marks.length === 0`); marked
// text is skipped because the decoration consumers that use this callback
// don't apply syntax highlighting to formatted text.
export type PlainTextVisitContext = InlineContainerVisitContext & {
  endOffset: number;
  startOffset: number;
};

export type DocumentVisitor = {
  enterBlock?: (block: Block, context: BlockVisitContext) => VisitControl;
  enterInlineContainer?: (
    nodes: readonly Inline[],
    context: InlineContainerVisitContext,
  ) => VisitControl;
  enterPlainText?: (text: string, context: PlainTextVisitContext) => VisitControl;
  enterInline?: (node: Inline, context: InlineVisitContext) => VisitControl;
  enterTableCell?: (cell: TableCell, context: TableCellVisitContext) => VisitControl;
};

type TraversalState = {
  stopped: boolean;
};

type BlockTraversalOptions = {
  pathPrefix: string;
  startIndex: number;
};

type InlineTraversalOptions = {
  block: Block | null;
  pathPrefix: string;
};

export function visitDocument(document: Document, visitor: DocumentVisitor): void {
  visitBlocks(document.blocks, visitor, createTraversalState(), {
    pathPrefix: "root",
    startIndex: 0,
  });
}

export function visitBlockTree(
  blocks: Block[],
  visitor: DocumentVisitor,
  options: { pathPrefix?: string; startIndex?: number } = {},
): void {
  visitBlocks(blocks, visitor, createTraversalState(), {
    pathPrefix: options.pathPrefix ?? "root",
    startIndex: options.startIndex ?? 0,
  });
}

export function findBlockById(blocks: Block[], blockId: string): Block | null {
  let match: Block | null = null;

  visitBlockTree(blocks, {
    enterBlock(block) {
      if (block.id === blockId) {
        match = block;
        return "stop";
      }
    },
  });

  return match;
}

export function findBlockChildIndicesById(rootBlock: Block, blockId: string): number[] | null {
  if (rootBlock.id === blockId) {
    return [];
  }

  const containerSpec = blockContainerSpec(rootBlock);
  const children = containerSpec?.read(rootBlock);

  if (!children) {
    return null;
  }

  for (const [index, child] of children.entries()) {
    const childIndices = findBlockChildIndicesById(child, blockId);

    if (childIndices) {
      return [index, ...childIndices];
    }
  }

  return null;
}

export function findBlockByChildIndices(
  rootBlock: Block | null,
  childIndices: readonly number[],
): Block | null {
  let current = rootBlock;

  for (const childIndex of childIndices) {
    if (!current) {
      return null;
    }

    const containerSpec = blockContainerSpec(current);
    const children = containerSpec?.read(current);

    if (!children) {
      return null;
    }

    current = children[childIndex] ?? null;
  }

  return current;
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

    const path = indexedPath(options.pathPrefix, options.startIndex + index);
    const enterResult = visitor.enterBlock?.(block, { path });

    if (stopTraversal(enterResult, state)) {
      return;
    }

    if (enterResult === "skip") {
      continue;
    }

    const containerSpec = blockContainerSpec(block);

    if (containerSpec) {
      visitBlocks(containerSpec.read(block), visitor, state, {
        pathPrefix: childContainerPath(path),
        startIndex: 0,
      });
      continue;
    }

    switch (block.type) {
      case "heading":
      case "paragraph":
        visitInlineContainer(block.children, visitor, state, {
          block,
          container: block,
          kind: "block",
          path: childContainerPath(path),
        });
        break;
      case "table":
        visitTableCells(block, visitor, state, path);
        break;
      // Leaf blocks (code, directive, divider, raw) have no children to walk.
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

    const path = indexedPath(options.pathPrefix, index);
    const enterResult = visitor.enterInline?.(node, {
      block: options.block,
      path,
    });

    if (stopTraversal(enterResult, state)) {
      return;
    }

    if (enterResult === "skip") {
      continue;
    }

    if (node.type === "link") {
      visitInlines(node.children, visitor, state, {
        block: options.block,
        pathPrefix: childContainerPath(path),
      });
    }
  }
}

function createTraversalState(): TraversalState {
  return { stopped: false };
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

      visitInlineContainer(cell.children, visitor, state, {
        block: table,
        container: cell,
        kind: "tableCell",
        path,
      });
    }
  }
}

function visitInlineContainer(
  nodes: Inline[],
  visitor: DocumentVisitor,
  state: TraversalState,
  context: InlineContainerVisitContext,
) {
  const enterResult = visitor.enterInlineContainer?.(nodes, context);

  if (stopTraversal(enterResult, state) || enterResult === "skip") {
    return;
  }

  visitPlainText(nodes, visitor, state, context);

  if (state.stopped) {
    return;
  }

  visitInlines(nodes, visitor, state, {
    block: context.block,
    // Table cells nest their inlines under a `.children` segment; block
    // inline containers (paragraph, heading) already are the children path.
    pathPrefix: context.kind === "tableCell" ? childContainerPath(context.path) : context.path,
  });
}

function visitPlainText(
  nodes: Inline[],
  visitor: DocumentVisitor,
  state: TraversalState,
  context: InlineContainerVisitContext,
) {
  if (!visitor.enterPlainText) {
    return;
  }

  let offset = 0;

  for (const node of nodes) {
    if (state.stopped) {
      return;
    }

    if (node.type === "text") {
      const startOffset = offset;
      const endOffset = startOffset + node.text.length;

      if (
        node.marks.length === 0 &&
        stopTraversal(
          visitor.enterPlainText(node.text, { ...context, endOffset, startOffset }),
          state,
        )
      ) {
        return;
      }

      offset = endOffset;
      continue;
    }

    offset += measureInlineNodeText(node);
  }
}

// The projected character length of an `Inline` node in *inline text-coordinate
// space* — the document's flat-character-stream coordinate convention defined
// at `PlainTextVisitContext` above. This is the canonical length oracle: any
// consumer that walks the raw `Inline` tree and needs to know "how many
// characters does this node contribute to the flat stream?" reads the answer
// here instead of inventing a per-type length switch. The editor's index
// reuses this oracle directly for selection-offset math.
//
// Per-kind projection:
//   - `lineBreak`            → 1 (projects to `\n`)
//   - `image` / `mention`    → 1 (projects to a single object-replacement char)
//   - `text` / `code` / `raw`→ length of the node's own text/source
//   - `link`                 → recursive sum of children (links flatten)
//
// Cross-layer contract with the editor: the editor's index projects `image` /
// `mention` to `INLINE_OBJECT_REPLACEMENT_TEXT` (a single `￼`) and `lineBreak`
// to `\n`. The two implementations must agree that those project to one
// character each. If the editor's placeholder ever widens, the `image` /
// `mention` arms here have to widen with it.
export function measureInlineNodeText(node: Inline): number {
  switch (node.type) {
    case "lineBreak":
      return 1;
    case "image":
    case "mention":
      return 1;
    case "code":
      return node.code.length;
    case "raw":
      return node.source.length;
    case "text":
      return node.text.length;
    case "link":
      return node.children.reduce((sum, child) => sum + measureInlineNodeText(child), 0);
  }
}

// Each `Inline` paired with its `[start, end)` extent in inline text-coordinate
// space. Yielded by `iterateInlineNodeRanges`.
export type InlineNodeRange = {
  end: number;
  node: Inline;
  start: number;
};

// Walks `nodes` in inline text-coordinate space, yielding each node with its
// `[start, end)` extent. The cursor + `measureInlineNodeText` arithmetic that
// every range-scoped inline operation reimplements lives here once: consumers
// only express what to do with the overlapping portion of `[node.start,
// node.end)` against their own `[start, end)` query range.
//
// This is the substrate for splice, slice, mark toggle, code toggle, link
// lookup, and any future range-scoped operation over an inline tree.
export function* iterateInlineNodeRanges(nodes: readonly Inline[]): Iterable<InlineNodeRange> {
  let cursor = 0;
  for (const node of nodes) {
    const start = cursor;
    const end = start + measureInlineNodeText(node);
    cursor = end;
    yield { end, node, start };
  }
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
  // Recurse into the block's structural children (via the container registry)
  // and return the block with mapped children. For non-container blocks
  // (paragraph, heading, code, table, divider, raw, directive) returns the
  // block unchanged. Identity-preserving when nothing changed.
  recurse: () => Block;
  // Path string to the current block. Matches the convention used by `nodeId`
  // and the visit* family above.
  path: string;
};

export type BlockMapVisitor = (block: Block, context: BlockMapContext) => Block | Block[] | null;

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

// Rebuild a container with mapped children using the registry's
// `withChildren` (structural spread), which leaves the parent's `id` and
// `plainText` untouched. Both fields are derived from children, so they go
// stale when children change — but every consumer of `mapBlockTree` runs
// before a downstream `createDocument` / `spliceDocument` that re-normalizes
// the whole tree, so the staleness is invisible. Skipping the canonical
// `rebuild` matters: it's the difference between O(N) and O(N log N) on the
// parse and splice hot paths, where the redundant `plainText` recomputation
// in the rebuilders showed up as a measurable benchmark regression.
function recurseBlockChildren(block: Block, visit: BlockMapVisitor, childrenPath: string): Block {
  const spec = blockContainerSpec(block);

  if (!spec) {
    return block;
  }

  const children = spec.read(block);
  const next = mapBlockTree(children, visit, childrenPath, block);

  if (next === children) {
    return block;
  }

  return spec.withChildren(block, next);
}
