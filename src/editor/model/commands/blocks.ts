// Structural block editing commands for paragraphs, headings, blockquotes, and
// code blocks, including enter and start-of-block backspace behavior.
import {
  createBlockquoteBlock,
  createHeadingTextBlock,
  createParagraphTextBlock,
  rebuildListBlock,
  type Block,
  type HeadingBlock,
  type ListBlock,
  type ListItemBlock,
  type ParagraphBlock,
} from "@/document";
import type { CanvasSelection, EditorSelectionTarget } from "../document-editor";
import { type EditorState } from "../state";

type RootTextBlockContext = {
  block: Extract<Block, { type: "heading" | "paragraph" }>;
  container: EditorState["documentEditor"]["regions"][number];
  rootIndex: number;
};

type BlockquoteTextBlockContext = {
  block: Extract<Block, { type: "heading" | "paragraph" }>;
  blockChildIndices: number[];
  childIndex: number;
  container: EditorState["documentEditor"]["regions"][number];
  quote: Extract<Block, { type: "blockquote" }>;
  rootIndex: number;
};

type BlockquoteContext = {
  quote: Extract<Block, { type: "blockquote" }>;
  rootIndex: number;
};

type BlockHelpers = {
  applyRootBlockReplacement: (
    state: EditorState,
    rootIndex: number,
    replacement: Block,
    selection?: CanvasSelection | EditorSelectionTarget,
  ) => EditorState | null;
  focusBlockContainer: (state: EditorState, blockId: string) => EditorState;
  focusBlockContainerEnd: (state: EditorState, blockId: string) => EditorState;
  focusDescendantPrimaryRegion: (
    rootIndex: number,
    childIndices: number[],
    offset?: number | "end",
  ) => EditorSelectionTarget;
  focusRootPrimaryRegion: (
    rootIndex: number,
    offset?: number | "end",
  ) => EditorSelectionTarget;
  normalizeSelection: typeof import("../document-editor").normalizeCanvasSelection;
  replaceRootRange: (
    state: EditorState,
    rootIndex: number,
    count: number,
    replacements: Block[],
    selection?: CanvasSelection | EditorSelectionTarget,
  ) => EditorState;
  replaceSelectionText: (state: EditorState, text: string) => EditorState;
  replaceListItemLeadingParagraphText: (
    item: ListItemBlock,
    text: string,
  ) => ListItemBlock | null;
  resolveBlockquoteContext: (state: EditorState) => BlockquoteContext | null;
  resolveBlockquoteTextBlockContext: (state: EditorState) => BlockquoteTextBlockContext | null;
  resolvePrimaryTextBlockId: (item: ListItemBlock) => string;
  resolveRootTextBlockContext: (state: EditorState) => RootTextBlockContext | null;
  resolveTrailingTextBlockId: (block: Block) => string;
};

export function splitTextBlockOperation(
  state: EditorState,
  helpers: BlockHelpers,
) {
  const selection = helpers.normalizeSelection(state.documentEditor, state.selection);

  if (
    selection.start.regionId !== selection.end.regionId ||
    selection.start.offset !== selection.end.offset
  ) {
    return null;
  }

  const context = helpers.resolveRootTextBlockContext(state);

  if (!context) {
    return splitBlockquoteTextBlockOperation(state, helpers);
  }

  const beforeText = context.container.text.slice(0, selection.start.offset);
  const afterText = context.container.text.slice(selection.start.offset);
  const focusRootIndex =
    selection.start.offset === 0 && context.container.text.length > 0
      ? context.rootIndex
      : context.rootIndex + 1;

  if (context.block.type === "paragraph") {
    const insertedParagraph = createParagraphTextBlock({
      text: afterText,
    });
    const replacementBlocks =
      selection.start.offset === 0
        ? [createParagraphTextBlock({
            text: "",
          }), context.block]
        : selection.start.offset === context.container.text.length
          ? [context.block, createParagraphTextBlock({
              text: "",
            })]
          : [createParagraphTextBlock({
              text: beforeText,
            }), insertedParagraph];
    return helpers.replaceRootRange(
      state,
      context.rootIndex,
      1,
      replacementBlocks,
      helpers.focusRootPrimaryRegion(focusRootIndex),
    );
  }

  const nextHeading = createHeadingTextBlock({
    depth: context.block.depth,
    text: beforeText,
  });
  const insertedParagraph = createParagraphTextBlock({
    text: afterText,
  });
  const replacementBlocks =
    selection.start.offset === 0
      ? [createParagraphTextBlock({
          text: "",
        }), context.block]
      : selection.start.offset === context.container.text.length
        ? [context.block, createParagraphTextBlock({
            text: "",
          })]
        : [nextHeading, insertedParagraph];
  return helpers.replaceRootRange(
    state,
    context.rootIndex,
    1,
    replacementBlocks,
    helpers.focusRootPrimaryRegion(focusRootIndex),
  );
}

