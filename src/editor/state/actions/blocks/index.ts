import {
  createBlockquoteBlock,
  createHeadingTextBlock,
  createParagraphTextBlock,
  type Block,
  type HeadingBlock,
  type ParagraphBlock,
} from "@/document";
import type { EditorStateAction } from "../../types";
import {
  createDescendantPrimaryRegionTarget,
  createRootPrimaryRegionTarget,
} from "../../selection";
import {
  type BlockquoteTextBlockContext,
  type RootTextBlockContext,
} from "../../context";

// Block-level action resolvers that aren't specific to lists or
// tables: splits for paragraphs/headings/blockquotes and heading
// depth shifts. Delete-only behavior (boundary collapse, block
// demotion, the adjacent-compatible-list seam-merge) lives in
// `actions/deletion/`.

export function resolveRootTextBlockSplit(
  ctx: RootTextBlockContext,
  offset: number,
): EditorStateAction {
  const textLength = ctx.region.text.length;
  const beforeText = ctx.region.text.slice(0, offset);
  const afterText = ctx.region.text.slice(offset);
  const focusRootIndex = offset === 0 && textLength > 0 ? ctx.rootIndex : ctx.rootIndex + 1;

  return {
    kind: "splice-blocks",
    blocks: buildTextBlockSplitBlocks(ctx.block, beforeText, afterText, offset, textLength),
    rootIndex: ctx.rootIndex,
    selection: createRootPrimaryRegionTarget(focusRootIndex),
  };
}

export function resolveBlockquoteTextBlockSplit(
  ctx: BlockquoteTextBlockContext,
  offset: number,
): EditorStateAction {
  const text = ctx.region.text;
  const beforeText = text.slice(0, offset);
  const afterText = text.slice(offset);
  const splitBlocks = buildTextBlockSplitBlocks(ctx.block, beforeText, afterText, offset, text.length);
  const focusChildIndices =
    offset === 0
      ? ctx.blockChildIndices
      : [...ctx.blockChildIndices.slice(0, -1), ctx.blockChildIndices.at(-1)! + 1];

  return {
    kind: "splice-blocks",
    blocks: [
      createBlockquoteBlock({
        children: [
          ...ctx.quote.children.slice(0, ctx.childIndex),
          ...splitBlocks,
          ...ctx.quote.children.slice(ctx.childIndex + 1),
        ],
      }),
    ],
    rootIndex: ctx.rootIndex,
    selection: createDescendantPrimaryRegionTarget(ctx.rootIndex, focusChildIndices),
  };
}

export function resolveStructuralBlockquoteSplit(
  ctx: BlockquoteTextBlockContext,
  offset: number,
): EditorStateAction | null {
  if (offset !== 0 || ctx.region.text.length !== 0 || ctx.block.type !== "paragraph") {
    return null;
  }

  const beforeBlocks = ctx.quote.children.slice(0, ctx.childIndex);
  const afterBlocks = ctx.quote.children.slice(ctx.childIndex + 1);
  const blocks: Block[] = [];

  if (beforeBlocks.length > 0) {
    blocks.push(createBlockquoteBlock({ children: beforeBlocks }));
  }

  blocks.push(createParagraphTextBlock({ text: "" }));

  if (afterBlocks.length > 0) {
    blocks.push(createBlockquoteBlock({ children: afterBlocks }));
  }

  return {
    kind: "splice-blocks",
    blocks,
    rootIndex: ctx.rootIndex,
    selection: createRootPrimaryRegionTarget(ctx.rootIndex + (beforeBlocks.length > 0 ? 1 : 0)),
  };
}

export function resolveHeadingDepthShift(
  ctx: RootTextBlockContext,
  direction: -1 | 1,
  cursorOffset: number,
): EditorStateAction | null {
  if (ctx.block.type !== "heading") {
    return null;
  }

  const nextDepth = Math.max(1, Math.min(6, ctx.block.depth + direction)) as HeadingBlock["depth"];

  if (nextDepth === ctx.block.depth) {
    return { kind: "keep-state" };
  }

  return {
    kind: "splice-blocks",
    blocks: [createHeadingTextBlock({ depth: nextDepth, text: ctx.block.plainText })],
    rootIndex: ctx.rootIndex,
    selection: createRootPrimaryRegionTarget(ctx.rootIndex, cursorOffset),
  };
}

// Builds the two-block split residue for a paragraph or heading.
// Edge offsets (start/end) keep the original block intact and pad with
// an empty paragraph on the open side. A mid-text split preserves the
// "before" block's type (paragraph stays paragraph; heading stays
// heading and carries depth) and emits a fresh paragraph for "after".
function buildTextBlockSplitBlocks(
  block: ParagraphBlock | HeadingBlock,
  beforeText: string,
  afterText: string,
  offset: number,
  textLength: number,
): Block[] {
  if (offset === 0) {
    return [createParagraphTextBlock({ text: "" }), block];
  }

  if (offset === textLength) {
    return [block, createParagraphTextBlock({ text: "" })];
  }

  const beforeBlock =
    block.type === "heading"
      ? createHeadingTextBlock({ depth: block.depth, text: beforeText })
      : createParagraphTextBlock({ text: beforeText });

  return [beforeBlock, createParagraphTextBlock({ text: afterText })];
}
