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
  text: string;
};

// Returns the part of `block` from its start up to `offset` within
// `target`, dropping siblings after the target at every level.
// Returns null if nothing remains.
export function trimBlockToPrefix(
  block: Block,
  target: LeafTrimTarget,
  offset: number,
): Block | null {
  if (block.type === "table") {
    return null;
  }

  if (block === target.indexedBlock.block) {
    return trimLeafBlockToPrefix(block, target, offset);
  }

  return trimContainerBlock(block, (children) =>
    trimContainerChildrenToPrefix(children, target, offset),
  );
}

// Mirror of `trimBlockToPrefix` for the post-offset side.
export function trimBlockToSuffix(
  block: Block,
  target: LeafTrimTarget,
  offset: number,
): Block | null {
  if (block.type === "table") {
    return null;
  }

  if (block === target.indexedBlock.block) {
    return trimLeafBlockToSuffix(block, target, offset);
  }

  return trimContainerBlock(block, (children) =>
    trimContainerChildrenToSuffix(children, target, offset),
  );
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

function trimLeafBlockToPrefix(block: Block, target: LeafTrimTarget, offset: number): Block | null {
  if (offset === 0) {
    return null;
  }

  switch (block.type) {
    case "heading":
    case "paragraph": {
      return target.inlines
        ? rebuildTextBlock(
            block,
            editIndexedInlines(target.inlines, offset, target.text.length, ""),
          )
        : null;
    }
    case "code":
      return rebuildCodeBlock(block, target.text.slice(0, offset));
    case "raw":
      return rebuildRawBlock(block, target.text.slice(0, offset));
    default:
      return null;
  }
}

function trimLeafBlockToSuffix(block: Block, target: LeafTrimTarget, offset: number): Block | null {
  if (offset === target.text.length) {
    return null;
  }

  switch (block.type) {
    case "heading":
    case "paragraph": {
      return target.inlines
        ? rebuildTextBlock(block, editIndexedInlines(target.inlines, 0, offset, ""))
        : null;
    }
    case "code":
      return rebuildCodeBlock(block, target.text.slice(offset));
    case "raw":
      return rebuildRawBlock(block, target.text.slice(offset));
    default:
      return null;
  }
}

function trimContainerBlock(
  block: Block,
  trimChildren: (children: Block[]) => Block[],
): Block | null {
  const children = getBlockChildren(block);
  return children ? replaceBlockChildren(block, trimChildren(children)) : null;
}

function trimContainerChildrenToPrefix(
  children: Block[],
  target: LeafTrimTarget,
  offset: number,
): Block[] {
  const targetIndex = children.findIndex((child) => blockContainsTrimTarget(child, target));

  if (targetIndex === -1) {
    return [];
  }

  const preservedSiblings = children.slice(0, targetIndex);
  const trimmedTarget = trimBlockToPrefix(children[targetIndex]!, target, offset);

  return trimmedTarget ? [...preservedSiblings, trimmedTarget] : preservedSiblings;
}

function trimContainerChildrenToSuffix(
  children: Block[],
  target: LeafTrimTarget,
  offset: number,
): Block[] {
  const targetIndex = children.findIndex((child) => blockContainsTrimTarget(child, target));

  if (targetIndex === -1) {
    return [];
  }

  const preservedSiblings = children.slice(targetIndex + 1);
  const trimmedTarget = trimBlockToSuffix(children[targetIndex]!, target, offset);

  return trimmedTarget ? [trimmedTarget, ...preservedSiblings] : preservedSiblings;
}
