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
// Three operations per typed spec:
//   - `read(block)`               returns the existing child list in its
//     concrete shape. Lists own `ListItemBlock[]`; blockquotes/list items own
//     ordinary `Block[]`.
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

import { createBlockquoteBlock, rebuildListBlock, rebuildListItemBlock } from "../build/builders";
import type { Block, BlockquoteBlock, ListBlock, ListItemBlock } from "./types";

type BlockContainerSpec = {
  read(block: Block): Block[];
  rebuild(block: Block, children: Block[]): Block;
  withChildren(block: Block, children: Block[]): Block;
};

type ContainerBlock = BlockquoteBlock | ListBlock | ListItemBlock;

type TypedBlockContainerSpec<TBlock extends ContainerBlock, TChild extends Block> = {
  read(block: TBlock): TChild[];
  rebuild(block: TBlock, children: TChild[]): TBlock;
  type: TBlock["type"];
  withChildren(block: TBlock, children: TChild[]): TBlock;
};

const BLOCK_CONTAINER_SPECS: { [K in Block["type"]]?: BlockContainerSpec } = {
  blockquote: defineBlockContainerSpec<BlockquoteBlock, Block>({
    type: "blockquote",
    read: (block) => block.children,
    rebuild: (_block, children) => createBlockquoteBlock(children),
    withChildren: (block, children) => ({ ...block, children }),
  }),
  listItem: defineBlockContainerSpec<ListItemBlock, Block>({
    type: "listItem",
    read: (block) => block.children,
    rebuild: rebuildListItemBlock,
    withChildren: (block, children) => ({ ...block, children }),
  }),
  list: defineBlockContainerSpec<ListBlock, ListItemBlock>({
    type: "list",
    read: (block) => block.items,
    rebuild: (block, children) => rebuildListBlock(block, children),
    withChildren: (block, children) => ({ ...block, items: children }),
  }),
};

function defineBlockContainerSpec<TBlock extends ContainerBlock, TChild extends Block>(
  spec: TypedBlockContainerSpec<TBlock, TChild>,
): BlockContainerSpec {
  return {
    read(block) {
      return block.type === spec.type ? spec.read(block as TBlock) : [];
    },
    rebuild(block, children) {
      return block.type === spec.type ? spec.rebuild(block as TBlock, children as TChild[]) : block;
    },
    withChildren(block, children) {
      return block.type === spec.type
        ? spec.withChildren(block as TBlock, children as TChild[])
        : block;
    },
  };
}

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
