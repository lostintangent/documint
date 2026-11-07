import {
  createBlockquoteBlock,
  createHeadingBlock,
  createParagraphBlock,
  createParagraphTextBlock,
  rebuildTextBlock,
  type Block,
  type BlockquoteBlock,
  type HeadingBlock,
  type ParagraphBlock,
} from "@/document";
import { target } from "../../../selection";
import type { EditorStateAction } from "../../../types";
import type { BlockquoteTextBlockContext, RootTextBlockContext } from "../../context";
import { sliceInlineChildren } from "../inlines/shared";
import { spliceAt } from "./shared";

// Block-level action resolvers that aren't specific to lists, tables, or code
// blocks: splits for paragraphs/headings/blockquotes and heading depth shifts.
// Delete-only behavior (boundary collapse, block demotion, the
// adjacent-compatible-list seam-merge) lives in `actions/deletion/`.
//
// Public resolvers should read as block behavior, not reducer plumbing:
// decide the block operation, then declare the resulting caret intent.

type BlockActionIntent = {
  caret: Block;
  offset?: number | "end";
};

type BlockSplit = {
  blocks: Block[];
  caret: Block;
};

export function resolveRootTextBlockSplit(
  ctx: RootTextBlockContext,
  offset: number,
): EditorStateAction {
  const blocks = buildTextBlockSplitBlocks(ctx.block, ctx.text, offset);

  return spliceRootBlocks(ctx.rootIndex, blocks, { caret: blocks[1]! });
}

export function resolveBlockquoteTextBlockSplit(
  ctx: BlockquoteTextBlockContext,
  offset: number,
): EditorStateAction {
  const blocks = buildTextBlockSplitBlocks(ctx.block, ctx.text, offset);
  const quote = replaceBlockquoteChild(ctx.quote, ctx.childIndex, blocks);

  return spliceRootBlocks(ctx.rootIndex, [quote], { caret: blocks[1]! });
}

export function resolveStructuralBlockquoteSplit(
  ctx: BlockquoteTextBlockContext,
  offset: number,
): EditorStateAction | null {
  if (offset !== 0 || ctx.text.length !== 0 || ctx.block.type !== "paragraph") {
    return null;
  }

  const split = splitBlockquoteAtEmptyParagraph(ctx.quote, ctx.childIndex);

  return spliceRootBlocks(ctx.rootIndex, split.blocks, { caret: split.caret });
}

export function resolveHeadingDepthShift(
  ctx: RootTextBlockContext,
  direction: -1 | 1,
): EditorStateAction | null {
  if (ctx.block.type !== "heading") {
    return null;
  }

  const heading = shiftHeadingDepth(ctx.block, direction);

  if (!heading) {
    return { kind: "keep-state" };
  }

  return spliceRootBlocks(ctx.rootIndex, [heading], { caret: heading, offset: ctx.offset });
}

export function resolveParagraphBlockquoteIndent(
  ctx: RootTextBlockContext,
): EditorStateAction | null {
  if (ctx.block.type !== "paragraph") {
    return null;
  }

  return spliceRootBlocks(ctx.rootIndex, [createBlockquoteBlock([ctx.block])], {
    caret: ctx.block,
    offset: ctx.offset,
  });
}

function splitBlockquoteAtEmptyParagraph(quote: BlockquoteBlock, childIndex: number): BlockSplit {
  const beforeBlocks = quote.children.slice(0, childIndex);
  const afterBlocks = quote.children.slice(childIndex + 1);
  const paragraph = createParagraphTextBlock("");
  const blocks: Block[] = [];

  if (beforeBlocks.length > 0) {
    blocks.push(createBlockquoteBlock(beforeBlocks));
  }

  blocks.push(paragraph);

  if (afterBlocks.length > 0) {
    blocks.push(createBlockquoteBlock(afterBlocks));
  }

  return {
    blocks,
    caret: paragraph,
  };
}

function shiftHeadingDepth(block: HeadingBlock, direction: -1 | 1): HeadingBlock | null {
  const nextDepth = Math.max(1, Math.min(6, block.depth + direction)) as HeadingBlock["depth"];

  return nextDepth === block.depth
    ? null
    : createHeadingBlock({ children: block.children, depth: nextDepth });
}

function replaceBlockquoteChild(
  quote: BlockquoteBlock,
  childIndex: number,
  blocks: Block[],
): BlockquoteBlock {
  return createBlockquoteBlock(spliceAt(quote.children, childIndex, 1, blocks));
}

function spliceRootBlocks(
  rootIndex: number,
  blocks: Block[],
  intent: BlockActionIntent,
): EditorStateAction {
  return {
    kind: "splice-blocks",
    blocks,
    rootIndex,
    selection: target.block(intent.caret, intent.offset),
  };
}

// Builds the two-block split residue for a paragraph or heading.
// Edge offsets (start/end) keep the original block intact and pad with
// an empty paragraph on the open side. A mid-text split preserves the
// "before" block's type (paragraph stays paragraph; heading stays
// heading and carries depth) and emits a fresh paragraph for "after".
// Both halves slice the inline tree, so marks, links, and atoms survive.
// The second block always holds the text after the caret, so the caret goes
// there and stays with the text, as Docs and Notion keep it.
function buildTextBlockSplitBlocks(
  block: ParagraphBlock | HeadingBlock,
  text: string,
  offset: number,
): Block[] {
  if (offset === 0) {
    return [createParagraphTextBlock(""), block];
  }

  if (offset === text.length) {
    return [block, createParagraphTextBlock("")];
  }

  return [
    rebuildTextBlock(block, sliceInlineChildren(block.children, 0, offset)),
    createParagraphBlock(sliceInlineChildren(block.children, offset)),
  ];
}
