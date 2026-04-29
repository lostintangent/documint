import {
  createBlockquoteBlock,
  createHeadingTextBlock,
  createParagraphTextBlock,
  rebuildListBlock,
  type Block,
  type HeadingBlock,
  type ListBlock,
  type ParagraphBlock,
} from "@/document";
import type { DocumentIndex } from "../index/types";
import type { EditorStateAction } from "../types";
import { replaceListItemLeadingParagraphText } from "../context";
import {
  createDescendantPrimaryRegionTarget,
  createRootPrimaryRegionTarget,
  type EditorSelection,
} from "../selection";
import {
  type BlockquoteTextBlockContext,
  type RootTextBlockContext,
} from "../context";

// Block structure action resolvers: split, backspace, heading depth, and
// blockquote operations.
//
// Every exported function takes a pre-resolved context object — context
// resolution and selection normalization happen once in commands.ts.

export function resolveRootTextBlockSplit(
  ctx: RootTextBlockContext,
  offset: number,
): EditorStateAction {
  const textLength = ctx.region.text.length;
  const beforeText = ctx.region.text.slice(0, offset);
  const afterText = ctx.region.text.slice(offset);
  const focusRootIndex = offset === 0 && textLength > 0 ? ctx.rootIndex : ctx.rootIndex + 1;

  if (ctx.block.type === "paragraph") {
    return {
      kind: "splice-blocks",
      blocks:
        offset === 0
          ? [createParagraphTextBlock({ text: "" }), ctx.block]
          : offset === textLength
            ? [ctx.block, createParagraphTextBlock({ text: "" })]
            : [createParagraphTextBlock({ text: beforeText }), createParagraphTextBlock({ text: afterText })],
      rootIndex: ctx.rootIndex,
      selection: createRootPrimaryRegionTarget(focusRootIndex),
    };
  }

  return {
    kind: "splice-blocks",
    blocks:
      offset === 0
        ? [createParagraphTextBlock({ text: "" }), ctx.block]
        : offset === textLength
          ? [ctx.block, createParagraphTextBlock({ text: "" })]
          : [createHeadingTextBlock({ depth: ctx.block.depth, text: beforeText }), createParagraphTextBlock({ text: afterText })],
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
  const replacement =
    ctx.block.type === "heading"
      ? buildHeadingSplitReplacement(ctx.block, beforeText, afterText, ctx.blockChildIndices, offset, text.length)
      : buildParagraphSplitReplacement(ctx.block, beforeText, afterText, ctx.blockChildIndices, offset, text.length);

  return {
    kind: "splice-blocks",
    blocks: [
      createBlockquoteBlock({
        children: [
          ...ctx.quote.children.slice(0, ctx.childIndex),
          ...replacement.blocks,
          ...ctx.quote.children.slice(ctx.childIndex + 1),
        ],
      }),
    ],
    rootIndex: ctx.rootIndex,
    selection: createDescendantPrimaryRegionTarget(ctx.rootIndex, replacement.focusChildIndices),
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

export function resolveRootBlockBackspace(
  ctx: RootTextBlockContext,
  documentIndex: DocumentIndex,
): EditorStateAction | null {
  const demotedHeading = demoteHeadingToParagraph(ctx);

  if (demotedHeading) {
    return demotedHeading;
  }

  if (ctx.rootIndex === 0) {
    return null;
  }

  const previousRoot = documentIndex.document.blocks[ctx.rootIndex - 1];
  const nextRoot = documentIndex.document.blocks[ctx.rootIndex + 1];

  if (!previousRoot) {
    return null;
  }

  if (ctx.block.plainText.length === 0) {
    const mergedAdjacentLists = mergeAdjacentListsAroundEmptyParagraph(ctx, previousRoot, nextRoot);

    if (mergedAdjacentLists) {
      return mergedAdjacentLists;
    }

    return {
      kind: "splice-blocks",
      blocks: [],
      rootIndex: ctx.rootIndex,
      selection:
        previousRoot.type === "paragraph" || previousRoot.type === "heading"
          ? createRootPrimaryRegionTarget(ctx.rootIndex - 1, "end")
          : previousRoot.type === "list"
            ? createDescendantPrimaryRegionTarget(ctx.rootIndex - 1, [previousRoot.items.length - 1, 0], "end")
            : previousRoot.type === "blockquote"
              ? createDescendantPrimaryRegionTarget(ctx.rootIndex - 1, [previousRoot.children.length - 1], "end")
              : createRootPrimaryRegionTarget(ctx.rootIndex - 1, "end"),
    };
  }

  if (previousRoot.type === "paragraph") {
    return {
      kind: "splice-blocks",
      count: 2,
      blocks: [createParagraphTextBlock({ text: `${previousRoot.plainText}${ctx.block.plainText}` })],
      rootIndex: ctx.rootIndex - 1,
      selection: createRootPrimaryRegionTarget(ctx.rootIndex - 1, previousRoot.plainText.length),
    };
  }

  if (previousRoot.type === "heading") {
    return {
      kind: "splice-blocks",
      count: 2,
      blocks: [createHeadingTextBlock({ depth: previousRoot.depth, text: `${previousRoot.plainText}${ctx.block.plainText}` })],
      rootIndex: ctx.rootIndex - 1,
      selection: createRootPrimaryRegionTarget(ctx.rootIndex - 1, previousRoot.plainText.length),
    };
  }

  if (previousRoot.type === "list") {
    const lastIndex = previousRoot.items.length - 1;
    const lastItem = previousRoot.items[lastIndex];

    if (lastItem) {
      const mergedLastItem = replaceListItemLeadingParagraphText(
        lastItem,
        `${lastItem.plainText}${ctx.block.plainText}`,
      );

      if (mergedLastItem) {
        return {
          kind: "splice-blocks",
          count: 2,
          blocks: [
            rebuildListBlock(
              previousRoot,
              previousRoot.items.map((child, index) => (index === lastIndex ? mergedLastItem : child)),
            ),
          ],
          rootIndex: ctx.rootIndex - 1,
          selection: createDescendantPrimaryRegionTarget(ctx.rootIndex - 1, [lastIndex, 0], lastItem.plainText.length),
        };
      }
    }
  }

  return null;
}

export function resolveBlockquoteBackspace(ctx: BlockquoteTextBlockContext): EditorStateAction | null {
  if (ctx.region.text.length === 0) {
    return deleteEmptyBlockquoteLine(ctx);
  }

  if (ctx.childIndex > 0) {
    return mergeBlockquoteLine(ctx);
  }

  return {
    kind: "splice-blocks",
    blocks: ctx.quote.children,
    rootIndex: ctx.rootIndex,
    selection: createRootPrimaryRegionTarget(ctx.rootIndex),
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

export function resolveBlockquoteWrap(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): EditorStateAction | null {
  const region = documentIndex.regionIndex.get(selection.anchor.regionId);

  if (!region) {
    return null;
  }

  const rootIndex = region.rootIndex;
  const block = documentIndex.document.blocks[rootIndex];

  if (!block) {
    return null;
  }

  return {
    kind: "splice-blocks",
    blocks: [createBlockquoteBlock({ children: [block], path: `root.${rootIndex}` })],
    rootIndex,
  };
}

function mergeAdjacentListsAroundEmptyParagraph(
  ctx: RootTextBlockContext,
  previousRoot: Block,
  nextRoot: Block | undefined,
): EditorStateAction | null {
  if (
    ctx.block.type !== "paragraph" ||
    ctx.block.plainText.length !== 0 ||
    previousRoot.type !== "list" ||
    nextRoot?.type !== "list" ||
    !areCompatibleAdjacentLists(previousRoot, nextRoot)
  ) {
    return null;
  }

  const previousTrailingItemIndex = previousRoot.items.length - 1;

  return {
    kind: "splice-blocks",
    count: 3,
    blocks: [rebuildListBlock(previousRoot, [...previousRoot.items, ...nextRoot.items])],
    rootIndex: ctx.rootIndex - 1,
    selection: createDescendantPrimaryRegionTarget(ctx.rootIndex - 1, [previousTrailingItemIndex, 0], "end"),
  };
}

function areCompatibleAdjacentLists(left: ListBlock, right: ListBlock) {
  return left.ordered === right.ordered && left.start === right.start;
}

function demoteHeadingToParagraph(ctx: RootTextBlockContext): EditorStateAction | null {
  if (ctx.block.type !== "heading") {
    return null;
  }

  return {
    kind: "splice-blocks",
    blocks: [createParagraphTextBlock({ text: ctx.block.plainText })],
    rootIndex: ctx.rootIndex,
    selection: createRootPrimaryRegionTarget(ctx.rootIndex),
  };
}

function mergeBlockquoteLine(ctx: BlockquoteTextBlockContext): EditorStateAction {
  const previousChild = ctx.quote.children[ctx.childIndex - 1] as Extract<typeof ctx.block, { type: "paragraph" }>;
  const previousText = previousChild.plainText;
  const currentText = ctx.block.plainText;

  const mergedChildren = ctx.quote.children
    .filter((_, index) => index !== ctx.childIndex)
    .map((child, index) =>
      index === ctx.childIndex - 1
        ? createParagraphTextBlock({ text: `${previousText}${currentText}` })
        : child,
    );

  return {
    kind: "splice-blocks",
    blocks: [createBlockquoteBlock({ children: mergedChildren })],
    rootIndex: ctx.rootIndex,
    selection: createDescendantPrimaryRegionTarget(ctx.rootIndex, [ctx.childIndex - 1], previousText.length),
  };
}

function deleteEmptyBlockquoteLine(ctx: BlockquoteTextBlockContext): EditorStateAction {
  if (ctx.quote.children.length === 1) {
    return {
      kind: "splice-blocks",
      blocks: [createParagraphTextBlock({ text: "" })],
      rootIndex: ctx.rootIndex,
      selection: createRootPrimaryRegionTarget(ctx.rootIndex),
    };
  }

  const focusChildIndex = Math.max(0, ctx.childIndex - 1);
  const focusOffset = ctx.childIndex > 0 ? "end" : 0;

  return {
    kind: "splice-blocks",
    blocks: [
      createBlockquoteBlock({
        children: ctx.quote.children.filter((_, index) => index !== ctx.childIndex),
      }),
    ],
    rootIndex: ctx.rootIndex,
    selection: createDescendantPrimaryRegionTarget(ctx.rootIndex, [focusChildIndex], focusOffset),
  };
}

function buildParagraphSplitReplacement(
  block: ParagraphBlock,
  beforeText: string,
  afterText: string,
  blockChildIndices: number[],
  offset: number,
  textLength: number,
) {
  return {
    blocks:
      offset === 0
        ? [createParagraphTextBlock({ text: "" }), block]
        : offset === textLength
          ? [block, createParagraphTextBlock({ text: "" })]
          : [createParagraphTextBlock({ text: beforeText }), createParagraphTextBlock({ text: afterText })],
    focusChildIndices:
      offset === 0
        ? blockChildIndices
        : [...blockChildIndices.slice(0, -1), blockChildIndices.at(-1)! + 1],
  };
}

function buildHeadingSplitReplacement(
  block: HeadingBlock,
  beforeText: string,
  afterText: string,
  blockChildIndices: number[],
  offset: number,
  textLength: number,
) {
  return {
    blocks:
      offset === 0
        ? [createParagraphTextBlock({ text: "" }), block]
        : offset === textLength
          ? [block, createParagraphTextBlock({ text: "" })]
          : [createHeadingTextBlock({ depth: block.depth, text: beforeText }), createParagraphTextBlock({ text: afterText })],
    focusChildIndices:
      offset === 0
        ? blockChildIndices
        : [...blockChildIndices.slice(0, -1), blockChildIndices.at(-1)! + 1],
  };
}
