// Single source of truth for the structural-container family of blocks: which
// block types own a child block list, where that list lives on the node, and
// how to rebuild the container around a fresh child list.
//
// Before this module, the same dispatch was hand-written in `getBlockChildren`,
// `replaceBlockChildren`, `replaceBlockInTree`, `recurseBlockChildren`, and the
// container arms of `normalizeBlockNode`. Adding a new container kind required
// touching every site, and TypeScript's exhaustiveness check did not protect
// every dispatch (the `mapBlockTree` recursion had a silent `default: block`
// fall-through that turned new container kinds into leaves). The registry
// closes that leak — adding a container kind means one new entry below.
//
// Three operations per spec:
//   - `read(block)`               returns the existing child list (typed as
//     `Block[]` so callers don't have to discriminate). List items are blocks,
//     so a list's read returns its `items` widened to `Block[]`.
//   - `rebuild(block, children)`  returns a canonical copy with the new
//     children, including a recomputed `plainText`. Used when the caller
//     wants the canonical form.
//   - `withChildren(block, children)` returns a structural copy with the new
//     children, leaving the parent's derived fields (`id`, `plainText`)
//     stale. Used by tree walkers (`normalize`, `mapBlockTree`) that either
//     re-derive those fields immediately afterwards or run before a
//     downstream `createDocument` / `spliceDocument` that re-normalizes the
//     whole tree. Skipping the `plainText` recomputation is the difference
//     between O(N) and O(N log N) on the parse and splice hot paths.
//
// Non-container blocks (paragraph, heading, code, table, divider, raw,
// directive) have no spec — `containerSpec` returns `null`. Tables are
// intentionally excluded: their structural children live one level deeper
// (rows → cells → inlines), so the inline-container vocabulary handles them
// instead.

import { createBlockquoteBlock, rebuildListBlock, rebuildListItemBlock } from "./build";
import type { Block, ListItemBlock } from "./types";

type BlockContainerSpec = {
  read(block: Block): Block[];
  rebuild(block: Block, children: Block[]): Block;
  withChildren(block: Block, children: Block[]): Block;
};

const BLOCK_CONTAINER_SPECS: { [K in Block["type"]]?: BlockContainerSpec } = {
  blockquote: {
    read: (block) => (block.type === "blockquote" ? block.children : []),
    rebuild: (_block, children) => createBlockquoteBlock(children),
    withChildren: (block, children) =>
      block.type === "blockquote" ? { ...block, children } : block,
  },
  listItem: {
    read: (block) => (block.type === "listItem" ? block.children : []),
    rebuild: (block, children) => rebuildListItemBlock(block as ListItemBlock, children),
    withChildren: (block, children) =>
      block.type === "listItem" ? { ...block, children } : block,
  },
  list: {
    read: (block) => (block.type === "list" ? block.items : []),
    rebuild: (block, children) =>
      block.type === "list" ? rebuildListBlock(block, children as ListItemBlock[]) : block,
    withChildren: (block, children) =>
      block.type === "list" ? { ...block, items: children as ListItemBlock[] } : block,
  },
};

export function blockContainerSpec(block: Block): BlockContainerSpec | null {
  return BLOCK_CONTAINER_SPECS[block.type] ?? null;
}

// Polymorphic accessor: returns the container's child block list, or null for
// non-container blocks. Use when you need to walk or rewrite children without
// re-deriving the dispatch.
export function getBlockChildren(block: Block): Block[] | null {
  return blockContainerSpec(block)?.read(block) ?? null;
}

// Rebuild a container with a replacement child list and a fresh canonical
// `plainText`. Returns null when `block` is not a container or when the
// replacement is empty — empty structural containers carry no visible content
// and collapse out of the model.
export function replaceBlockChildren(block: Block, children: Block[]): Block | null {
  if (children.length === 0) {
    return null;
  }

  return blockContainerSpec(block)?.rebuild(block, children) ?? null;
}
