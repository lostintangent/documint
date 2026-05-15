import {
  childBlockPath,
  createListItemBlock,
  createParagraphTextBlock,
  findBlockById,
  rebuildListItemBlock,
  rootBlockPath,
  type Block,
  type ListBlock,
  type ListItemBlock,
  type TableBlock,
} from "@/document";
import { resolveInlineContainer, type InlineContainer } from "./inlines";
import type { DocumentIndex, EditorRegion } from "../index/types";
import { normalizeSelection, resolveRegionRange, type EditorSelection } from "../selection";
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
  region: EditorRegion;
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

export type BlockquoteTextBlockContext = TextContextFacts & {
  block: Extract<Block, { type: "heading" | "paragraph" }>;
  blockChildIndices: number[];
  childIndex: number;
  region: DocumentIndex["regions"][number];
  quote: Extract<Block, { type: "blockquote" }>;
  rootIndex: number;
};

export type CodeBlockContext = TextContextFacts & {
  region: EditorRegion;
  rootIndex: number;
  selection: EditorSelection;
};

export type TableCellTextContext = TextContextFacts & TableCellContext;

export type BlockContext =
  | ({ kind: "code" } & CodeBlockContext)
  | ({ kind: "tableCell" } & TableCellTextContext)
  | ({ kind: "listItem" } & ListItemContext)
  | ({ kind: "blockquoteTextBlock" } & BlockquoteTextBlockContext)
  | ({ kind: "rootTextBlock" } & RootTextBlockContext)
  | { kind: "unsupported" };

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
    } & BlockquoteTextBlockContext & { kind: "blockquoteTextBlock" })
  | {
      atBoundary: false;
      direction: DeletionDirection;
      kind: "unsupported";
    };

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

export function resolveBlockContext(state: EditorState): BlockContext {
  return resolveBlockContextFromSelection(state.documentIndex, state.selection);
}

function resolveBlockContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): BlockContext {
  const region = documentIndex.regionIndex.get(selection.anchor.regionId);

  if (!region) {
    return { kind: "unsupported" };
  }

  if (region.blockType === "code") {
    const blockEntry = documentIndex.blockIndex.get(region.blockId);
    return blockEntry
      ? {
          kind: "code",
          region,
          rootIndex: blockEntry.rootIndex,
          selection,
          ...resolveTextContextFacts(documentIndex, region, selection),
        }
      : { kind: "unsupported" };
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

  return { kind: "unsupported" };
}

export function resolveDeletionContext(
  state: EditorState,
  direction: DeletionDirection,
): DeletionContext {
  const { documentIndex, selection } = state;
  const ctx = resolveBlockContextFromSelection(documentIndex, selection);
  const atBoundary =
    ctx.kind === "unsupported" ? false : direction === "backward" ? ctx.atStart : ctx.atEnd;

  switch (ctx.kind) {
    case "rootTextBlock":
      return {
        ...ctx,
        kind: "rootTextBlock",
        direction,
        atBoundary,
        previousRoot: documentIndex.document.blocks[ctx.rootIndex - 1] ?? null,
        nextRoot: documentIndex.document.blocks[ctx.rootIndex + 1] ?? null,
      };
    case "listItem":
      return {
        ...ctx,
        kind: "listItem",
        direction,
        atBoundary,
        previousItem: ctx.list.items[ctx.itemIndex - 1] ?? null,
        nextItem: ctx.list.items[ctx.itemIndex + 1] ?? null,
        previousRoot: documentIndex.document.blocks[ctx.rootIndex - 1] ?? null,
        nextRoot: documentIndex.document.blocks[ctx.rootIndex + 1] ?? null,
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
    default:
      return { kind: "unsupported", direction, atBoundary: false };
  }
}

// --- Shared structural lookups ---

export function findRootIndex(documentIndex: DocumentIndex, blockId: string) {
  const blockEntry = documentIndex.blockIndex.get(blockId);

  if (!blockEntry) {
    throw new Error(`Unknown root block: ${blockId}`);
  }

  return blockEntry.rootIndex;
}

export function findAncestorBlockEntry(
  documentIndex: DocumentIndex,
  blockId: string | null,
  type: Block["type"],
) {
  let current = blockId ? (documentIndex.blockIndex.get(blockId) ?? null) : null;

  while (current) {
    if (current.type === type) {
      return current;
    }

    const parentBlockId = current.parentBlockId;

    current = parentBlockId ? (documentIndex.blockIndex.get(parentBlockId) ?? null) : null;
  }

  return null;
}

export function parseBlockChildIndices(path: string) {
  const segments = path.split(".");
  const indices: number[] = [];

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === "children") {
      const childIndex = Number(segments[index + 1]);

      if (Number.isInteger(childIndex)) {
        indices.push(childIndex);
      }
    }
  }

  return indices;
}

