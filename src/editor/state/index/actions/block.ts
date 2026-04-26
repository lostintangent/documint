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
import type { DocumentIndex, EditorAction, EditorStateAction } from "../types";
import { replaceListItemLeadingParagraphText } from "../context";
import {
  createDescendantPrimaryRegionTarget,
  createRootPrimaryRegionTarget,
  normalizeSelection,
  type EditorSelection,
} from "../../selection";
import {
  type RootTextBlockContext,
  resolveBlockquoteContext,
  resolveBlockquoteTextBlockContext,
  resolveRootTextBlockContext,
} from "../context";

// Block structure action resolvers: split, backspace, heading depth, and
// blockquote operations.

export function resolveTextBlockSplit(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): EditorAction | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (
    normalized.start.regionId !== normalized.end.regionId ||
    normalized.start.offset !== normalized.end.offset
  ) {
    return null;
  }

  const context = resolveRootTextBlockContext(documentIndex, selection);

  if (!context) {
    return resolveBlockquoteTextBlockSplit(documentIndex, selection);
  }

  const beforeText = context.region.text.slice(0, normalized.start.offset);
  const afterText = context.region.text.slice(normalized.start.offset);
  const focusRootIndex =
    normalized.start.offset === 0 && context.region.text.length > 0
      ? context.rootIndex
      : context.rootIndex + 1;

  if (context.block.type === "paragraph") {
    return {
      kind: "replace-root-range",
      count: 1,
      replacements:
        normalized.start.offset === 0
          ? [
              createParagraphTextBlock({
                text: "",
              }),
              context.block,
            ]
          : normalized.start.offset === context.region.text.length
            ? [
                context.block,
                createParagraphTextBlock({
                  text: "",
                }),
              ]
            : [
                createParagraphTextBlock({
                  text: beforeText,
                }),
                createParagraphTextBlock({
                  text: afterText,
                }),
              ],
      rootIndex: context.rootIndex,
      selection: createRootPrimaryRegionTarget(focusRootIndex),
    };
  }

  return {
    kind: "replace-root-range",
    count: 1,
    replacements:
      normalized.start.offset === 0
        ? [
            createParagraphTextBlock({
              text: "",
            }),
            context.block,
          ]
        : normalized.start.offset === context.region.text.length
          ? [
              context.block,
              createParagraphTextBlock({
                text: "",
              }),
            ]
          : [
              createHeadingTextBlock({
                depth: context.block.depth,
                text: beforeText,
              }),
              createParagraphTextBlock({
                text: afterText,
              }),
            ],
    rootIndex: context.rootIndex,
    selection: createRootPrimaryRegionTarget(focusRootIndex),
  };
}

export function resolveBlockquoteTextBlockSplit(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): EditorAction | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (
    normalized.start.regionId !== normalized.end.regionId ||
    normalized.start.offset !== normalized.end.offset
  ) {
    return null;
  }

  const context = resolveBlockquoteTextBlockContext(documentIndex, selection);

  if (!context) {
    return null;
  }

  const text = context.region.text;
  const beforeText = text.slice(0, normalized.start.offset);
  const afterText = text.slice(normalized.start.offset);
  const replacement =
    context.block.type === "heading"
      ? buildHeadingSplitReplacement(
          context.block,
          beforeText,
          afterText,
          context.blockChildIndices,
          normalized.start.offset,
          text.length,
        )
      : buildParagraphSplitReplacement(
          context.block,
          beforeText,
          afterText,
          context.blockChildIndices,
          normalized.start.offset,
          text.length,
        );

  return {
    kind: "replace-root",
    block: createBlockquoteBlock({
      children: [
        ...context.quote.children.slice(0, context.childIndex),
        ...replacement.blocks,
        ...context.quote.children.slice(context.childIndex + 1),
      ],
    }),
    rootIndex: context.rootIndex,
    selection: createDescendantPrimaryRegionTarget(
      context.rootIndex,
      replacement.focusChildIndices,
    ),
  };
}

export function resolveStructuralBlockquoteSplit(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): EditorAction | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (
    normalized.start.regionId !== normalized.end.regionId ||
    normalized.start.offset !== 0 ||
    normalized.end.offset !== 0
  ) {
    return null;
  }

  const context = resolveBlockquoteTextBlockContext(documentIndex, selection);

  if (!context || context.region.text.length !== 0 || context.block.type !== "paragraph") {
    return null;
  }

  const beforeBlocks = context.quote.children.slice(0, context.childIndex);
  const afterBlocks = context.quote.children.slice(context.childIndex + 1);
  const replacements: Block[] = [];

  if (beforeBlocks.length > 0) {
    replacements.push(createBlockquoteBlock({ children: beforeBlocks }));
  }

  replacements.push(
    createParagraphTextBlock({
      text: "",
    }),
  );

  if (afterBlocks.length > 0) {
    replacements.push(createBlockquoteBlock({ children: afterBlocks }));
  }

  return {
    kind: "replace-root-range",
    count: 1,
    replacements,
    rootIndex: context.rootIndex,
    selection: createRootPrimaryRegionTarget(context.rootIndex + (beforeBlocks.length > 0 ? 1 : 0)),
  };
}

