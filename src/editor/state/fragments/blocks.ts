// Shared structural fragment primitives.
//
// These helpers carve semantic `Block` trees by editor paths. Copy extraction
// and reducer range replacement both use them so they agree on what "the part
// of a block before/after this selection endpoint" means.

import {
  getBlockChildren,
  rebuildCodeBlock,
  rebuildRawBlock,
  rebuildTextBlock,
  replaceBlockChildren,
  type Block,
} from "@/document";
import type { IndexedBlock, IndexedInline } from "../index/types";
import { editIndexedInlines } from "../reducer/inlines";

export type LeafTrimTarget = {
  indexedBlock: IndexedBlock;
  inlines: readonly IndexedInline[] | null;
  offset: number;
  text: string;
};

// Returns the part of `block` from its start up to the target's offset,
// dropping siblings after the target at every level.
// Returns null if nothing remains.
export function trimBlockToPrefix(block: Block, target: LeafTrimTarget): Block | null {
  if (block.type === "table") {
    return null;
  }

  if (block === target.indexedBlock.block) {
    return trimLeafBlockToPrefix(block, target);
  }

  return trimContainerBlock(block, (children) => trimContainerChildrenToPrefix(children, target));
}

// Mirror of `trimBlockToPrefix` for the post-offset side.
export function trimBlockToSuffix(block: Block, target: LeafTrimTarget): Block | null {
  if (block.type === "table") {
    return null;
  }

  if (block === target.indexedBlock.block) {
    return trimLeafBlockToSuffix(block, target);
  }

  return trimContainerBlock(block, (children) => trimContainerChildrenToSuffix(children, target));
}

// Whether `block` directly is or transitively contains the leaf identified by
// `target.indexedBlock`. Shared by trimming and fragment path narrowing.
export function blockContainsTrimTarget(block: Block, target: LeafTrimTarget): boolean {
  if (block === target.indexedBlock.block) {
    return true;
  }

  const children = getBlockChildren(block);
  return children !== null && children.some((child) => blockContainsTrimTarget(child, target));
}

// A leaf trim that keeps all of its content returns the block itself, so
// pasting at a block's edge leaves the original node in the document.
function trimLeafBlockToPrefix(block: Block, { inlines, offset, text }: LeafTrimTarget) {
  if (offset === 0) {
    return null;
  }

  if (offset === text.length) {
    return block;
  }

  switch (block.type) {
    case "heading":
    case "paragraph": {
      return inlines
        ? rebuildTextBlock(block, editIndexedInlines(inlines, offset, text.length, ""))
        : null;
    }
    case "code":
      return rebuildCodeBlock(block, text.slice(0, offset));
    case "raw":
      return rebuildRawBlock(block, text.slice(0, offset));
    default:
      return null;
  }
}

function trimLeafBlockToSuffix(block: Block, { inlines, offset, text }: LeafTrimTarget) {
  if (offset === text.length) {
    return null;
  }

  if (offset === 0) {
    return block;
  }

  switch (block.type) {
    case "heading":
    case "paragraph": {
      return inlines ? rebuildTextBlock(block, editIndexedInlines(inlines, 0, offset, "")) : null;
    }
    case "code":
      return rebuildCodeBlock(block, text.slice(offset));
    case "raw":
      return rebuildRawBlock(block, text.slice(offset));
    default:
      return null;
  }
}

function trimContainerBlock(
  block: Block,
  trimChildren: (children: Block[]) => Block[],
): Block | null {
  const children = getBlockChildren(block);

  if (!children) {
    return null;
  }

  const trimmed = trimChildren(children);
  const keepsEveryChild =
    trimmed.length > 0 &&
    trimmed.length === children.length &&
    trimmed.every((child, index) => child === children[index]);

  return keepsEveryChild ? block : replaceBlockChildren(block, trimmed);
}

function trimContainerChildrenToPrefix(children: Block[], target: LeafTrimTarget): Block[] {
  const targetIndex = children.findIndex((child) => blockContainsTrimTarget(child, target));

  if (targetIndex === -1) {
    return [];
  }

  const preservedSiblings = children.slice(0, targetIndex);
  const trimmedTarget = trimBlockToPrefix(children[targetIndex]!, target);

  return trimmedTarget ? [...preservedSiblings, trimmedTarget] : preservedSiblings;
}

function trimContainerChildrenToSuffix(children: Block[], target: LeafTrimTarget): Block[] {
  const targetIndex = children.findIndex((child) => blockContainsTrimTarget(child, target));

  if (targetIndex === -1) {
    return [];
  }

  const preservedSiblings = children.slice(targetIndex + 1);
  const trimmedTarget = trimBlockToSuffix(children[targetIndex]!, target);

  return trimmedTarget ? [trimmedTarget, ...preservedSiblings] : preservedSiblings;
}
