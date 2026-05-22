// Owns vertical gap policy between adjacent laid-out blocks. Both exact layout
// (`measure/`) and large-document estimation call into this so the two paths
// stay in sync.

import type { Block } from "@/document";
import type { BlockEntry } from "../../state";

const h1HeadingRuleTrailingGap = 24;
const h2HeadingRuleOuterGap = 16;
const LIST_SIBLING_GAP = 6;
const BLOCKQUOTE_SIBLING_GAP = 10;
const SAME_BLOCK_GAP = 4;

// Vertical gap between two adjacent laid-out blocks (text, table, inert),
// keyed by their shared ancestry.
export function resolveBlockGap(
  runtimeBlocks: Map<string, BlockEntry>,
  blockMap: Map<string, Block>,
  currentBlockId: string,
  nextBlockId: string,
  fallbackGap: number,
) {
  if (shareAncestorType(runtimeBlocks, currentBlockId, nextBlockId, "list")) {
    return LIST_SIBLING_GAP;
  }

  if (shareAncestorType(runtimeBlocks, currentBlockId, nextBlockId, "blockquote")) {
    return BLOCKQUOTE_SIBLING_GAP;
  }

  if (currentBlockId === nextBlockId) {
    return SAME_BLOCK_GAP;
  }

  return (
    fallbackGap +
    resolveHeadingTrailingGap(blockMap.get(currentBlockId)) +
    resolveHeadingLeadingGap(blockMap.get(nextBlockId))
  );
}

function resolveHeadingTrailingGap(block: Block | undefined) {
  if (block?.type !== "heading") {
    return 0;
  }

  if (block.depth === 1) {
    return h1HeadingRuleTrailingGap;
  }

  return block.depth === 2 ? h2HeadingRuleOuterGap : 0;
}

function resolveHeadingLeadingGap(block: Block | undefined) {
  return block?.type === "heading" && block.depth === 2 ? h2HeadingRuleOuterGap : 0;
}

function shareAncestorType(
  runtimeBlocks: Map<string, BlockEntry>,
  leftBlockId: string,
  rightBlockId: string,
  type: Block["type"],
) {
  const leftAncestors = collectAncestorIds(runtimeBlocks, leftBlockId, type);
  const rightAncestors = collectAncestorIds(runtimeBlocks, rightBlockId, type);

  for (const ancestorId of leftAncestors) {
    if (rightAncestors.has(ancestorId)) {
      return true;
    }
  }

  return false;
}

function collectAncestorIds(
  runtimeBlocks: Map<string, BlockEntry>,
  blockId: string,
  type: Block["type"],
) {
  const ancestors = new Set<string>();
  let current = runtimeBlocks.get(blockId) ?? null;

  while (current) {
    if (current.block.type === type) {
      ancestors.add(current.block.id);
    }

    current = current.parentBlockId ? (runtimeBlocks.get(current.parentBlockId) ?? null) : null;
  }

  return ancestors;
}
