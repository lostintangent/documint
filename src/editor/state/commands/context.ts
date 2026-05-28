import {
  childBlockPath,
  createListItemBlock,
  createParagraphTextBlock,
  rebuildListItemBlock,
  rootBlockPath,
  type Block,
  type ListBlock,
  type ListItemBlock,
  type TableBlock,
} from "@/document";
import {
  findAncestorIndexedBlock,
  resolveBlock,
  resolveBlockChildIndices,
  resolveIndexedBlock,
  resolveParentIndexedBlock,
  resolveRegion,
  resolveRootBlock,
  resolveSiblingRootBlock,
  resolveTableCellPosition,
} from "../index/query";
import { resolveInlineContainer, type InlineContainer } from "./inlines";
import type { DocumentIndex, EditableRegion } from "../index/types";
import {
  isSelectionCollapsed,
  normalizeSelection,
  resolveRegionRange,
  type EditorSelection,
} from "../selection";
import type { EditorState } from "../types";

// Semantic command context resolution. This module answers "what structural
// editing context is active at the current selection?" so commands can stay
// thin and route policy into the action layer. It also owns a small set of
// shared structural lookup/build helpers that multiple action modules reuse.

export type TextContextFacts = {
  atEnd: boolean;
  atStart: boolean;
  empty: boolean;
  offset: number;
};

export type TextRangeContext = {
  endOffset: number;
  region: EditableRegion;
  selection: EditorSelection;
  startOffset: number;
};

export type TextRangeTarget = {
  endOffset: number;
  regionId: string;
  startOffset: number;
};

export type InlineContext = TextRangeContext & {
  inlineContainer: InlineContainer;
};

export type RootTextBlockContext = TextContextFacts & {
  block: Extract<Block, { type: "heading" | "paragraph" }>;
  region: DocumentIndex["regions"][number];
  rootIndex: number;
};

export type RootBlockInsertionContext = RootTextBlockContext & {
  atStart: true;
  block: Extract<Block, { type: "paragraph" }>;
  empty: true;
  offset: 0;
};

export type BlockquoteTextBlockContext = TextContextFacts & {
  block: Extract<Block, { type: "heading" | "paragraph" }>;
  blockChildIndices: number[];
  childIndex: number;
  region: DocumentIndex["regions"][number];
  quote: Extract<Block, { type: "blockquote" }>;
  rootIndex: number;
};

export type CodeBlockContext = TextContextFacts & {
  region: EditableRegion;
  rootIndex: number;
  selection: EditorSelection;
};

export type TableCellTextContext = TextContextFacts & TableCellContext;

// A classifiable structural context for the current selection. `null` from
// the resolver means "the selection didn't classify into any known shape" —
// callers short-circuit to no-op.
export type BlockContext =
  | ({ kind: "code" } & CodeBlockContext)
  | ({ kind: "tableCell" } & TableCellTextContext)
  | ({ kind: "listItem" } & ListItemContext)
  | ({ kind: "blockquoteTextBlock" } & BlockquoteTextBlockContext)
  | ({ kind: "rootTextBlock" } & RootTextBlockContext);

export type DeletionDirection = "backward" | "forward";

export type DeletionContext =
  | ({
      atBoundary: boolean;
      direction: DeletionDirection;
      nextRoot: Block | null;
      previousRoot: Block | null;
    } & RootTextBlockContext & { kind: "rootTextBlock" })
  | ({
      atBoundary: boolean;
      direction: DeletionDirection;
      nextItem: ListItemBlock | null;
      nextRoot: Block | null;
      previousItem: ListItemBlock | null;
      previousRoot: Block | null;
    } & ListItemContext & { kind: "listItem" })
  | ({
      atBoundary: boolean;
      direction: DeletionDirection;
      nextSibling: Block | null;
      previousSibling: Block | null;
    } & BlockquoteTextBlockContext & { kind: "blockquoteTextBlock" });

// --- Command context resolvers ---

export function resolveTextRangeContext(
  state: EditorState,
  startOffset: number,
  endOffset: number,
): TextRangeContext | null {
  return resolveTargetRangeContext(state, {
    endOffset,
    regionId: state.selection.focus.regionId,
    startOffset,
  });
}

export function resolveTargetRangeContext(
  state: EditorState,
  target: TextRangeTarget,
): TextRangeContext | null {
  return resolveRegionRange(
    state.documentIndex,
    target.regionId,
    target.startOffset,
    target.endOffset,
    { allowCollapsed: true },
  );
}

