import {
  createListItemBlock,
  createParagraphTextBlock,
  findBlockById,
  rebuildListItemBlock,
  type Block,
  type ListBlock,
  type ListItemBlock,
  type TableBlock,
} from "@/document";
import type { DocumentIndex, EditorRegion } from "./index/types";
import { normalizeSelection, type EditorSelection } from "./selection";

// Semantic command context resolution. This module answers "what structural
// editing context is active at the current selection?" so commands can stay
// thin and route policy into the action layer. It also owns a small set of
// shared structural lookup/build helpers that multiple action modules reuse.

export type CommandTextContextFacts = {
  atEnd: boolean;
  atStart: boolean;
  empty: boolean;
  offset: number;
};

export type RootTextBlockContext = CommandTextContextFacts & {
  block: Extract<Block, { type: "heading" | "paragraph" }>;
  region: DocumentIndex["regions"][number];
  rootIndex: number;
};

export type BlockquoteTextBlockContext = CommandTextContextFacts & {
  block: Extract<Block, { type: "heading" | "paragraph" }>;
  blockChildIndices: number[];
  childIndex: number;
  region: DocumentIndex["regions"][number];
  quote: Extract<Block, { type: "blockquote" }>;
  rootIndex: number;
};

export type CodeBlockCommandContext = CommandTextContextFacts & {
  region: EditorRegion;
  rootIndex: number;
};

export type TableCellCommandContext = CommandTextContextFacts & TableCellContext;

export type BlockCommandContext =
  | ({ kind: "code" } & CodeBlockCommandContext)
  | ({ kind: "tableCell" } & TableCellCommandContext)
  | ({ kind: "listItem" } & ListItemContext)
  | ({ kind: "blockquoteTextBlock" } & BlockquoteTextBlockContext)
  | ({ kind: "rootTextBlock" } & RootTextBlockContext)
  | { kind: "unsupported" };

export type DeleteDirection = "backward" | "forward";

export type DeleteCommandContext =
  | ({
      atBoundary: boolean;
      direction: DeleteDirection;
      nextRoot: Block | null;
      previousRoot: Block | null;
    } & RootTextBlockContext & { kind: "rootTextBlock" })
  | ({
      atBoundary: boolean;
      direction: DeleteDirection;
      nextItem: ListItemBlock | null;
      nextRoot: Block | null;
      previousItem: ListItemBlock | null;
      previousRoot: Block | null;
    } & ListItemContext & { kind: "listItem" })
  | ({
      atBoundary: boolean;
      direction: DeleteDirection;
      nextSibling: Block | null;
      previousSibling: Block | null;
    } & BlockquoteTextBlockContext & { kind: "blockquoteTextBlock" })
  | {
      atBoundary: false;
      direction: DeleteDirection;
      kind: "unsupported";
    };

export function resolveBlockCommandContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): BlockCommandContext {
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
          ...resolveCommandTextContextFacts(documentIndex, region, selection),
        }
      : { kind: "unsupported" };
  }

  const tableCellContext = resolveTableCellContext(documentIndex, region.id);

  if (tableCellContext) {
    return {
      kind: "tableCell",
      ...tableCellContext,
      ...resolveCommandTextContextFacts(documentIndex, region, selection),
    };
  }

  const listItemContext = resolveListItemContext(documentIndex, selection);

  if (listItemContext) {
    return { kind: "listItem", ...listItemContext };
  }

  const blockquoteTextBlockContext = resolveBlockquoteTextBlockContext(documentIndex, selection);

  if (blockquoteTextBlockContext) {
    return { kind: "blockquoteTextBlock", ...blockquoteTextBlockContext };
  }

  const rootTextBlockContext = resolveRootTextBlockContext(documentIndex, selection);

  if (rootTextBlockContext) {
    return { kind: "rootTextBlock", ...rootTextBlockContext };
  }

  return { kind: "unsupported" };
}

export function resolveDeleteCommandContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  direction: DeleteDirection,
): DeleteCommandContext {
  const ctx = resolveBlockCommandContext(documentIndex, selection);
  const atBoundary =
    ctx.kind === "unsupported"
      ? false
      : direction === "backward"
        ? ctx.atStart
        : ctx.atEnd;

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

export function resolveRootTextBlockContext(
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
    ...resolveCommandTextContextFacts(documentIndex, region, selection),
    block,
    region,
    rootIndex,
  };
}

export function resolveBlockquoteTextBlockContext(
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
    ...resolveCommandTextContextFacts(documentIndex, region, selection),
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

export type ListItemContext = CommandTextContextFacts & {
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

export function resolveListItemContext(
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
    ...resolveCommandTextContextFacts(documentIndex, region, selection),
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
  region: DocumentIndex["regions"][number];
  rootIndex: number;
  rowIndex: number;
  table: TableBlock;
};

export function resolveTableCellContext(
  documentIndex: DocumentIndex,
  regionId: string,
): TableCellContext | null {
  const region = documentIndex.regionIndex.get(regionId);

  if (!region) {
    return null;
  }

  const tableCellPosition = documentIndex.tableCellIndex.get(region.id);
  const tableEntry = documentIndex.blockIndex.get(region.blockId);
  const table =
    tableEntry?.type === "table" ? documentIndex.document.blocks[tableEntry.rootIndex] : null;

  if (!tableCellPosition || !tableEntry || !table || table.type !== "table") {
    return null;
  }

  return {
    cellIndex: tableCellPosition.cellIndex,
    region,
    rootIndex: tableEntry.rootIndex,
    rowIndex: tableCellPosition.rowIndex,
    table,
  };
}

function resolveCommandTextContextFacts(
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
    children: [
      createParagraphTextBlock({
        text,
      }),
    ],
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

  return rebuildListItemBlock(item, [
    createParagraphTextBlock({
      text,
    }),
    ...item.children.slice(1),
  ]);
}

export function resolveListItemPath(rootIndex: number, childIndices: number[]) {
  return childIndices.reduce(
    (path, childIndex) => `${path}.children.${childIndex}`,
    `root.${rootIndex}`,
  );
}
