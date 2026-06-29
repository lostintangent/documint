import {
  createListItemBlock,
  createParagraphTextBlock,
  rebuildListItemBlock,
  type Block,
  type CodeBlock,
  type HeadingBlock,
  type Inline,
  type ListBlock,
  type ListItemBlock,
  type ParagraphBlock,
  type TableBlock,
  type TableCell,
} from "@/document";
import {
  findAncestorIndexedBlockByPath,
  resolveIndexedBlock,
  resolveParentIndexedBlock,
  resolveRegion,
  resolveRootBlock,
  resolveSiblingRootBlock,
} from "../index/query";
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

// --- Context shapes ---

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
  regionPath: string;
  startOffset: number;
};

export type InlineContext = TextRangeContext & {
  inlineContainer: InlineContainer;
};

export type InlineContainer =
  | {
      block: HeadingBlock | ParagraphBlock;
      blockPath: string;
      children: Inline[];
      kind: "inlineBlock";
      regionPath: string;
    }
  | {
      block: TableBlock;
      blockPath: string;
      cell: TableCell;
      children: Inline[];
      kind: "tableCell";
      regionPath: string;
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
  childIndex: number;
  region: DocumentIndex["regions"][number];
  quote: Extract<Block, { type: "blockquote" }>;
  rootIndex: number;
};

export type CodeBlockContext = TextContextFacts & {
  region: EditableRegion & { block: CodeBlock };
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
    } & CodeBlockContext & { kind: "code" })
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
    regionPath: state.selection.focus.regionPath,
    startOffset,
  });
}

export function resolveTargetRangeContext(
  state: EditorState,
  target: TextRangeTarget,
): TextRangeContext | null {
  return resolveRegionRange(
    state.documentIndex,
    target.regionPath,
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

export function resolveInlineContext(state: EditorState): InlineContext | null {
  const selection = normalizeSelection(state);

  if (selection.start.regionPath !== selection.end.regionPath) {
    return null;
  }

  const range = resolveTextRangeContext(state, selection.start.offset, selection.end.offset);

  return range ? resolveInlineContextFromTextRange(state, range) : null;
}

function resolveInlineContextFromTextRange(
  state: EditorState,
  range: TextRangeContext,
): InlineContext | null {
  const inlineContainer = resolveInlineContainer(state.documentIndex, range.region.path);

  return inlineContainer ? { ...range, inlineContainer } : null;
}

function resolveInlineContainer(
  documentIndex: DocumentIndex,
  regionPath: string,
): InlineContainer | null {
  const region = resolveRegion(documentIndex, regionPath);

  return region ? resolveInlineContainerFromRegion(region.block, region) : null;
}

// Build an `InlineContainer` from a resolved document block plus its runtime
// `EditableRegion`. The region already carries the selection target path and
// table-cell position from the index, so callers never parse path strings.
function resolveInlineContainerFromRegion(
  block: Block,
  region: EditableRegion,
): InlineContainer | null {
  if (block.type === "heading" || block.type === "paragraph") {
    return {
      block,
      blockPath: region.blockPath,
      children: block.children,
      kind: "inlineBlock",
      regionPath: region.path,
    };
  }

  const tableCellPosition = region.tableCellPosition;

  if (block.type !== "table" || !tableCellPosition) {
    return null;
  }

  const { rowIndex, cellIndex } = tableCellPosition;
  const cell = block.rows[rowIndex]?.cells[cellIndex];

  return cell
    ? {
        block,
        blockPath: region.blockPath,
        cell,
        children: cell.children,
        kind: "tableCell",
        regionPath: region.path,
      }
    : null;
}

export function resolveBlockContext(state: EditorState): BlockContext | null {
  return resolveBlockContextFromSelection(state.documentIndex, state.selection);
}

function resolveBlockContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): BlockContext | null {
  const region = resolveRegion(documentIndex, selection.anchor.regionPath);

  if (!region) {
    return null;
  }

  if (region.block.type === "code") {
    const indexedBlock = resolveIndexedBlock(documentIndex, region.blockPath);
    const codeRegion = region as EditableRegion & { block: CodeBlock };
    return indexedBlock
      ? {
          kind: "code",
          region: codeRegion,
          rootIndex: indexedBlock.rootIndex,
          selection,
          ...resolveTextContextFacts(documentIndex, region, selection),
        }
      : null;
  }

  const tableCellContext = resolveTableCellContextFromRegion(documentIndex, region.path, selection);

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
      return {
        ...ctx,
        kind: "code",
        direction,
        atBoundary,
      };
    case "tableCell":
      // No structural deletion semantic for table cells — backspace/forward-
      // delete inside them is handled by character-delete or in-region splice
      // paths upstream.
      return null;
  }
}

// --- Structural context resolvers ---