export function resolveInlineTargetContext(
  state: EditorState,
  target: TextRangeTarget,
): InlineContext | null {
  const range = resolveTargetRangeContext(state, target);
  return range ? resolveInlineContextFromTextRange(state, range) : null;
}

function resolveInlineContextFromTextRange(
  state: EditorState,
  range: TextRangeContext,
): InlineContext | null {
  const inlineContainer = resolveInlineContainer(state.documentIndex, range.region.id);

  return inlineContainer ? { ...range, inlineContainer } : null;
}

export function resolveInlineContext(state: EditorState): InlineContext | null {
  const selection = normalizeSelection(state);

  if (selection.start.regionId !== selection.end.regionId) {
    return null;
  }

  const range = resolveTextRangeContext(state, selection.start.offset, selection.end.offset);

  return range ? resolveInlineContextFromTextRange(state, range) : null;
}

export function resolveBlockContext(state: EditorState): BlockContext | null {
  return resolveBlockContextFromSelection(state.documentIndex, state.selection);
}

function resolveBlockContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): BlockContext | null {
  const region = resolveRegion(documentIndex, selection.anchor.regionId);

  if (!region) {
    return null;
  }

  if (region.block.type === "code") {
    const indexedBlock = resolveIndexedBlock(documentIndex, region.block.id);
    return indexedBlock
      ? {
          kind: "code",
          region,
          rootIndex: indexedBlock.rootIndex,
          selection,
          ...resolveTextContextFacts(documentIndex, region, selection),
        }
      : null;
  }

  const tableCellContext = resolveTableCellContextFromRegion(documentIndex, region.id, selection);

  if (tableCellContext) {
    return {
      kind: "tableCell",
      ...tableCellContext,
      ...resolveTextContextFacts(documentIndex, region, selection),
    };
  }

  const listItemContext = resolveListItemContextFromSelection(documentIndex, selection);

  if (listItemContext) {
    return { kind: "listItem", ...listItemContext };
  }

  const blockquoteTextBlockContext = resolveBlockquoteTextBlockContextFromSelection(
    documentIndex,
    selection,
  );

  if (blockquoteTextBlockContext) {
    return { kind: "blockquoteTextBlock", ...blockquoteTextBlockContext };
  }

  const rootTextBlockContext = resolveRootTextBlockContextFromSelection(documentIndex, selection);

  if (rootTextBlockContext) {
    return { kind: "rootTextBlock", ...rootTextBlockContext };
  }

  return null;
}

export function resolveDeletionContext(
  state: EditorState,
  direction: DeletionDirection,
): DeletionContext | null {
  const { documentIndex, selection } = state;
  const ctx = resolveBlockContextFromSelection(documentIndex, selection);

  if (!ctx) {
    return null;
  }

  const atBoundary = direction === "backward" ? ctx.atStart : ctx.atEnd;

  switch (ctx.kind) {
    case "rootTextBlock":
      return {
        ...ctx,
        kind: "rootTextBlock",
        direction,
        atBoundary,
        previousRoot: resolveSiblingRootBlock(documentIndex, ctx.rootIndex, -1),
        nextRoot: resolveSiblingRootBlock(documentIndex, ctx.rootIndex, 1),
      };
    case "listItem":
      return {
        ...ctx,
        kind: "listItem",
        direction,
        atBoundary,
        previousItem: ctx.list.items[ctx.itemIndex - 1] ?? null,
        nextItem: ctx.list.items[ctx.itemIndex + 1] ?? null,
        previousRoot: resolveSiblingRootBlock(documentIndex, ctx.rootIndex, -1),
        nextRoot: resolveSiblingRootBlock(documentIndex, ctx.rootIndex, 1),
      };
    case "blockquoteTextBlock":
      return {
        ...ctx,
        kind: "blockquoteTextBlock",
        direction,
        atBoundary,
        previousSibling: ctx.quote.children[ctx.childIndex - 1] ?? null,
        nextSibling: ctx.quote.children[ctx.childIndex + 1] ?? null,
      };
    case "code":
    case "tableCell":
      // No structural deletion semantic for code blocks or table cells —
      // backspace/forward-delete inside these is handled by the
      // character-delete or in-region splice paths upstream.
      return null;
  }
}

// --- Shared structural lookups ---

