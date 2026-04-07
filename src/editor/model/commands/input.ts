// Text-input commands that turn markdown-style triggers into semantic editor
// structure such as lists, headings, blockquotes, and thematic breaks.
import {
  createBlockquoteBlock,
  createHeadingTextBlock,
  createListBlock,
  createListItemBlock,
  createParagraphTextBlock,
  createDividerBlock,
  rebuildListBlock,
  type Block,
  type HeadingBlock,
  type ListItemBlock,
} from "@/document";
import type {
  CanvasSelection,
  DocumentEditorRegion,
  EditorSelectionTarget,
  NormalizedCanvasSelection,
} from "../document-editor";
import type { EditorState } from "../state";

type InputRuleHelpers = {
  applyBlockReplacement: (
    state: EditorState,
    targetBlockId: string,
    replacement: Block,
    selection?: CanvasSelection | EditorSelectionTarget,
  ) => EditorState | null;
  applyRootBlockReplacement: (
    state: EditorState,
    rootIndex: number,
    replacement: Block,
    selection?: CanvasSelection | EditorSelectionTarget,
  ) => EditorState;
  extractListContext: (state: EditorState) => {
    container: DocumentEditorRegion;
    item: ListItemBlock;
    itemChildIndices: number[];
    itemIndex: number;
    list: Extract<Block, { type: "list" }>;
    listChildIndices: number[];
    rootIndex: number;
  } | null;
  findRootIndex: (state: EditorState, blockId: string) => number;
  focusBlockContainer: (state: EditorState, blockId: string) => EditorState;
  focusDescendantPrimaryRegion: (
    rootIndex: number,
    childIndices: number[],
    offset?: number | "end",
  ) => EditorSelectionTarget;
  focusRootPrimaryRegion: (
    rootIndex: number,
    offset?: number | "end",
  ) => EditorSelectionTarget;
  isRootParagraphInputRuleTarget: (
    state: EditorState,
    container: DocumentEditorRegion,
  ) => boolean;
  normalizeSelection: (
    documentEditor: EditorState["documentEditor"],
    selection: EditorState["selection"],
  ) => NormalizedCanvasSelection;
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
  resolvePrimaryTextBlockId: (item: ListItemBlock) => string;
  resolveRootTextBlockContext: (state: EditorState) => {
    block: Extract<Block, { type: "heading" | "paragraph" }>;
    container: DocumentEditorRegion;
    rootIndex: number;
  } | null;
};

export function applyTextInputRuleOperation(
  state: EditorState,
  text: string,
  helpers: InputRuleHelpers,
) {
  const container = state.documentEditor.regions.find(
    (entry) => entry.id === state.selection.anchor.regionId,
  );

  if (!container) {
    return null;
  }

  const normalized = helpers.normalizeSelection(state.documentEditor, state.selection);
  const prospectiveText =
    normalized.start.regionId === normalized.end.regionId &&
    normalized.start.regionId === container.id
      ? container.text.slice(0, normalized.start.offset) + text + container.text.slice(normalized.end.offset)
      : text;

  const transformRuleState = applyTransformTextInputRule(state, container, prospectiveText, helpers);

  if (transformRuleState) {
    return transformRuleState;
  }

  const creationRuleState = applyCreationTextInputRule(state, container, prospectiveText, helpers);

  if (creationRuleState) {
    return creationRuleState;
  }

  return helpers.replaceSelectionText(state, text);
}

function applyTransformTextInputRule(
  state: EditorState,
  container: DocumentEditorRegion,
  prospectiveText: string,
  helpers: InputRuleHelpers,
) {
  return (
    applyListTransformInputRule(state, container, prospectiveText, helpers) ??
    applyBlockTransformInputRule(state, container, prospectiveText, helpers)
  );
}

