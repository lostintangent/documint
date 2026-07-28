import type { ListBlock } from "@/document";

// Shared action-layer domain rules. Keep this file small: helpers belong here
// only after multiple action folders need the same semantic predicate.

export function areCompatibleLists(left: ListBlock, right: ListBlock): boolean {
  return left.ordered === right.ordered && left.start === right.start;
}