export function findRootIndex(documentIndex: DocumentIndex, blockId: string) {
  const indexedBlock = resolveIndexedBlock(documentIndex, blockId);

  if (!indexedBlock) {
    throw new Error(`Unknown root block: ${blockId}`);
  }

  return indexedBlock.rootIndex;
}

export function resolveRootTextBlockContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): RootTextBlockContext | null {
  const region = resolveRegion(documentIndex, selection.anchor.regionId);

  if (!region) {
    return null;
  }

  const indexedBlock = resolveIndexedBlock(documentIndex, region.block.id);

  if (!indexedBlock) {
    return null;
  }

  const rootIndex = indexedBlock.rootIndex;
  const block = resolveRootBlock(documentIndex, rootIndex);

  if (!block || (block.type !== "heading" && block.type !== "paragraph")) {
    return null;
  }

  return {
    ...resolveTextContextFacts(documentIndex, region, selection),
    block,
    region,
    rootIndex,
  };
}

export function resolveRootBlockInsertionContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): RootBlockInsertionContext | null {
  const context = resolveRootTextBlockContextFromSelection(documentIndex, selection);

  if (
    !context ||
    context.block.type !== "paragraph" ||
    !context.empty ||
    !context.atStart ||
    !isSelectionCollapsed(selection)
  ) {
    return null;
  }

  return {
    ...context,
    atStart: true,
    block: context.block,
    empty: true,
    offset: 0,
  };
}

function resolveBlockquoteTextBlockContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): BlockquoteTextBlockContext | null {
  const region = resolveRegion(documentIndex, selection.anchor.regionId);

  if (!region) {
    return null;
  }

  const indexedBlock = resolveIndexedBlock(documentIndex, region.block.id);
  const indexedQuote = findAncestorIndexedBlock(
    documentIndex,
    indexedBlock?.block.id ?? null,
    "blockquote",
  );

  const indexedParent = indexedBlock ? resolveParentIndexedBlock(documentIndex, indexedBlock) : null;

  if (!indexedBlock || !indexedQuote || indexedParent?.block.id !== indexedQuote.block.id) {
    return null;
  }

  const rootIndex = indexedQuote.rootIndex;
  const rootBlock = resolveRootBlock(documentIndex, rootIndex);

  if (!rootBlock || rootBlock.type !== "blockquote") {
    return null;
  }

  const childIndex = rootBlock.children.findIndex((child) => child.id === indexedBlock.block.id);
  const block = rootBlock.children[childIndex];

  if (!block || (block.type !== "heading" && block.type !== "paragraph")) {
    return null;
  }

  return {
    ...resolveTextContextFacts(documentIndex, region, selection),
    block,
    blockChildIndices: resolveBlockChildIndices(indexedBlock),
    childIndex,
    region,
    quote: rootBlock,
    rootIndex,
  };
}

export function resolveBlockById(documentIndex: DocumentIndex, blockId: string) {
  return resolveBlock(documentIndex, blockId);
}

export type ListItemContext = TextContextFacts & {
  region: DocumentIndex["regions"][number];
  item: ListItemBlock;
  itemChildIndices: number[];
  itemIndex: number;
  list: ListBlock;
  listChildIndices: number[];
  parentItem: ListItemBlock | null;
  parentItemChildIndices: number[] | null;
  parentItemIndex: number | null;
  parentList: ListBlock | null;
  parentListChildIndices: number[] | null;
  rootIndex: number;
};

export function resolveListItemContext(state: EditorState): ListItemContext | null {
  return resolveListItemContextFromSelection(state.documentIndex, state.selection);
}