function applyCreationTextInputRule(
  state: EditorState,
  container: DocumentEditorRegion,
  prospectiveText: string,
  helpers: InputRuleHelpers,
) {
  return (
    applyListCreationTextInputRules(state, container, prospectiveText, helpers) ??
    applyBlockCreationTextInputRules(state, container, prospectiveText, helpers) ??
    applyThematicBreakTextInputRule(state, container, prospectiveText, helpers)
  );
}

function applyListTransformInputRule(
  state: EditorState,
  container: DocumentEditorRegion,
  prospectiveText: string,
  helpers: InputRuleHelpers,
) {
  const context = helpers.extractListContext(state);
  const transformed = parseListTransformInput(prospectiveText);

  if (!context || !transformed || context.container.id !== container.id) {
    return null;
  }

  const nextItem = helpers.replaceListItemLeadingParagraphText(
    context.item,
    transformed.text,
  );

  if (!nextItem) {
    return null;
  }

  const nextList = rebuildListBlock(
    context.list,
    context.list.children.map((item, index) => (index === context.itemIndex ? nextItem : item)),
    {
      ordered: transformed.ordered,
      start: transformed.ordered ? 1 : null,
    },
  );
  const nextState = helpers.applyBlockReplacement(state, context.list.id, nextList);

  return nextState
    ? helpers.focusBlockContainer(nextState, helpers.resolvePrimaryTextBlockId(nextItem))
    : null;
}

function applyListCreationTextInputRules(
  state: EditorState,
  container: DocumentEditorRegion,
  prospectiveText: string,
  helpers: InputRuleHelpers,
) {
  if (!helpers.isRootParagraphInputRuleTarget(state, container)) {
    return null;
  }

  const taskMatch = /^\s*([-+*])\s\[( |x|X)\]\s$/.exec(prospectiveText);

  if (taskMatch) {
    const checked = prospectiveText.toLowerCase().includes("[x]");

    return replaceRootParagraphWithList(state, container, {
      checked,
      ordered: false,
      start: null,
    }, helpers);
  }

  if (/^\s*[-+*]\s$/.test(prospectiveText)) {
    return replaceRootParagraphWithList(state, container, {
      checked: null,
      ordered: false,
      start: null,
    }, helpers);
  }

  const orderedMatch = /^\s*(\d+)\.\s$/.exec(prospectiveText);

  if (orderedMatch) {
    return replaceRootParagraphWithList(state, container, {
      checked: null,
      ordered: true,
      start: Number(orderedMatch[1]),
    }, helpers);
  }

  return null;
}

function applyBlockTransformInputRule(
  state: EditorState,
  container: DocumentEditorRegion,
  prospectiveText: string,
  helpers: InputRuleHelpers,
) {
  const context = helpers.resolveRootTextBlockContext(state);
  const transformed = parseHeadingTransformInput(prospectiveText);

  if (
    !context ||
    context.container.id !== container.id ||
    context.block.type !== "heading" ||
    !transformed
  ) {
    return null;
  }

  const heading = createHeadingTextBlock({
    depth: transformed.depth,
    text: transformed.text,
  });
  return helpers.applyRootBlockReplacement(
    state,
    context.rootIndex,
    heading,
    helpers.focusRootPrimaryRegion(context.rootIndex),
  );
}

function parseListTransformInput(prospectiveText: string) {
  const unorderedMatch = /^[-+*]\s(.+)$/.exec(prospectiveText);

  if (unorderedMatch) {
    return {
      ordered: false as const,
      text: unorderedMatch[1]!,
    };
  }

  const orderedMatch = /^\d+\.\s(.+)$/.exec(prospectiveText);

  if (orderedMatch) {
    return {
      ordered: true as const,
      text: orderedMatch[1]!,
    };
  }

  return null;
}

