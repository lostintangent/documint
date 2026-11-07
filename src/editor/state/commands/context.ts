import {
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
} from "../index/query";
import type { DocumentIndex, IndexedBlock, IndexedTableCell } from "../index/types";
import {
  isSelectionCollapsed,
  normalizeSelection,
  type EditorSelection,
  type EditorSelectionRange,
} from "../selection";
import type { DeletionDirection } from "../effects";
import type { EditorState } from "../types";

// Semantic command context resolution. This module answers "what structural
// editing context is active at the current selection?" so commands can stay
// thin and route policy into the action layer. It also owns a small set of
// shared structural lookup/build helpers that multiple action modules reuse.

// --- Context shapes ---

type TextContextFacts = {
  atEnd: boolean;
  atStart: boolean;
  empty: boolean;
  offset: number;
  text: string;
};

export type InlineContext = EditorSelectionRange & {
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
  path: string;
  rootIndex: number;
};

export type BlockquoteTextBlockContext = TextContextFacts & {
  block: Extract<Block, { type: "heading" | "paragraph" }>;
  childIndex: number;
  path: string;
  quote: Extract<Block, { type: "blockquote" }>;
  rootIndex: number;
};

export type CodeBlockContext = TextContextFacts & {
  block: CodeBlock;
  path: string;
  rootIndex: number;
};

// A classifiable structural context for the current selection. `null` from
// the resolver means "the selection didn't classify into any known shape" —
// callers short-circuit to no-op.
export type BlockContext =
  | ({ kind: "code" } & CodeBlockContext)
  | ({ kind: "tableCell" } & TableCellContext)
  | ({ kind: "listItem" } & ListItemContext)
  | ({ kind: "blockquoteTextBlock" } & BlockquoteTextBlockContext)
  | ({ kind: "rootTextBlock" } & RootTextBlockContext);

export type DeletionContext = Exclude<BlockContext, { kind: "tableCell" }> & {
  atBoundary: boolean;
  direction: DeletionDirection;
};

// --- Command context resolvers ---

// Clamps a same-path text range to the current text at `target.path`.
export function resolveTextRange(
  state: EditorState,
  target: EditorSelectionRange,
): EditorSelectionRange | null {
  const text = resolveEditorTextAtPath(state.documentIndex, target.path);

  if (text === null || target.startOffset > target.endOffset) {
    return null;
  }

  return {
    endOffset: clampOffset(target.endOffset, text.length),
    path: target.path,
    startOffset: clampOffset(target.startOffset, text.length),
  };
}

export function resolveInlineTargetContext(
  state: EditorState,
  target: EditorSelectionRange,
): InlineContext | null {
  const range = resolveTextRange(state, target);
  const inlineContainer = range && resolveInlineContainer(state.documentIndex, range.path);

  return range && inlineContainer ? { ...range, inlineContainer } : null;
}

export function resolveInlineContext(state: EditorState): InlineContext | null {
  const { end, start } = normalizeSelection(state);

  return start.path === end.path
    ? resolveInlineTargetContext(state, {
        endOffset: end.offset,
        path: start.path,
        startOffset: start.offset,
      })
    : null;
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
    return { kind: "tableCell", ...tableCellContext };
  }

  if (indexedBlock?.block.type === "code") {
    return {
      kind: "code",
      block: indexedBlock.block,
      path,
      rootIndex: indexedBlock.rootIndex,
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
  const ctx = resolveBlockContextFromSelection(state.documentIndex, state.selection);

  // No structural deletion semantic for table cells — backspace/forward-delete
  // inside them is handled by character-delete or same-path splice paths
  // upstream.
  if (!ctx || ctx.kind === "tableCell") {
    return null;
  }

  return {
    ...ctx,
    atBoundary: direction === "backward" ? ctx.atStart : ctx.atEnd,
    direction,
  };
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
    path,
    rootIndex,
  };
}

// Root block insertions (code fence, table) replace an empty root paragraph.
export function resolveRootBlockInsertionContext(state: EditorState): RootTextBlockContext | null {
  const context = resolveRootTextBlockContextFromSelection(state.documentIndex, state.selection);

  return context?.block.type === "paragraph" &&
    context.empty &&
    context.atStart &&
    isSelectionCollapsed(state.selection)
    ? context
    : null;
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
    childIndex,
    path,
    quote: rootBlock,
    rootIndex,
  };
}

type ListParentContext = {
  item: ListItemBlock;
  itemIndex: number;
  list: ListBlock;
  listPath: string;
};

export type ListItemContext = TextContextFacts & {
  // The text block's index among the item's children, or -1 when it sits
  // deeper, as in a quote inside the item.
  childIndex: number;
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
    childIndex: item.children.indexOf(indexedParagraph.block),
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
