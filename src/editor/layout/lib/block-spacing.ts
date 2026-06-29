// Owns semantic vertical gap policy between adjacent laid-out blocks. This
// module decides the space between blocks; each block kind still defines its
// own measured height elsewhere. Both exact layout (`measure/`) and
// large-document estimation call into this so the two paths stay in sync.

import type { Block, ListBlock, ListItemBlock } from "@/document";
import type { IndexedBlock } from "../../state";

// Heading extra gaps are multiples of the caller-provided standard block gap.
const headingExtraGapRatiosByDepth = [
  { leading: 1, trailing: 1.5 }, // h1
  { leading: 1, trailing: 1 }, // h2
  { leading: 1, trailing: 0.4 }, // h3
  { leading: 0.625, trailing: 0 }, // h4
  { leading: 0.625, trailing: 0 }, // h5
  { leading: 0.625, trailing: 0 }, // h6
] as const;
const sharedAncestorGapByType = {
  blockquote: 10,
  list: 6,
} satisfies Partial<Record<Block["type"], number>>;
const blockquoteSpacingAncestorTypes = new Set<Block["type"]>(["blockquote"]);
const listSpacingAncestorTypes = new Set<Block["type"]>(["list", "listItem"]);

// Vertical gap between two adjacent laid-out blocks (text, table, inert),
// keyed by their shared ancestry.
export function resolveBlockGap(
  indexedBlocks: Map<string, IndexedBlock>,
  currentBlockPath: string,
  nextBlockPath: string,
  blockGap: number,
) {
  const sharedAncestorGap = resolveSharedAncestorGap(indexedBlocks, currentBlockPath, nextBlockPath);
  if (sharedAncestorGap !== null) {
    return sharedAncestorGap;
  }

  const headingExtraGap =
    resolveHeadingExtraGap(indexedBlocks.get(currentBlockPath)?.block, "trailing", blockGap) +
    resolveHeadingExtraGap(indexedBlocks.get(nextBlockPath)?.block, "leading", blockGap);

  if (headingExtraGap > 0) {
    return blockGap + headingExtraGap;
  }

  return blockGap;
}

function resolveSharedAncestorGap(
  indexedBlocks: Map<string, IndexedBlock>,
  currentBlockPath: string,
  nextBlockPath: string,
) {
  if (
    findNearestSharedAncestor(
      indexedBlocks,
      currentBlockPath,
      nextBlockPath,
      blockquoteSpacingAncestorTypes,
    )
  ) {
    return sharedAncestorGapByType.blockquote;
  }

  const listAncestor = findNearestSharedAncestor<ListBlock | ListItemBlock>(
    indexedBlocks,
    currentBlockPath,
    nextBlockPath,
    listSpacingAncestorTypes,
  )?.block;
  if (listAncestor) {
    return listAncestor.compact ? sharedAncestorGapByType.list : null;
  }

  return null;
}

function resolveHeadingExtraGap(
  block: Block | undefined,
  side: "leading" | "trailing",
  blockGap: number,
) {
  if (block?.type !== "heading") {
    return 0;
  }

  return Math.round(blockGap * (headingExtraGapRatiosByDepth[block.depth - 1]?.[side] ?? 0));
}

function findNearestSharedAncestor<T extends Block>(
  indexedBlocks: Map<string, IndexedBlock>,
  leftBlockPath: string,
  rightBlockPath: string,
  types: ReadonlySet<Block["type"]>,
) {
  const rightAncestors = collectAncestorPaths(indexedBlocks, rightBlockPath, types);
  let current = indexedBlocks.get(leftBlockPath) ?? null;

  while (current) {
    if (types.has(current.block.type) && rightAncestors.has(current.path)) {
      return current as IndexedBlock & { block: T };
    }

    current = current.parentBlockPath ? (indexedBlocks.get(current.parentBlockPath) ?? null) : null;
  }

  return null;
}

function collectAncestorPaths(
  indexedBlocks: Map<string, IndexedBlock>,
  blockPath: string,
  types: ReadonlySet<Block["type"]>,
) {
  const ancestors = new Set<string>();
  let current = indexedBlocks.get(blockPath) ?? null;

  while (current) {
    if (types.has(current.block.type)) {
      ancestors.add(current.path);
    }

    current = current.parentBlockPath ? (indexedBlocks.get(current.parentBlockPath) ?? null) : null;
  }

  return ancestors;
}
