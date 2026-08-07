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
  resolveEditorTextAtPath,
  resolveIndexedBlockContainingPath,
  resolveIndexedTableCell,
  resolveParentIndexedBlock,
  resolveRootBlock,
  resolveSiblingRootBlock,
} from "../index/query";
import type { DocumentIndex, IndexedBlock, IndexedTableCell } from "../index/types";
import { isSelectionCollapsed, normalizeSelection, type EditorSelection } from "../selection";
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
  text: string;
};

export type TextRangeContext = {
  endOffset: number;
  path: string;
  selection: EditorSelection;
  startOffset: number;
};

export type TextRangeTarget = {
  endOffset: number;
  path: string;
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
      path: string;
    }
  | {
      block: TableBlock;
      blockPath: string;
      cell: TableCell;
      children: Inline[];
      kind: "tableCell";
      path: string;
    };

export type RootTextBlockContext = TextContextFacts & {
  block: Extract<Block, { type: "heading" | "paragraph" }>;
  blockPath: string;
  path: string;
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
  blockPath: string;
  childIndex: number;
  path: string;
  quote: Extract<Block, { type: "blockquote" }>;
  rootIndex: number;
};

export type CodeBlockContext = TextContextFacts & {
  block: CodeBlock;
  blockPath: string;
  path: string;
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
    path: state.selection.focus.path,
    startOffset,
  });
}

export function resolveTargetRangeContext(
  state: EditorState,
  target: TextRangeTarget,
): TextRangeContext | null {
  const text = resolveEditorTextAtPath(state.documentIndex, target.path);

  if (text === null || target.startOffset > target.endOffset) {
    return null;
  }

  const start = clampOffset(target.startOffset, text.length);
  const end = clampOffset(target.endOffset, text.length);

  return {
    endOffset: end,
    path: target.path,
    selection: {
      anchor: { path: target.path, offset: start },
      focus: { path: target.path, offset: end },
    },
    startOffset: start,
  };
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

  if (selection.start.path !== selection.end.path) {
    return null;
  }

  const range = resolveTextRangeContext(state, selection.start.offset, selection.end.offset);

  return range ? resolveInlineContextFromTextRange(state, range) : null;
}

function resolveInlineContextFromTextRange(
  state: EditorState,
  range: TextRangeContext,
): InlineContext | null {
  const inlineContainer = resolveInlineContainer(state.documentIndex, range.path);

  return inlineContainer ? { ...range, inlineContainer } : null;
}

function resolveInlineContainer(
  documentIndex: DocumentIndex,
  path: string,
): InlineContainer | null {
  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);
  if (!indexedBlock) {
    return null;
  }

  const indexedCell =
    path === indexedBlock.path ? null : resolveIndexedTableCell(documentIndex, path);

  if (indexedCell) {
    const table = indexedBlock.block;
    const cell = indexedCell.cell;

    return table.type === "table" && cell
      ? {
          block: table,
          blockPath: indexedBlock.path,
          cell,
          children: cell.children,
          kind: "tableCell",
          path,
        }
      : null;
  }

  const block = indexedBlock.block;

  if (block.type === "heading" || block.type === "paragraph") {
    return {
      block,
      blockPath: indexedBlock.path,
      children: block.children,
      kind: "inlineBlock",
      path,
    };
  }

  return null;
}

export function resolveBlockContext(state: EditorState): BlockContext | null {
  return resolveBlockContextFromSelection(state.documentIndex, state.selection);
}

function resolveBlockContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): BlockContext | null {
  const path = selection.anchor.path;
  const text = resolveEditorTextAtPath(documentIndex, path);
  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);

  if (!indexedBlock || text === null) {
    return null;
  }

  const tableCellContext = resolveTableCellContextFromIndexedBlock(
    documentIndex,
    indexedBlock,
    path,
    selection,
  );

  if (tableCellContext) {
    return {
      kind: "tableCell",
      ...tableCellContext,
      ...resolveTextContextFacts(documentIndex, path, text, selection),
    };
  }

  if (indexedBlock?.block.type === "code") {
    return {
      kind: "code",
      block: indexedBlock.block,
      blockPath: indexedBlock.path,
      path,
      rootIndex: indexedBlock.rootIndex,
      selection,
      ...resolveTextContextFacts(documentIndex, path, text, selection),
    };
  }

  const listItemContext = resolveListItemContextFromIndexedBlock(
    documentIndex,
    selection,
    indexedBlock,
    path,
    text,
  );

  if (listItemContext) {
    return { kind: "listItem", ...listItemContext };
  }

  const blockquoteTextBlockContext = resolveBlockquoteTextBlockContextFromIndexedBlock(
    documentIndex,
    selection,
    indexedBlock,
    path,
    text,
  );

  if (blockquoteTextBlockContext) {
    return { kind: "blockquoteTextBlock", ...blockquoteTextBlockContext };
  }

  const rootTextBlockContext = resolveRootTextBlockContextFromIndexedBlock(
    documentIndex,
    selection,
    indexedBlock,
    path,
    text,
  );

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
      // delete inside them is handled by character-delete or same-path splice
      // paths upstream.
      return null;
  }
}

// --- Structural context resolvers ---

export function resolveRootTextBlockContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): RootTextBlockContext | null {
  const path = selection.anchor.path;
  const text = resolveEditorTextAtPath(documentIndex, path);
  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);

  return indexedBlock && text !== null
    ? resolveRootTextBlockContextFromIndexedBlock(
        documentIndex,
        selection,
        indexedBlock,
        path,
        text,
      )
    : null;
}