export function resolveCodeLineBreak(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): EditorAction | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (
    normalized.start.regionId !== normalized.end.regionId ||
    normalized.start.regionId !== selection.anchor.regionId
  ) {
    return null;
  }

  const region = documentIndex.regionIndex.get(normalized.start.regionId);

  if (!region || region.blockType !== "code") {
    return null;
  }

  return {
    kind: "replace-selection",
    selection,
    text: "\n",
  };
}

export function resolveBlockStructuralBackspace(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): EditorAction | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (
    normalized.start.regionId !== normalized.end.regionId ||
    normalized.start.offset !== 0 ||
    normalized.end.offset !== 0
  ) {
    return null;
  }

  const context = resolveRootTextBlockContext(documentIndex, selection);
  const demotedHeading = context ? demoteHeadingToParagraph(context) : null;

  if (demotedHeading) {
    return demotedHeading;
  }

  if (context && context.rootIndex > 0) {
    const previousRoot = documentIndex.document.blocks[context.rootIndex - 1];
    const nextRoot = documentIndex.document.blocks[context.rootIndex + 1];

    if (previousRoot) {
      if (context.block.plainText.length === 0) {
        const mergedAdjacentLists = mergeAdjacentListsAroundEmptyParagraph(
          context,
          previousRoot,
          nextRoot,
        );

        if (mergedAdjacentLists) {
          return mergedAdjacentLists;
        }

        return {
          kind: "replace-root-range",
          count: 1,
          replacements: [],
          rootIndex: context.rootIndex,
          selection:
            previousRoot.type === "paragraph" || previousRoot.type === "heading"
              ? createRootPrimaryRegionTarget(context.rootIndex - 1, "end")
              : previousRoot.type === "list"
                ? createDescendantPrimaryRegionTarget(
                    context.rootIndex - 1,
                    [previousRoot.items.length - 1, 0],
                    "end",
                  )
                : previousRoot.type === "blockquote"
                  ? createDescendantPrimaryRegionTarget(
                      context.rootIndex - 1,
                      [previousRoot.children.length - 1],
                      "end",
                    )
                  : createRootPrimaryRegionTarget(context.rootIndex - 1, "end"),
        };
      }

      if (previousRoot.type === "paragraph") {
        return {
          kind: "replace-root-range",
          count: 2,
          replacements: [
            createParagraphTextBlock({
              text: `${previousRoot.plainText}${context.block.plainText}`,
            }),
          ],
          rootIndex: context.rootIndex - 1,
          selection: createRootPrimaryRegionTarget(context.rootIndex - 1, "end"),
        };
      }

      if (previousRoot.type === "heading") {
        return {
          kind: "replace-root-range",
          count: 2,
          replacements: [
            createHeadingTextBlock({
              depth: previousRoot.depth,
              text: `${previousRoot.plainText}${context.block.plainText}`,
            }),
          ],
          rootIndex: context.rootIndex - 1,
          selection: createRootPrimaryRegionTarget(context.rootIndex - 1, "end"),
        };
      }

      if (previousRoot.type === "list") {
        const lastIndex = previousRoot.items.length - 1;
        const lastItem = previousRoot.items[lastIndex];

        if (lastItem) {
          const mergedLastItem = replaceListItemLeadingParagraphText(
            lastItem,
            `${lastItem.plainText}${context.block.plainText}`,
          );

          if (mergedLastItem) {
            return {
              kind: "replace-root-range",
              count: 2,
              replacements: [
                rebuildListBlock(
                  previousRoot,
                  previousRoot.items.map((child, index) =>
                    index === lastIndex ? mergedLastItem : child,
                  ),
                ),
              ],
              rootIndex: context.rootIndex - 1,
              selection: createDescendantPrimaryRegionTarget(
                context.rootIndex - 1,
                [lastIndex, 0],
                "end",
              ),
            };
          }
        }
      }
    }
  }

  const emptyQuoteLine = deleteEmptyBlockquoteLine(documentIndex, selection);

  if (emptyQuoteLine) {
    return emptyQuoteLine;
  }

  const quoteContext = resolveBlockquoteContext(documentIndex, selection);

  if (!quoteContext) {
    return null;
  }

  const blockContext = resolveBlockquoteTextBlockContext(documentIndex, selection);

  return {
    kind: "replace-root-range",
    count: 1,
    replacements: quoteContext.quote.children,
    rootIndex: quoteContext.rootIndex,
    selection: createRootPrimaryRegionTarget(
      blockContext ? quoteContext.rootIndex + blockContext.childIndex : quoteContext.rootIndex,
    ),
  };
}