export function splitBlockquoteTextBlockOperation(
  state: EditorState,
  helpers: BlockHelpers,
) {
  const selection = helpers.normalizeSelection(state.documentEditor, state.selection);

  if (
    selection.start.regionId !== selection.end.regionId ||
    selection.start.offset !== selection.end.offset
  ) {
    return null;
  }

  const context = helpers.resolveBlockquoteTextBlockContext(state);

  if (!context) {
    return null;
  }

  const text = context.container.text;
  const beforeText = text.slice(0, selection.start.offset);
  const afterText = text.slice(selection.start.offset);
  const replacementBlocks =
    context.block.type === "heading"
      ? buildHeadingSplitReplacement(
          context.block,
          beforeText,
          afterText,
          context.blockChildIndices,
          selection.start.offset,
          text.length,
        )
      : buildParagraphSplitReplacement(
          context.block,
          beforeText,
          afterText,
          context.blockChildIndices,
          selection.start.offset,
          text.length,
        );
  const nextQuoteChildren = [
    ...context.quote.children.slice(0, context.childIndex),
    ...replacementBlocks.blocks,
    ...context.quote.children.slice(context.childIndex + 1),
  ];
  const nextQuote = createBlockquoteBlock({
    children: nextQuoteChildren,
  });
  return helpers.applyRootBlockReplacement(
    state,
    context.rootIndex,
    nextQuote,
    helpers.focusDescendantPrimaryRegion(context.rootIndex, replacementBlocks.focusChildIndices),
  );
}

export function splitStructuralBlockquoteOperation(
  state: EditorState,
  helpers: BlockHelpers,
) {
  const selection = helpers.normalizeSelection(state.documentEditor, state.selection);

  if (
    selection.start.regionId !== selection.end.regionId ||
    selection.start.offset !== 0 ||
    selection.end.offset !== 0
  ) {
    return null;
  }

  const context = helpers.resolveBlockquoteTextBlockContext(state);

  if (!context || context.container.text.length !== 0 || context.block.type !== "paragraph") {
    return null;
  }

  const beforeBlocks = context.quote.children.slice(0, context.childIndex);
  const afterBlocks = context.quote.children.slice(context.childIndex + 1);
  const replacements: Block[] = [];

  if (beforeBlocks.length > 0) {
    replacements.push(createBlockquoteBlock({
      children: beforeBlocks,
    }));
  }

  replacements.push(createParagraphTextBlock({
    text: "",
  }));

  if (afterBlocks.length > 0) {
    replacements.push(createBlockquoteBlock({
      children: afterBlocks,
    }));
  }

  return helpers.replaceRootRange(
    state,
    context.rootIndex,
    1,
    replacements,
    helpers.focusRootPrimaryRegion(context.rootIndex + (beforeBlocks.length > 0 ? 1 : 0)),
  );
}

export function insertCodeLineBreakOperation(state: EditorState, helpers: BlockHelpers) {
  const selection = helpers.normalizeSelection(state.documentEditor, state.selection);

  if (
    selection.start.regionId !== selection.end.regionId ||
    selection.start.regionId !== state.selection.anchor.regionId
  ) {
    return null;
  }

  const container = state.documentEditor.regions.find((entry) => entry.id === selection.start.regionId);

  if (!container || container.blockType !== "code") {
    return null;
  }

  return helpers.replaceSelectionText(state, "\n");
}

