// Root construction and positioning: turns one top-level document `Block` into
// an `IndexedRoot` slice, then places those slices in block-array coordinate
// space.

import {
  blockContentKind,
  childBlockPath,
  getBlockChildren,
  getTableCellRows,
  rootBlockPath,
  tableCellPath,
  tableRowPath,
  type Block,
  type CodeBlock,
  type HeadingBlock,
  type Inline,
  type ParagraphBlock,
  type RawBlock,
} from "@/document";
import { flattenInlineNodes, indexedInlineText } from "./inlines";
import type {
  IndexedBlock,
  IndexedInline,
  IndexedTableCell,
  IndexedListItem,
  IndexedRoot,
} from "./types";

type ListContext = {
  depth: number;
  index: number;
  ordered: boolean;
  start: number | null;
};

const EMPTY_URLS: ReadonlySet<string> = new Set();

export function createIndexedRoot(rootBlock: Block, rootIndex: number): IndexedRoot {
  const blocks: IndexedBlock[] = [];
  // Collected during the inline walk below, alongside the work already
  // happening in text projection.
  const imageUrls = new Set<string>();
  let resourceUrls: Set<string> | null = null;
  const listItems = new Map<string, IndexedListItem>();
  let pathsWithTextCount = 0;

  function visitBlock(
    block: Block,
    path: string,
    depth: number,
    parentBlockPath: string | null,
    listContext: ListContext | null = null,
  ) {
    const kind = blockContentKind(block);
    const blockArrayIndex = blocks.length;
    const baseBlock = {
      block,
      // Local per-root index here; re-stamped to global document order when
      // the root is positioned in `positionIndexedRoots` / `positionIndexedRoot`.
      blockArrayIndex,
      blockRangeEnd: blockArrayIndex + 1,
      depth,
      parentBlockPath,
      path,
      rootIndex,
    };

    appendIndexedListItem(block, path, listContext);

    // The document owns the classification (`kind`); the index only projects the
    // payload it implies. The leaf casts are sound under the kind switch:
    // `inlines` is paragraph/heading, `source` is code/raw.
    switch (kind) {
      case "blocks":
      case "void":
        {
          const indexedBlock: IndexedBlock = { ...baseBlock, kind };
          blocks.push(indexedBlock);

          for (const [index, child] of (getBlockChildren(block) ?? []).entries()) {
            visitBlock(
              child,
              childBlockPath(path, index),
              depth + 1,
              path,
              resolveChildListContext(block, index, listContext),
            );
          }
          indexedBlock.blockRangeEnd = blocks.length;
        }
        break;
      case "inlines":
        {
          const { inlines, text } = recordInlineProjection(
            (block as ParagraphBlock | HeadingBlock).children,
          );
          blocks.push({ ...baseBlock, editorOrder: pathsWithTextCount, inlines, kind, text });
          pathsWithTextCount += 1;
        }
        break;
      case "source":
        {
          blocks.push({
            ...baseBlock,
            editorOrder: pathsWithTextCount,
            kind,
            text: (block as CodeBlock | RawBlock).source,
          });
          pathsWithTextCount += 1;
        }
        break;
      case "cells":
        {
          const tableCellRows = (getTableCellRows(block) ?? []).map((row, rowIndex) =>
            row.map((cell, cellIndex) => {
              const rowPath = tableRowPath(path, rowIndex);
              const cellPath = tableCellPath(rowPath, cellIndex);
              const { inlines, text } = recordInlineProjection(cell.children);
              const indexedCell: IndexedTableCell = {
                cell,
                cellIndex,
                editorOrder: pathsWithTextCount,
                inlines,
                path: cellPath,
                rowIndex,
                tablePath: path,
                text,
              };
              pathsWithTextCount += 1;
              return indexedCell;
            }),
          );
          blocks.push({ ...baseBlock, kind, tableCellRows });
        }
        break;
    }
  }

  function recordInlineProjection(children: readonly Inline[]) {
    const projection = projectInlines(children);
    for (const inline of projection.inlines) {
      if (inline.node.type === "image") imageUrls.add(inline.node.url);
      if (inline.node.type === "resource") {
        resourceUrls ??= new Set();
        resourceUrls.add(inline.node.url);
      }
    }
    return projection;
  }

  function appendIndexedListItem(block: Block, path: string, context: ListContext | null) {
    if (block.type !== "listItem") {
      return;
    }

    if (typeof block.checked === "boolean") {
      listItems.set(path, {
        checked: block.checked,
        depth: context?.depth ?? 0,
        kind: "task",
      });
      return;
    }

    if (context?.ordered) {
      listItems.set(path, {
        depth: context.depth,
        kind: "ordered",
        ordinal: (context.start ?? 1) + context.index,
      });
      return;
    }

    listItems.set(path, {
      depth: context?.depth ?? 0,
      kind: "unordered",
    });
  }

  function resolveChildListContext(
    block: Block,
    childIndex: number,
    inherited: ListContext | null,
  ): ListContext | null {
    if (block.type === "list") {
      return {
        depth: inherited ? inherited.depth + 1 : 0,
        index: childIndex,
        ordered: block.ordered,
        start: block.start,
      };
    }

    return inherited;
  }

  visitBlock(rootBlock, rootBlockPath(rootIndex), 0, null);

  return {
    blocks,
    imageUrls,
    resourceUrls: resourceUrls ?? EMPTY_URLS,
    listItems,
    pathsWithTextCount,
  };
}