function parseHeadingTransformInput(prospectiveText: string) {
  const headingMatch = /^(#{1,6})\s(.+)$/.exec(prospectiveText);

  return headingMatch
    ? {
        depth: headingMatch[1].length as HeadingBlock["depth"],
        text: headingMatch[2]!,
      }
    : null;
}

function applyBlockCreationTextInputRules(
  state: EditorState,
  container: DocumentEditorRegion,
  prospectiveText: string,
  helpers: InputRuleHelpers,
) {
  return (
    applyHeadingTextInputRule(state, container, prospectiveText, helpers) ??
    applyBlockquoteTextInputRule(state, container, prospectiveText, helpers)
  );
}

function applyHeadingTextInputRule(
  state: EditorState,
  container: DocumentEditorRegion,
  prospectiveText: string,
  helpers: InputRuleHelpers,
) {
  if (!helpers.isRootParagraphInputRuleTarget(state, container)) {
    return null;
  }

  const headingMatch = /^(#{1,6})\s$/.exec(prospectiveText);

  if (!headingMatch) {
    return null;
  }

  return replaceRootParagraphWithHeading(
    state,
    container,
    headingMatch[1].length as HeadingBlock["depth"],
    helpers,
  );
}

function applyBlockquoteTextInputRule(
  state: EditorState,
  container: DocumentEditorRegion,
  prospectiveText: string,
  helpers: InputRuleHelpers,
) {
  if (!helpers.isRootParagraphInputRuleTarget(state, container) || !/^>\s$/.test(prospectiveText)) {
    return null;
  }

  return replaceRootParagraphWithBlockquote(state, container, helpers);
}

function applyThematicBreakTextInputRule(
  state: EditorState,
  container: DocumentEditorRegion,
  prospectiveText: string,
  helpers: InputRuleHelpers,
) {
  if (!/^(?:(?:-\s?){3}|(?:\*\s?){3}|(?:_\s?){3})$/.test(prospectiveText)) {
    return null;
  }

  const paragraph = createParagraphTextBlock({
    text: "",
  });
  return helpers.replaceRootRange(
    state,
    helpers.findRootIndex(state, container.blockId),
    1,
    [
      createDividerBlock(),
      paragraph,
    ],
    helpers.focusRootPrimaryRegion(container.rootIndex + 1),
  );
}

function replaceRootParagraphWithList(
  state: EditorState,
  container: DocumentEditorRegion,
  options: {
    checked: boolean | null;
    ordered: boolean;
    start: number | null;
  },
  helpers: InputRuleHelpers,
) {
  const rootIndex = helpers.findRootIndex(state, container.blockId);
  const paragraph = createParagraphTextBlock({
    text: "",
  });
  const taskItem = createListItemBlock({
    checked: options.checked,
    children: [paragraph],
    spread: false,
  });
  const list = createListBlock({
    children: [taskItem],
    ordered: options.ordered,
    spread: false,
    start: options.start,
  });

  return helpers.applyRootBlockReplacement(
    state,
    rootIndex,
    list,
    helpers.focusDescendantPrimaryRegion(rootIndex, [0, 0]),
  );
}

function replaceRootParagraphWithHeading(
  state: EditorState,
  container: DocumentEditorRegion,
  depth: HeadingBlock["depth"],
  helpers: InputRuleHelpers,
) {
  const rootIndex = helpers.findRootIndex(state, container.blockId);
  const heading = createHeadingTextBlock({
    depth,
    text: "",
  });

  return helpers.applyRootBlockReplacement(
    state,
    rootIndex,
    heading,
    helpers.focusRootPrimaryRegion(rootIndex),
  );
}

function replaceRootParagraphWithBlockquote(
  state: EditorState,
  container: DocumentEditorRegion,
  helpers: InputRuleHelpers,
) {
  const rootIndex = helpers.findRootIndex(state, container.blockId);
  const paragraph = createParagraphTextBlock({
    text: "",
  });
  const blockquote = createBlockquoteBlock({
    children: [paragraph],
  });

  return helpers.applyRootBlockReplacement(
    state,
    rootIndex,
    blockquote,
    helpers.focusDescendantPrimaryRegion(rootIndex, [0]),
  );
}
