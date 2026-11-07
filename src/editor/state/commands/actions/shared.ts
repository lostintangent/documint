import type { Block, ListBlock } from "@/document";

// Shared action-layer domain rules. Keep this file small: helpers belong here
// only after multiple action folders need the same semantic predicate.

// Markdown reads adjacent lists of the same kind as one list, whatever their numbers.
export function areCompatibleLists(left: ListBlock, right: ListBlock): boolean {
  return left.ordered === right.ordered;
}

export function isCompatibleListBlock(block: Block, list: ListBlock): block is ListBlock {
  return block.type === "list" && areCompatibleLists(block, list);
}