function resolveRootTextBlockContextFromIndexedBlock(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  indexedBlock: IndexedBlock,
  path: string,
  text: string,
): RootTextBlockContext | null {
  if (path !== indexedBlock.path) {
    return null;
  }

  const rootIndex = indexedBlock.rootIndex;
  const block = resolveRootBlock(documentIndex, rootIndex);

  if (!block || (block.type !== "heading" && block.type !== "paragraph")) {
    return null;
  }

  return {
    ...resolveTextContextFacts(documentIndex, path, text, selection),
    block,
    blockPath: indexedBlock.path,
    path,
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

function resolveBlockquoteTextBlockContextFromIndexedBlock(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  indexedBlock: IndexedBlock,
  path: string,
  text: string,
): BlockquoteTextBlockContext | null {
  if (path !== indexedBlock.path) {
    return null;
  }

  const indexedQuote = findAncestorIndexedBlockByPath(
    documentIndex,
    indexedBlock.path,
    "blockquote",
  );

  const indexedParent = resolveParentIndexedBlock(documentIndex, indexedBlock);

  if (!indexedQuote || indexedParent?.path !== indexedQuote.path) {
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
    ...resolveTextContextFacts(documentIndex, path, text, selection),
    block,
    blockPath: indexedBlock.path,
    childIndex,
    path,
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
  blockPath: string;
  item: ListItemBlock;
  itemIndex: number;
  list: ListBlock;
  listPath: string;
  parent: ListParentContext | null;
  path: string;
  rootIndex: number;
};

export function resolveListItemContext(state: EditorState): ListItemContext | null {
  return resolveListItemContextFromSelection(state.documentIndex, state.selection);
}

export function resolveListItemContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): ListItemContext | null {
  const path = selection.anchor.path;
  const text = resolveEditorTextAtPath(documentIndex, path);
  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);

  return indexedBlock && text !== null
    ? resolveListItemContextFromIndexedBlock(documentIndex, selection, indexedBlock, path, text)
    : null;
}

function resolveListItemContextFromIndexedBlock(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  indexedParagraph: IndexedBlock,
  path: string,
  text: string,
): ListItemContext | null {
  if (path !== indexedParagraph.path) {
    return null;
  }

  const indexedItem = findAncestorIndexedBlockByPath(
    documentIndex,
    indexedParagraph.path,
    "listItem",
  );
  const indexedList = findAncestorIndexedBlockByPath(documentIndex, indexedParagraph.path, "list");

  if (!indexedItem || !indexedList) {
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
    parentList && parentItem ? parentList.items.findIndex((child) => child === parentItem) : -1;
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
    ...resolveTextContextFacts(documentIndex, path, text, selection),
    blockPath: indexedParagraph.path,
    item,
    itemIndex,
    list,
    listPath: indexedList.path,
    parent,
    path,
    rootIndex: indexedList.rootIndex,
  };
}

export type TableCellContext = {
  documentIndex: DocumentIndex;
  indexedCell: IndexedTableCell;
  indexedTable: IndexedTableBlock;
  inlineContainer: Extract<InlineContainer, { kind: "tableCell" }>;
  selection: EditorSelection;
};

type IndexedTableBlock = Extract<IndexedBlock, { kind: "cells" }> & { block: TableBlock };

export function resolveTableCellContext(state: EditorState): TableCellContext | null {
  return resolveTableCellContextFromPath(
    state.documentIndex,
    state.selection.focus.path,
    state.selection,
  );
}

function resolveTableCellContextFromPath(
  documentIndex: DocumentIndex,
  path: string,
  selection: EditorSelection,
): TableCellContext | null {
  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);

  return indexedBlock
    ? resolveTableCellContextFromIndexedBlock(documentIndex, indexedBlock, path, selection)
    : null;
}

function resolveTableCellContextFromIndexedBlock(
  documentIndex: DocumentIndex,
  indexedTable: IndexedBlock,
  path: string,
  selection: EditorSelection,
): TableCellContext | null {
  const indexedCell = resolveIndexedTableCell(documentIndex, path);

  if (!indexedCell || !isIndexedTableBlock(indexedTable)) {
    return null;
  }

  const inlineContainer = {
    block: indexedTable.block,
    blockPath: indexedTable.path,
    cell: indexedCell.cell,
    children: indexedCell.cell.children,
    kind: "tableCell" as const,
    path,
  };

  return {
    documentIndex,
    indexedCell,
    indexedTable,
    inlineContainer,
    selection,
  };
}

function isIndexedTableBlock(indexedBlock: IndexedBlock): indexedBlock is IndexedTableBlock {
  return indexedBlock.kind === "cells" && indexedBlock.block.type === "table";
}

function resolveTextContextFacts(
  documentIndex: DocumentIndex,
  path: string,
  text: string,
  selection: EditorSelection,
) {
  const normalized = normalizeSelection(documentIndex, selection);
  const offset = normalized.start.path === path ? normalized.start.offset : selection.anchor.offset;

  return {
    atEnd: offset === text.length,
    atStart: offset === 0,
    empty: text.length === 0,
    offset,
    text,
  };
}

function clampOffset(offset: number, textLength: number) {
  return Math.max(0, Math.min(offset, textLength));
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