export function resolveListItemContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): ListItemContext | null {
  const region = resolveRegion(documentIndex, selection.anchor.regionId);

  if (!region) {
    return null;
  }

  const indexedParagraph = resolveIndexedBlock(documentIndex, region.block.id);
  const indexedItem = findAncestorIndexedBlock(
    documentIndex,
    indexedParagraph?.block.id ?? null,
    "listItem",
  );
  const indexedList = findAncestorIndexedBlock(documentIndex, indexedParagraph?.block.id ?? null, "list");

  if (!indexedParagraph || !indexedItem || !indexedList) {
    return null;
  }

  const list = indexedList.block;

  if (!list || list.type !== "list") {
    return null;
  }

  const itemIndex = list.items.findIndex((child) => child.id === indexedItem.block.id);
  const item = list.items[itemIndex];

  if (!item) {
    return null;
  }

  const indexedParentItem = resolveParentIndexedBlock(documentIndex, indexedList);
  const indexedParentList = indexedParentItem ? resolveParentIndexedBlock(documentIndex, indexedParentItem) : null;
  const parentItem =
    indexedParentItem?.block.type === "listItem"
      ? indexedParentItem.block
      : null;
  const parentList =
    indexedParentList?.block.type === "list"
      ? indexedParentList.block
      : null;
  const parentItemIndex =
    parentList?.type === "list" && parentItem
      ? parentList.items.findIndex((child) => child.id === parentItem.id)
      : -1;

  return {
    ...resolveTextContextFacts(documentIndex, region, selection),
    region,
    item,
    itemChildIndices: resolveBlockChildIndices(indexedItem),
    itemIndex,
    list,
    listChildIndices: resolveBlockChildIndices(indexedList),
    parentItem: parentItem?.type === "listItem" ? parentItem : null,
    parentItemChildIndices:
      indexedParentItem?.block.type === "listItem"
        ? resolveBlockChildIndices(indexedParentItem)
        : null,
    parentItemIndex: parentItemIndex >= 0 ? parentItemIndex : null,
    parentList: parentList?.type === "list" ? parentList : null,
    parentListChildIndices:
      indexedParentList?.block.type === "list" ? resolveBlockChildIndices(indexedParentList) : null,
    rootIndex: indexedList.rootIndex,
  };
}

export type TableCellContext = {
  cellIndex: number;
  documentIndex: DocumentIndex;
  inlineContainer: Extract<InlineContainer, { kind: "tableCell" }>;
  region: DocumentIndex["regions"][number];
  rootIndex: number;
  rowIndex: number;
  selection: EditorSelection;
  table: TableBlock;
};

export function resolveTableCellContext(state: EditorState): TableCellContext | null {
  return resolveTableCellContextFromRegion(
    state.documentIndex,
    state.selection.focus.regionId,
    state.selection,
  );
}

function resolveTableCellContextFromRegion(
  documentIndex: DocumentIndex,
  regionId: string,
  selection: EditorSelection,
): TableCellContext | null {
  const region = resolveRegion(documentIndex, regionId);

  if (!region) {
    return null;
  }

  const tableCellPosition = resolveTableCellPosition(region);
  const indexedTable = resolveIndexedBlock(documentIndex, region.block.id);
  const table =
    indexedTable?.block.type === "table"
      ? resolveRootBlock(documentIndex, indexedTable.rootIndex)
      : null;
  const inlineContainer = resolveInlineContainer(documentIndex, region.id);

  if (
    !tableCellPosition ||
    !indexedTable ||
    !table ||
    table.type !== "table" ||
    !inlineContainer ||
    inlineContainer.kind !== "tableCell"
  ) {
    return null;
  }

  return {
    cellIndex: tableCellPosition.cellIndex,
    documentIndex,
    inlineContainer,
    region,
    rootIndex: indexedTable.rootIndex,
    rowIndex: tableCellPosition.rowIndex,
    selection,
    table,
  };
}

function resolveTextContextFacts(
  documentIndex: DocumentIndex,
  region: DocumentIndex["regions"][number],
  selection: EditorSelection,
) {
  const normalized = normalizeSelection(documentIndex, selection);
  const offset =
    normalized.start.regionId === region.id ? normalized.start.offset : selection.anchor.offset;

  return {
    atEnd: offset === region.text.length,
    atStart: offset === 0,
    empty: region.text.length === 0,
    offset,
  };
}

// --- Shared action support ---

export function createInsertedListItem(
  text: string,
  checked: boolean | null,
  spread: boolean,
): ListItemBlock {
  return createListItemBlock({
    checked,
    children: [createParagraphTextBlock(text)],
    spread,
  });
}

export function replaceListItemLeadingParagraphText(
  item: ListItemBlock,
  text: string,
): ListItemBlock | null {
  const firstChild = item.children[0];

  if (!firstChild || firstChild.type !== "paragraph") {
    return null;
  }

  return rebuildListItemBlock(item, [createParagraphTextBlock(text), ...item.children.slice(1)]);
}

export function resolveListItemPath(rootIndex: number, childIndices: number[]) {
  return childIndices.reduce(childBlockPath, rootBlockPath(rootIndex));
}
