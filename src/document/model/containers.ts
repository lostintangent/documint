// Structural-container access: read and rewrite the children of the blocks that
// own them. Block containers (blockquote, list, listItem) own a `Block[]` child
// list, read and rebuilt through `getBlockChildren` / `rebuildBlockChildren`.
// Tables are the cells-shaped container: their structural children are
// `TableCell` rows, not blocks, so they read through `getTableCellRows` and never
// leak into block recursion — `getBlockChildren` returns null for a table.
//
// Block classification (`blockContentKind`) lives with the `Block` union in
// `types.ts`; this module is only about reaching and rebuilding children.

import { createBlockquoteBlock, rebuildListBlock, rebuildListItemBlock } from "../build/builders";
import type { Block, ListItemBlock, TableCell } from "./types";

// Child block list for block containers; null for every other block, so
// block-tree walks never descend into a table's cells.
export function getBlockChildren(block: Block): Block[] | null {
  switch (block.type) {
    case "blockquote":
    case "listItem":
      return block.children;
    case "list":
      return block.items;
    default:
      return null;
  }
}

// Cell rows for the cells-shaped container (table); null for every other block.
// Cells are not blocks, so they get their own reader instead of widening
// `getBlockChildren`.
export function getTableCellRows(block: Block): readonly (readonly TableCell[])[] | null {
  return block.type === "table" ? block.rows.map((row) => row.cells) : null;
}

// Rebuild a block container around a replacement child list with a fresh
// canonical `plainText`. Total over blocks: non-containers return unchanged, and
// empty child lists still rebuild (callers that want empty containers to collapse
// use `replaceBlockChildren`).
export function rebuildBlockChildren(block: Block, children: Block[]): Block {
  switch (block.type) {
    case "blockquote":
      return createBlockquoteBlock(children);
    case "listItem":
      return rebuildListItemBlock(block, children);
    case "list":
      return rebuildListBlock(block, children as ListItemBlock[]);
    default:
      return block;
  }
}

// Rebuild a block container, collapsing empty results to null: an empty
// structural container carries no visible content and drops out of the model.
// Returns null for non-container blocks (`getBlockChildren` is null for them).
export function replaceBlockChildren(block: Block, children: Block[]): Block | null {
  if (children.length === 0 || getBlockChildren(block) === null) {
    return null;
  }

  return rebuildBlockChildren(block, children);
}
