// Structural block slicing and seam-merge policy shared by fragment extraction
// and structural replacement.
//
// These helpers operate on semantic `Block` trees plus editor regions, but they
// don't mutate editor state directly. They define how a selection carves block
// structure (`trimBlockToPrefix` / `trimBlockToSuffix`) and how a structural
// replacement rejoins the preserved ends with pasted blocks (`mergeTrimmedBlocks`).

import {
  defragmentTextInlines,
  getBlockChildren,
  rebuildCodeBlock,
  rebuildRawBlock,
  rebuildTextBlock,
  replaceBlockChildren,
  type Block,
} from "@/document";
import type { EditorRegion } from "../index/types";
import { editRegionInlines } from "../reducer/inlines";

type TextLikeBlock = Extract<Block, { type: "heading" | "paragraph" }>;
type CaretTarget = { childIndices: number[]; offset: number | "end" };

export type MergeResult = {
  blocks: Block[];
  caretLocalIndex: number;
  caretChildIndices: number[];
  caretOffset: number | "end";
  startRegionInsertedText: string;
  startRegionPreservedAtRoot0: boolean;
};

// Joins a trimmed prefix root and a trimmed suffix root with a fragment of
// replacement blocks between them. Three collapse strategies apply at the
// boundaries between blocks:
//
//   - Front absorb: fragment[0] is a paragraph and prefix is text-like
//     (paragraph/heading). The paragraph's inlines append into prefix,
//     preserving prefix's type. This is the "fluent text inserts into the
//     destination block" behavior.
//   - Back absorb: fragment[-1] is a paragraph and suffix is text-like.
//     Mirror of front absorb; suffix's type is preserved.
//   - Bridge: when no fragment blocks remain between prefix and suffix
//     (either fragment was empty, or its only block was absorbed at the
//     front seam), prefix and suffix collapse directly. Two text-likes
//     concatenate into prefix's type; same-kind containers peel into one.
//     Matches the long-standing cross-region delete-merge semantics.
//   - Container peel: a same-kind container (list/blockquote/listItem) at
//     either fragment end merges its children into the neighbor's
//     children, so adjacent lists or quotes flow into one.
//
// Headings and other structural blocks deliberately do NOT participate in
// seam absorption — pasting `# Foo` mid-paragraph splits it cleanly.
export function mergeTrimmedBlocks(
  prefix: Block | null,
  fragment: Block[],
  suffix: Block | null,
): MergeResult {
  const blocks: Block[] = [];
  let caretLocalIndex = 0;
  let caret: CaretTarget = { childIndices: [], offset: 0 };
  let startRegionInsertedText = "";
  // The start region's path resolves to result.blocks[0] after the splice.
  // When that block doesn't carry the original region's content (e.g. a
  // multi-block paste with no prefix), optimistic comment repair has no
  // reliable offset math; flip this off so the full resolver takes over.
  let startRegionPreservedAtRoot0 = prefix !== null;

  if (prefix) {
    blocks.push(prefix);
    caret = caretAtBlockEnd(prefix);
  }

  let absorbedFromFront = 0;

  if (prefix && fragment.length > 0) {
    const head = fragment[0]!;

    if (isTextLikeBlock(prefix) && head.type === "paragraph") {
      const merged = concatTextLikeChildren(prefix, prefix.children, head.children);
      blocks[blocks.length - 1] = merged;
      caret = { childIndices: [], offset: merged.plainText.length };
      absorbedFromFront = 1;
      startRegionInsertedText = head.plainText;
    } else if (canPeelContainers(prefix, head)) {
      const merged = peelContainers(prefix, head);
      blocks[blocks.length - 1] = merged;
      caret = caretAtLastChildEnd(merged);
      absorbedFromFront = 1;
    }
  }

  for (let index = absorbedFromFront; index < fragment.length; index += 1) {
    const block = fragment[index]!;
    blocks.push(block);
    caretLocalIndex = blocks.length - 1;
    caret = caretAtBlockEnd(block);
  }

  if (suffix) {
    const tailIndex = blocks.length - 1;
    const tail = blocks[tailIndex] ?? null;
    const isBridge = absorbedFromFront >= fragment.length && prefix !== null;
    let merged: Block | null = null;

    if (tail) {
      if (!isBridge && tail.type === "paragraph" && isTextLikeBlock(suffix)) {
        merged = concatTextLikeChildren(suffix, tail.children, suffix.children);
        if (prefix === null && fragment.length === 1) {
          startRegionPreservedAtRoot0 = true;
          startRegionInsertedText = tail.plainText;
        }
      } else if (isBridge && isTextLikeBlock(tail) && isTextLikeBlock(suffix)) {
        merged = concatTextLikeChildren(tail, tail.children, suffix.children);
      } else if (canPeelContainers(tail, suffix)) {
        merged = peelContainers(tail, suffix);
        const leftChildren = getBlockChildren(tail)!;
        caret = { childIndices: [leftChildren.length - 1], offset: "end" };
      }
    } else if (prefix === null && fragment.length === 0) {
      startRegionPreservedAtRoot0 = true;
    }

    if (merged) {
      blocks[tailIndex] = merged;
    } else {
      blocks.push(suffix);
    }
  }

  return {
    blocks,
    caretLocalIndex,
    caretChildIndices: caret.childIndices,
    caretOffset: caret.offset,
    startRegionInsertedText,
    startRegionPreservedAtRoot0,
  };
}