export function resolveRootTextBlockContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): RootTextBlockContext | null {
  const region = resolveRegion(documentIndex, selection.anchor.regionPath);

  if (!region) {
    return null;
  }

  const indexedBlock = resolveIndexedBlock(documentIndex, region.blockPath);

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
  const region = resolveRegion(documentIndex, selection.anchor.regionPath);

  if (!region) {
    return null;
  }

  const indexedBlock = resolveIndexedBlock(documentIndex, region.blockPath);
  const indexedQuote = findAncestorIndexedBlockByPath(
    documentIndex,
    indexedBlock?.path ?? null,
    "blockquote",
  );

  const indexedParent = indexedBlock
    ? resolveParentIndexedBlock(documentIndex, indexedBlock)
    : null;

  if (!indexedBlock || !indexedQuote || indexedParent?.path !== indexedQuote.path) {
    return null;
  }

  const rootIndex = indexedQuote.rootIndex;
  const rootBlock = resolveRootBlock(documentIndex, rootIndex);

  if (!rootBlock || rootBlock.type !== "blockquote") {
    return null;
  }

  const childIndex = rootBlock.children.findIndex((child) => child === indexedBlock.block);
  const block = rootBlock.children[childIndex];

  if (!block || (block.type !== "heading" && block.type !== "paragraph")) {
    return null;
  }

  return {
    ...resolveTextContextFacts(documentIndex, region, selection),
    block,
    childIndex,
    region,
    quote: rootBlock,
    rootIndex,
  };
}

export type ListParentContext = {
  item: ListItemBlock;
  itemIndex: number;
  list: ListBlock;
  listPath: string;
};

export type ListItemContext = TextContextFacts & {
  region: DocumentIndex["regions"][number];
  item: ListItemBlock;
  itemIndex: number;
  list: ListBlock;
  listPath: string;
  parent: ListParentContext | null;
  rootIndex: number;
};

export function resolveListItemContext(state: EditorState): ListItemContext | null {
  return resolveListItemContextFromSelection(state.documentIndex, state.selection);
}

export function resolveListItemContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): ListItemContext | null {
  const region = resolveRegion(documentIndex, selection.anchor.regionPath);

  if (!region) {
    return null;
  }

  const indexedParagraph = resolveIndexedBlock(documentIndex, region.blockPath);
  const indexedItem = findAncestorIndexedBlockByPath(
    documentIndex,
    indexedParagraph?.path ?? null,
    "listItem",
  );
  const indexedList = findAncestorIndexedBlockByPath(
    documentIndex,
    indexedParagraph?.path ?? null,
    "list",
  );

  if (!indexedParagraph || !indexedItem || !indexedList) {
    return null;
  }

  const list = indexedList.block;

  if (!list || list.type !== "list") {
    return null;
  }

  const itemIndex = list.items.findIndex((child) => child === indexedItem.block);
  const item = list.items[itemIndex];

  if (!item) {
    return null;
  }

  const indexedParentItem = resolveParentIndexedBlock(documentIndex, indexedList);
  const indexedParentList = indexedParentItem
    ? resolveParentIndexedBlock(documentIndex, indexedParentItem)
    : null;
  const parentItem = indexedParentItem?.block.type === "listItem" ? indexedParentItem.block : null;
  const parentList = indexedParentList?.block.type === "list" ? indexedParentList.block : null;
  const parentItemIndex =
    parentList && parentItem
      ? parentList.items.findIndex((child) => child === parentItem)
      : -1;
  const parent =
    parentItem && parentList && indexedParentList && parentItemIndex >= 0
      ? {
          item: parentItem,
          itemIndex: parentItemIndex,
          list: parentList,
          listPath: indexedParentList.path,
        }
      : null;

  return {
    ...resolveTextContextFacts(documentIndex, region, selection),
    region,
    item,
    itemIndex,
    list,
    listPath: indexedList.path,
    parent,
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
  tablePath: string;
};

export function resolveTableCellContext(state: EditorState): TableCellContext | null {
  return resolveTableCellContextFromRegion(
    state.documentIndex,
    state.selection.focus.regionPath,
    state.selection,
  );
}

function resolveTableCellContextFromRegion(
  documentIndex: DocumentIndex,
  regionPath: string,
  selection: EditorSelection,
): TableCellContext | null {
  const region = resolveRegion(documentIndex, regionPath);

  if (!region) {
    return null;
  }

  const tableCellPosition = region.tableCellPosition;
  const indexedTable = resolveIndexedBlock(documentIndex, region.blockPath);
  const table =
    indexedTable?.block.type === "table"
      ? resolveRootBlock(documentIndex, indexedTable.rootIndex)
      : null;
  const inlineContainer = resolveInlineContainer(documentIndex, region.path);

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
    tablePath: indexedTable.path,
  };
}

function resolveTextContextFacts(
  documentIndex: DocumentIndex,
  region: DocumentIndex["regions"][number],
  selection: EditorSelection,
) {
  const normalized = normalizeSelection(documentIndex, selection);
  const offset =
    normalized.start.regionPath === region.path ? normalized.start.offset : selection.anchor.offset;

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
  compact: boolean,
): ListItemBlock {
  return createListItemBlock({
    checked,
    children: [createParagraphTextBlock(text)],
    compact,
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