export function handleBlockStructuralBackspaceOperation(state: EditorState, helpers: BlockHelpers) {
  const context = helpers.resolveRootTextBlockContext(state);

  const demotedHeadingState = context ? demoteHeadingToParagraphOperation(state, context, helpers) : null;

  if (demotedHeadingState) {
    return demotedHeadingState;
  }

  if (context && context.rootIndex > 0) {
    const previousRoot = state.documentEditor.document.blocks[context.rootIndex - 1];
    const nextRoot = state.documentEditor.document.blocks[context.rootIndex + 1];

    if (previousRoot) {
      if (context.block.plainText.length === 0) {
        const mergedAdjacentListsState = mergeAdjacentListsAroundEmptyParagraph(
          state,
          context,
          previousRoot,
          nextRoot,
          helpers,
        );

        if (mergedAdjacentListsState) {
          return mergedAdjacentListsState;
        }

        const nextState = helpers.replaceRootRange(state, context.rootIndex, 1, []);

        return nextState
          ? helpers.focusBlockContainerEnd(nextState, helpers.resolveTrailingTextBlockId(previousRoot))
          : null;
      }

      if (previousRoot.type === "paragraph") {
        const merged = createParagraphTextBlock({
          text: `${previousRoot.plainText}${context.block.plainText}`,
        });
        return helpers.replaceRootRange(
          state,
          context.rootIndex - 1,
          2,
          [merged],
          helpers.focusRootPrimaryRegion(context.rootIndex - 1, "end"),
        );
      }

      if (previousRoot.type === "heading") {
        const merged = createHeadingTextBlock({
          depth: previousRoot.depth,
          text: `${previousRoot.plainText}${context.block.plainText}`,
        });
        return helpers.replaceRootRange(
          state,
          context.rootIndex - 1,
          2,
          [merged],
          helpers.focusRootPrimaryRegion(context.rootIndex - 1, "end"),
        );
      }

      if (previousRoot.type === "list") {
        const lastIndex = previousRoot.children.length - 1;
        const lastItem = previousRoot.children[lastIndex];

        if (lastItem) {
          const mergedLastItem = helpers.replaceListItemLeadingParagraphText(
            lastItem,
            `${lastItem.plainText}${context.block.plainText}`,
          );

          if (mergedLastItem) {
            const nextList = rebuildListBlock(
              previousRoot,
              previousRoot.children.map((child, index) => (index === lastIndex ? mergedLastItem : child)),
            );
            const nextState = helpers.replaceRootRange(state, context.rootIndex - 1, 2, [nextList]);

            return nextState
              ? helpers.focusBlockContainerEnd(nextState, helpers.resolvePrimaryTextBlockId(mergedLastItem))
              : null;
          }
        }
      }
    }
  }

  const emptyQuoteLineState = deleteEmptyBlockquoteLine(state, helpers);

  if (emptyQuoteLineState) {
    return emptyQuoteLineState;
  }

  const quoteContext = helpers.resolveBlockquoteContext(state);

  if (!quoteContext) {
    return null;
  }

  const blockContext = helpers.resolveBlockquoteTextBlockContext(state);

  return helpers.replaceRootRange(
    state,
    quoteContext.rootIndex,
    1,
    quoteContext.quote.children,
    blockContext
      ? helpers.focusRootPrimaryRegion(quoteContext.rootIndex + blockContext.childIndex)
      : helpers.focusRootPrimaryRegion(quoteContext.rootIndex),
  );
}

function mergeAdjacentListsAroundEmptyParagraph(
  state: EditorState,
  context: RootTextBlockContext,
  previousRoot: Block,
  nextRoot: Block | undefined,
  helpers: BlockHelpers,
) {
  if (
    context.block.type !== "paragraph" ||
    context.block.plainText.length !== 0 ||
    previousRoot.type !== "list" ||
    nextRoot?.type !== "list" ||
    !areCompatibleAdjacentLists(previousRoot, nextRoot)
  ) {
    return null;
  }

  const mergedList = rebuildListBlock(previousRoot, [
    ...previousRoot.children,
    ...nextRoot.children,
  ]);
  const previousTrailingItemIndex = previousRoot.children.length - 1;

  return helpers.replaceRootRange(
    state,
    context.rootIndex - 1,
    3,
    [mergedList],
    helpers.focusDescendantPrimaryRegion(
      context.rootIndex - 1,
      [previousTrailingItemIndex, 0],
      "end",
    ),
  );
}

