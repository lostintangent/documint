// Shared structural fragment primitives.
//
// These helpers carve semantic `Block` trees by editor regions. Copy extraction
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
import type { EditableRegion } from "../index/types";
import { editRegionInlines } from "../reducer/inlines";

// Returns the part of `block` from its start up to `offset` within
// `targetRegion`, dropping siblings after the target at every level.
// Returns null if nothing remains.
export function trimBlockToPrefix(
  block: Block,
  targetRegion: EditableRegion,
  offset: number,
): Block | null {
  if (block.type === "table") {
    return null;
  }

  if (block.id === targetRegion.block.id) {
    return trimLeafBlockToPrefix(block, targetRegion, offset);
  }

  return trimContainerBlock(block, (children) =>
    trimContainerChildrenToPrefix(children, targetRegion, offset),
  );
}

// Mirror of `trimBlockToPrefix` for the post-offset side.
export function trimBlockToSuffix(
  block: Block,
  targetRegion: EditableRegion,
  offset: number,
): Block | null {
  if (block.type === "table") {
    return null;
  }

  if (block.id === targetRegion.block.id) {
    return trimLeafBlockToSuffix(block, targetRegion, offset);
  }

  return trimContainerBlock(block, (children) =>
    trimContainerChildrenToSuffix(children, targetRegion, offset),
  );
}

// Whether `block` directly is or transitively contains the leaf identified by
// `region.block.id`. Shared by trimming and fragment path narrowing.
export function blockContainsRegion(block: Block, region: EditableRegion): boolean {
  if (block.id === region.block.id) {
    return true;
  }

  const children = getBlockChildren(block);
  return children !== null && children.some((child) => blockContainsRegion(child, region));
}

function trimLeafBlockToPrefix(block: Block, region: EditableRegion, offset: number): Block | null {
  if (offset === 0) {
    return null;
  }

  switch (block.type) {
    case "heading":
    case "paragraph":
      return rebuildTextBlock(block, editRegionInlines(region, offset, region.text.length, ""));
    case "code":
      return rebuildCodeBlock(block, region.text.slice(0, offset));
    case "raw":
      return rebuildRawBlock(block, region.text.slice(0, offset));
    default:
      return null;
  }
}

function trimLeafBlockToSuffix(block: Block, region: EditableRegion, offset: number): Block | null {
  if (offset === region.text.length) {
    return null;
  }

  switch (block.type) {
    case "heading":
    case "paragraph":
      return rebuildTextBlock(block, editRegionInlines(region, 0, offset, ""));
    case "code":
      return rebuildCodeBlock(block, region.text.slice(offset));
    case "raw":
      return rebuildRawBlock(block, region.text.slice(offset));
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
  targetRegion: EditableRegion,
  offset: number,
): Block[] {
  const targetIndex = children.findIndex((child) => blockContainsRegion(child, targetRegion));

  if (targetIndex === -1) {
    return [];
  }

  const preservedSiblings = children.slice(0, targetIndex);
  const trimmedTarget = trimBlockToPrefix(children[targetIndex]!, targetRegion, offset);

  return trimmedTarget ? [...preservedSiblings, trimmedTarget] : preservedSiblings;
}

function trimContainerChildrenToSuffix(
  children: Block[],
  targetRegion: EditableRegion,
  offset: number,
): Block[] {
  const targetIndex = children.findIndex((child) => blockContainsRegion(child, targetRegion));

  if (targetIndex === -1) {
    return [];
  }

  const preservedSiblings = children.slice(targetIndex + 1);
  const trimmedTarget = trimBlockToSuffix(children[targetIndex]!, targetRegion, offset);

  return trimmedTarget ? [trimmedTarget, ...preservedSiblings] : preservedSiblings;
}