export function resolveRootTextBlockContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): RootTextBlockContext | null {
  const region = documentIndex.regionIndex.get(selection.anchor.regionId);

  if (!region) {
    return null;
  }

  const blockEntry = documentIndex.blockIndex.get(region.blockId);

  if (!blockEntry) {
    return null;
  }

  const rootIndex = blockEntry.rootIndex;
  const block = documentIndex.document.blocks[rootIndex];

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

function resolveBlockquoteTextBlockContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): BlockquoteTextBlockContext | null {
  const region = documentIndex.regionIndex.get(selection.anchor.regionId);

  if (!region) {
    return null;
  }

  const blockEntry = documentIndex.blockIndex.get(region.blockId);
  const quoteEntry = findAncestorBlockEntry(documentIndex, blockEntry?.id ?? null, "blockquote");

  if (!blockEntry || !quoteEntry || blockEntry.parentBlockId !== quoteEntry.id) {
    return null;
  }

  const rootIndex = quoteEntry.rootIndex;
  const rootBlock = documentIndex.document.blocks[rootIndex];

  if (!rootBlock || rootBlock.type !== "blockquote") {
    return null;
  }

  const childIndex = rootBlock.children.findIndex((child) => child.id === blockEntry.id);
  const block = rootBlock.children[childIndex];

  if (!block || (block.type !== "heading" && block.type !== "paragraph")) {
    return null;
  }

  return {
    ...resolveTextContextFacts(documentIndex, region, selection),
    block,
    blockChildIndices: parseBlockChildIndices(blockEntry.path),
    childIndex,
    region,
    quote: rootBlock,
    rootIndex,
  };
}

export function resolveBlockById(documentIndex: DocumentIndex, blockId: string) {
  return findBlockById(documentIndex.document.blocks, blockId);
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
  const region = documentIndex.regionIndex.get(selection.anchor.regionId);

  if (!region) {
    return null;
  }

  const paragraphEntry = documentIndex.blockIndex.get(region.blockId);
  const itemEntry = findAncestorBlockEntry(documentIndex, paragraphEntry?.id ?? null, "listItem");
  const listEntry = findAncestorBlockEntry(documentIndex, paragraphEntry?.id ?? null, "list");

  if (!paragraphEntry || !itemEntry || !listEntry) {
    return null;
  }

  const list = resolveBlockById(documentIndex, listEntry.id);

  if (!list || list.type !== "list") {
    return null;
  }

  const itemIndex = list.items.findIndex((child) => child.id === itemEntry.id);
  const item = list.items[itemIndex];

  if (!item) {
    return null;
  }

  const parentItemEntry = listEntry.parentBlockId
    ? (documentIndex.blockIndex.get(listEntry.parentBlockId) ?? null)
    : null;
  const parentListEntry = parentItemEntry?.parentBlockId
    ? (documentIndex.blockIndex.get(parentItemEntry.parentBlockId) ?? null)
    : null;
  const parentItem =
    parentItemEntry?.type === "listItem"
      ? resolveBlockById(documentIndex, parentItemEntry.id)
      : null;
  const parentList =
    parentListEntry?.type === "list" ? resolveBlockById(documentIndex, parentListEntry.id) : null;
  const parentItemIndex =
    parentList?.type === "list" && parentItem
      ? parentList.items.findIndex((child) => child.id === parentItem.id)
      : -1;

  return {
    ...resolveTextContextFacts(documentIndex, region, selection),
    region,
    item,
    itemChildIndices: parseBlockChildIndices(itemEntry.path),
    itemIndex,
    list,
    listChildIndices: parseBlockChildIndices(listEntry.path),
    parentItem: parentItem?.type === "listItem" ? parentItem : null,
    parentItemChildIndices:
      parentItemEntry?.type === "listItem" ? parseBlockChildIndices(parentItemEntry.path) : null,
    parentItemIndex: parentItemIndex >= 0 ? parentItemIndex : null,
    parentList: parentList?.type === "list" ? parentList : null,
    parentListChildIndices:
      parentListEntry?.type === "list" ? parseBlockChildIndices(parentListEntry.path) : null,
    rootIndex: listEntry.rootIndex,
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
  const region = documentIndex.regionIndex.get(regionId);

  if (!region) {
    return null;
  }

  const tableCellPosition = documentIndex.tableCellIndex.get(region.id);
  const tableEntry = documentIndex.blockIndex.get(region.blockId);
  const table =
    tableEntry?.type === "table" ? documentIndex.document.blocks[tableEntry.rootIndex] : null;
  const inlineContainer = resolveInlineContainer(documentIndex, region.id);

  if (
    !tableCellPosition ||
    !tableEntry ||
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
    rootIndex: tableEntry.rootIndex,
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