function areCompatibleAdjacentLists(left: ListBlock, right: ListBlock) {
  return left.ordered === right.ordered && left.start === right.start;
}

export function shiftHeadingDepthOperation(
  state: EditorState,
  direction: -1 | 1,
  helpers: BlockHelpers,
) {
  const context = helpers.resolveRootTextBlockContext(state);

  if (!context || context.block.type !== "heading") {
    return null;
  }

  const nextDepth = Math.max(1, Math.min(6, context.block.depth + direction)) as HeadingBlock["depth"];

  if (nextDepth === context.block.depth) {
    return state;
  }

  const replacement = createHeadingTextBlock({
    depth: nextDepth,
    text: context.block.plainText,
  });
  const nextState = helpers.applyRootBlockReplacement(
    state,
    context.rootIndex,
    replacement,
    helpers.focusRootPrimaryRegion(context.rootIndex, state.selection.focus.offset),
  );

  if (!nextState) {
    return null;
  }
  return nextState;
}

function demoteHeadingToParagraphOperation(
  state: EditorState,
  context: RootTextBlockContext,
  helpers: BlockHelpers,
) {
  if (context.block.type !== "heading") {
    return null;
  }

  const paragraph = createParagraphTextBlock({
    text: context.block.plainText,
  });
  return helpers.applyRootBlockReplacement(
    state,
    context.rootIndex,
    paragraph,
    helpers.focusRootPrimaryRegion(context.rootIndex),
  );
}

function deleteEmptyBlockquoteLine(
  state: EditorState,
  helpers: BlockHelpers,
) {
  const selection = helpers.normalizeSelection(state.documentEditor, state.selection);

  if (
    selection.start.regionId !== selection.end.regionId ||
    selection.start.offset !== 0 ||
    selection.end.offset !== 0
  ) {
    return null;
  }

  const context = helpers.resolveBlockquoteTextBlockContext(state);

  if (!context || context.block.type !== "paragraph" || context.container.text.length !== 0) {
    return null;
  }

  if (context.quote.children.length === 1) {
    return helpers.replaceRootRange(
      state,
      context.rootIndex,
      1,
      [createParagraphTextBlock({ text: "" })],
      helpers.focusRootPrimaryRegion(context.rootIndex),
    );
  }

  const nextChildren = context.quote.children.filter((_, index) => index !== context.childIndex);
  const nextQuote = createBlockquoteBlock({
    children: nextChildren,
  });
  const focusChildIndex = Math.max(0, context.childIndex - 1);
  const focusOffset = context.childIndex > 0 ? "end" : 0;

  return helpers.applyRootBlockReplacement(
    state,
    context.rootIndex,
    nextQuote,
    helpers.focusDescendantPrimaryRegion(context.rootIndex, [focusChildIndex], focusOffset),
  );
}

function buildParagraphSplitReplacement(
  block: ParagraphBlock,
  beforeText: string,
  afterText: string,
  blockChildIndices: number[],
  offset: number,
  textLength: number,
) {
  const blocks =
    offset === 0
        ? [createParagraphTextBlock({
          text: "",
        }), block]
      : offset === textLength
        ? [block, createParagraphTextBlock({
            text: "",
          })]
        : [
            createParagraphTextBlock({
              text: beforeText,
            }),
            createParagraphTextBlock({
              text: afterText,
            }),
          ];
  const focusChildIndices = offset === 0 ? blockChildIndices : [...blockChildIndices.slice(0, -1), blockChildIndices.at(-1)! + 1];

  return { blocks, focusChildIndices };
}

function buildHeadingSplitReplacement(
  block: HeadingBlock,
  beforeText: string,
  afterText: string,
  blockChildIndices: number[],
  offset: number,
  textLength: number,
) {
  const blocks =
    offset === 0
      ? [createParagraphTextBlock({
          text: "",
        }), block]
      : offset === textLength
        ? [block, createParagraphTextBlock({
            text: "",
          })]
        : [
            createHeadingTextBlock({
              depth: block.depth,
              text: beforeText,
            }),
            createParagraphTextBlock({
              text: afterText,
            }),
          ];
  const focusChildIndices = offset === 0 ? blockChildIndices : [...blockChildIndices.slice(0, -1), blockChildIndices.at(-1)! + 1];

  return { blocks, focusChildIndices };
}
