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
import type { EditorSelection } from "./selection";

// Block tree context resolvers. Given an DocumentIndex and selection, resolves
// the structural context (list item, blockquote, table cell) needed by commands.

export type RootTextBlockContext = {
  block: Extract<Block, { type: "heading" | "paragraph" }>;
  region: DocumentIndex["regions"][number];
  rootIndex: number;
};

export type BlockquoteContext = {
  quote: Extract<Block, { type: "blockquote" }>;
  rootIndex: number;
};

export type BlockquoteTextBlockContext = {
  block: Extract<Block, { type: "heading" | "paragraph" }>;
  blockChildIndices: number[];
  childIndex: number;
  region: DocumentIndex["regions"][number];
  quote: Extract<Block, { type: "blockquote" }>;
  rootIndex: number;
};

export type CodeBlockCommandContext = {
  region: EditorRegion;
  rootIndex: number;
};

export type BlockCommandContext =
  | ({ kind: "code" } & CodeBlockCommandContext)
  | ({ kind: "tableCell" } & TableCellContext)
  | ({ kind: "listItem" } & ListItemContext)
  | ({ kind: "blockquoteTextBlock" } & BlockquoteTextBlockContext)
  | ({ kind: "rootTextBlock" } & RootTextBlockContext)
  | { kind: "unsupported" };

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
      ? { kind: "code", region, rootIndex: blockEntry.rootIndex }
      : { kind: "unsupported" };
  }

  const tableCellContext = resolveTableCellContext(documentIndex, region.id);

  if (tableCellContext) {
    return { kind: "tableCell", ...tableCellContext };
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
    block,
    region,
    rootIndex,
  };
}

export function resolveBlockquoteContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): BlockquoteContext | null {
  const region = documentIndex.regionIndex.get(selection.anchor.regionId);

  if (!region) {
    return null;
  }

  const paragraphEntry = documentIndex.blockIndex.get(region.blockId);
  const quoteEntry = findAncestorBlockEntry(
    documentIndex,
    paragraphEntry?.id ?? null,
    "blockquote",
  );

  if (!quoteEntry) {
    return null;
  }

  const rootIndex = quoteEntry.rootIndex;
  const rootBlock = documentIndex.document.blocks[rootIndex];

  return rootBlock?.type === "blockquote" ? { quote: rootBlock, rootIndex } : null;
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

export type ListItemContext = {
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
    rootIndex: tableEntry.rootIndex,
    rowIndex: tableCellPosition.rowIndex,
    table,
  };
}

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