export function resolveHeadingDepthShift(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  direction: -1 | 1,
): EditorStateAction | null {
  const context = resolveRootTextBlockContext(documentIndex, selection);

  if (!context || context.block.type !== "heading") {
    return null;
  }

  const nextDepth = Math.max(
    1,
    Math.min(6, context.block.depth + direction),
  ) as HeadingBlock["depth"];

  if (nextDepth === context.block.depth) {
    return { kind: "keep-state" };
  }

  return {
    kind: "replace-root",
    block: createHeadingTextBlock({
      depth: nextDepth,
      text: context.block.plainText,
    }),
    rootIndex: context.rootIndex,
    selection: createRootPrimaryRegionTarget(context.rootIndex, selection.focus.offset),
  };
}

export function resolveBlockquoteWrap(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): EditorAction | null {
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
    kind: "replace-root",
    block: createBlockquoteBlock({
      children: [block],
      path: `root.${rootIndex}`,
    }),
    rootIndex,
  };
}

function mergeAdjacentListsAroundEmptyParagraph(
  context: RootTextBlockContext,
  previousRoot: Block,
  nextRoot: Block | undefined,
): EditorAction | null {
  if (
    context.block.type !== "paragraph" ||
    context.block.plainText.length !== 0 ||
    previousRoot.type !== "list" ||
    nextRoot?.type !== "list" ||
    !areCompatibleAdjacentLists(previousRoot, nextRoot)
  ) {
    return null;
  }

  const previousTrailingItemIndex = previousRoot.items.length - 1;

  return {
    kind: "replace-root-range",
    count: 3,
    replacements: [rebuildListBlock(previousRoot, [...previousRoot.items, ...nextRoot.items])],
    rootIndex: context.rootIndex - 1,
    selection: createDescendantPrimaryRegionTarget(
      context.rootIndex - 1,
      [previousTrailingItemIndex, 0],
      "end",
    ),
  };
}

function areCompatibleAdjacentLists(left: ListBlock, right: ListBlock) {
  return left.ordered === right.ordered && left.start === right.start;
}

function demoteHeadingToParagraph(context: RootTextBlockContext): EditorAction | null {
  if (context.block.type !== "heading") {
    return null;
  }

  return {
    kind: "replace-root",
    block: createParagraphTextBlock({
      text: context.block.plainText,
    }),
    rootIndex: context.rootIndex,
    selection: createRootPrimaryRegionTarget(context.rootIndex),
  };
}

function deleteEmptyBlockquoteLine(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): EditorAction | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (
    normalized.start.regionId !== normalized.end.regionId ||
    normalized.start.offset !== 0 ||
    normalized.end.offset !== 0
  ) {
    return null;
  }

  const context = resolveBlockquoteTextBlockContext(documentIndex, selection);

  if (!context || context.block.type !== "paragraph" || context.region.text.length !== 0) {
    return null;
  }

  if (context.quote.children.length === 1) {
    return {
      kind: "replace-root-range",
      count: 1,
      replacements: [
        createParagraphTextBlock({
          text: "",
        }),
      ],
      rootIndex: context.rootIndex,
      selection: createRootPrimaryRegionTarget(context.rootIndex),
    };
  }

  const focusChildIndex = Math.max(0, context.childIndex - 1);
  const focusOffset = context.childIndex > 0 ? "end" : 0;

  return {
    kind: "replace-root",
    block: createBlockquoteBlock({
      children: context.quote.children.filter((_, index) => index !== context.childIndex),
    }),
    rootIndex: context.rootIndex,
    selection: createDescendantPrimaryRegionTarget(
      context.rootIndex,
      [focusChildIndex],
      focusOffset,
    ),
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
        ? [
            createParagraphTextBlock({
              text: "",
            }),
            block,
          ]
        : offset === textLength
          ? [
              block,
              createParagraphTextBlock({
                text: "",
              }),
            ]
          : [
              createParagraphTextBlock({
                text: beforeText,
              }),
              createParagraphTextBlock({
                text: afterText,
              }),
            ],
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
        ? [
            createParagraphTextBlock({
              text: "",
            }),
            block,
          ]
        : offset === textLength
          ? [
              block,
              createParagraphTextBlock({
                text: "",
              }),
            ]
          : [
              createHeadingTextBlock({
                depth: block.depth,
                text: beforeText,
              }),
              createParagraphTextBlock({
                text: afterText,
              }),
            ],
    focusChildIndices:
      offset === 0
        ? blockChildIndices
        : [...blockChildIndices.slice(0, -1), blockChildIndices.at(-1)! + 1],
  };
}