// Flattened inlines depend only on their document children, never on path or
// position, so one children array maps to one projection. Inserting or removing
// a root re-indexes every root after it under new paths. Reusing projections
// keeps their `inlines` identity, which downstream caches key on, and skips
// re-flattening unchanged content.
const inlineProjectionByChildren = new WeakMap<
  readonly Inline[],
  { inlines: IndexedInline[]; text: string }
>();

function projectInlines(children: readonly Inline[]) {
  let projection = inlineProjectionByChildren.get(children);

  if (!projection) {
    const inlines = flattenInlineNodes(children);
    projection = { inlines, text: inlines.map(indexedInlineText).join("") };
    inlineProjectionByChildren.set(children, projection);
  }

  return projection;
}

// Positions a list of roots in block-array and editor-text coordinate space.
// Root identity is reused when those coordinates are unchanged. Shifted roots
// receive new root records, while their nested block records are reused or
// shifted according to the coordinate space they carry.
export function positionIndexedRoots(roots: IndexedRoot[]) {
  let blockIndex = 0;
  let editorOrder = 0;

  return roots.map((root) => {
    const positionedRoot = positionIndexedRoot(root, blockIndex, editorOrder);
    blockIndex += root.blocks.length;
    editorOrder += root.pathsWithTextCount;
    return positionedRoot;
  });
}

function positionIndexedRoot(
  root: IndexedRoot,
  nextBlockStart: number,
  nextEditorOrderStart: number,
): IndexedRoot {
  const blockIndexDelta = nextBlockStart - root.blocks[0]!.blockArrayIndex;
  const editorOrderDelta =
    root.pathsWithTextCount === 0 ? 0 : nextEditorOrderStart - resolveFirstEditorOrder(root);

  if (blockIndexDelta === 0 && editorOrderDelta === 0) {
    return root;
  }

  return {
    ...root,
    blocks: root.blocks.map((block) => shiftEditorBlock(block, blockIndexDelta, editorOrderDelta)),
  };
}

function shiftEditorBlock(
  block: IndexedBlock,
  blockIndexDelta: number,
  editorOrderDelta: number,
): IndexedBlock {
  switch (block.kind) {
    case "blocks":
    case "void":
      return shiftIndexedBlockCoordinates(block, blockIndexDelta);
    case "inlines":
    case "source":
      return {
        ...shiftIndexedBlockCoordinates(block, blockIndexDelta),
        editorOrder: block.editorOrder + editorOrderDelta,
      };
    case "cells":
      return {
        ...shiftIndexedBlockCoordinates(block, blockIndexDelta),
        tableCellRows: shiftIndexedTableCellRows(block.tableCellRows, editorOrderDelta),
      };
  }
}

function shiftIndexedBlockCoordinates<T extends IndexedBlock>(
  block: T,
  blockIndexDelta: number,
): T {
  return {
    ...block,
    blockArrayIndex: block.blockArrayIndex + blockIndexDelta,
    blockRangeEnd: block.blockRangeEnd + blockIndexDelta,
  };
}

function resolveFirstEditorOrder(root: IndexedRoot): number {
  for (const indexedBlock of root.blocks) {
    if (indexedBlock.kind === "inlines" || indexedBlock.kind === "source") {
      return indexedBlock.editorOrder;
    }

    if (indexedBlock.kind === "cells") {
      for (const row of indexedBlock.tableCellRows) {
        const firstCell = row[0];
        if (firstCell) {
          return firstCell.editorOrder;
        }
      }
    }
  }

  return 0;
}

function shiftIndexedTableCellRows(
  rows: readonly (readonly IndexedTableCell[])[],
  editorOrderDelta: number,
) {
  if (editorOrderDelta === 0) {
    return rows;
  }

  return rows.map((row) =>
    row.map((cell) => ({
      ...cell,
      editorOrder: cell.editorOrder + editorOrderDelta,
    })),
  );
}