// Returns the part of `block` from its start up to `offset` within
// `targetRegion`, dropping siblings after the target at every level.
// Returns null if nothing remains (the target is the only descendant and the
// leaf trim yielded empty content).
export function trimBlockToPrefix(
  block: Block,
  targetRegion: EditorRegion,
  offset: number,
): Block | null {
  if (block.type === "table") {
    return null;
  }

  if (block.id === targetRegion.blockId) {
    return trimLeafBlockToPrefix(block, targetRegion, offset);
  }

  return trimContainerBlock(block, (children) =>
    trimContainerChildrenToPrefix(children, targetRegion, offset),
  );
}

// Mirror of `trimBlockToPrefix` for the post-offset side.
export function trimBlockToSuffix(
  block: Block,
  targetRegion: EditorRegion,
  offset: number,
): Block | null {
  if (block.type === "table") {
    return null;
  }

  if (block.id === targetRegion.blockId) {
    return trimLeafBlockToSuffix(block, targetRegion, offset);
  }

  return trimContainerBlock(block, (children) =>
    trimContainerChildrenToSuffix(children, targetRegion, offset),
  );
}

// Whether `block` directly is or transitively contains the leaf identified by
// `region.blockId`. Shared by trimming and fragment path narrowing.
export function blockContainsRegion(block: Block, region: EditorRegion): boolean {
  if (block.id === region.blockId) {
    return true;
  }

  const children = getBlockChildren(block);
  return children !== null && children.some((child) => blockContainsRegion(child, region));
}

function caretAtBlockEnd(block: Block): CaretTarget {
  return getBlockChildren(block)
    ? caretAtLastChildEnd(block)
    : { childIndices: [], offset: block.plainText.length };
}

function caretAtLastChildEnd(block: Block): CaretTarget {
  const children = getBlockChildren(block)!;
  return { childIndices: [children.length - 1], offset: "end" };
}

function concatTextLikeChildren(
  typeFrom: TextLikeBlock,
  leftChildren: TextLikeBlock["children"],
  rightChildren: TextLikeBlock["children"],
): Block {
  return rebuildTextBlock(typeFrom, defragmentTextInlines([...leftChildren, ...rightChildren]));
}

function isTextLikeBlock(block: Block | null): block is TextLikeBlock {
  return block !== null && (block.type === "heading" || block.type === "paragraph");
}

function canPeelContainers(left: Block, right: Block): boolean {
  return left.type === right.type && getBlockChildren(left) !== null;
}

function peelContainers(left: Block, right: Block): Block {
  const leftChildren = getBlockChildren(left)!;
  const rightChildren = getBlockChildren(right)!;
  return replaceBlockChildren(left, [...leftChildren, ...rightChildren])!;
}

function trimLeafBlockToPrefix(block: Block, region: EditorRegion, offset: number): Block | null {
  if (offset === 0) {
    return null;
  }

  switch (block.type) {
    case "heading":
    case "paragraph":
      return rebuildTextBlock(block, editRegionInlines(region, offset, region.text.length, ""));
    case "code":
      return rebuildCodeBlock(block, region.text.slice(0, offset));
    case "unsupported":
      return rebuildRawBlock(block, region.text.slice(0, offset));
    default:
      return null;
  }
}

function trimLeafBlockToSuffix(block: Block, region: EditorRegion, offset: number): Block | null {
  if (offset === region.text.length) {
    return null;
  }

  switch (block.type) {
    case "heading":
    case "paragraph":
      return rebuildTextBlock(block, editRegionInlines(region, 0, offset, ""));
    case "code":
      return rebuildCodeBlock(block, region.text.slice(offset));
    case "unsupported":
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
  targetRegion: EditorRegion,
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
  targetRegion: EditorRegion,
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
