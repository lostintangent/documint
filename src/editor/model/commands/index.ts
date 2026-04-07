// Public editor command entrypoints and shared semantic rewrite helpers used by
// the narrower block, input, inline, list, and table command modules.
import {
  createBlockquoteBlock,
  createTableBlock,
  createTableCell,
  createTableRow,
  createParagraphTextBlock,
  findBlockById,
  rebuildListBlock,
  rebuildListItemBlock,
  spliceDocument,
  type Block,
  type ListItemBlock,
} from "@/document";
import {
  normalizeCanvasSelection as normalizeSelection,
  replaceExactInlineLinkTarget,
  replaceText,
  resolveInlineCommandTarget,
  type CanvasSelection,
  type EditorSelectionTarget,
} from "../document-editor";
import {
  addInsertedTextHighlightAnimation,
  pushHistory,
  redoEditorState,
  setCanvasSelection as setSelection,
  undoEditorState,
  type EditorState,
} from "../state";
import { applyTextInputRuleOperation } from "./input";
import {
  toggleSelectionInlineCodeOperation,
  toggleSelectionMarkOperation,
} from "./inline";
import {
  handleBlockStructuralBackspaceOperation,
  insertCodeLineBreakOperation,
  shiftHeadingDepthOperation,
  splitStructuralBlockquoteOperation,
  splitBlockquoteTextBlockOperation,
  splitTextBlockOperation,
} from "./blocks";
import {
  dedentListItemOperation,
  handleListStructuralBackspaceOperation,
  indentListItemOperation,
  moveListItemDownOperation,
  moveListItemUpOperation,
  splitSelectionListItemOperation,
  splitStructuralListBlockOperation,
} from "./lists";
import {
  deleteTableColumnOperation,
  deleteTableOperation,
  deleteTableRowOperation,
  handleTableTabOperation,
  insertTableCellLineBreakOperation,
  insertTableColumnOperation,
  insertTableRowOperation,
} from "./table";

export type EditorCommand =
  | "dedent"
  | "deleteBackward"
  | "indent"
  | "insertLineBreak"
  | "moveListItemDown"
  | "moveListItemUp"
  | "moveToLineEnd"
  | "moveToLineStart"
  | "redo"
  | "toggleSelectionBold"
  | "toggleSelectionInlineCode"
  | "toggleSelectionItalic"
  | "toggleSelectionStrikethrough"
  | "toggleSelectionUnderline"
  | "undo";

export function splitSelectionListItem(state: EditorState) {
  return splitSelectionListItemOperation(state, listHelpers);
}

export function splitStructuralBlock(state: EditorState) {
  return (
    splitStructuralListBlockOperation(state, listHelpers) ??
    splitStructuralBlockquoteOperation(state, blockHelpers) ??
    splitTextBlock(state)
  );
}

export function splitTextBlock(state: EditorState) {
  return splitTextBlockOperation(state, blockHelpers);
}

export function splitBlockquoteTextBlock(state: EditorState) {
  return splitBlockquoteTextBlockOperation(state, blockHelpers);
}

export function insertCodeLineBreak(state: EditorState) {
  return insertCodeLineBreakOperation(state, blockHelpers);
}

export function handleStructuralBackspace(state: EditorState) {
  const selection = normalizeSelection(state.documentEditor, state.selection);

  if (
    selection.start.regionId !== selection.end.regionId ||
    selection.start.offset !== 0 ||
    selection.end.offset !== 0
  ) {
    return null;
  }

  return handleListStructuralBackspaceOperation(state, listHelpers) ?? handleBlockStructuralBackspaceOperation(state, blockHelpers);
}

export function indentListItem(state: EditorState) {
  return indentListItemOperation(state, listHelpers);
}

export function dedentListItem(state: EditorState) {
  return dedentListItemOperation(state, listHelpers);
}

export function moveListItemUp(state: EditorState) {
  return moveListItemUpOperation(state, listHelpers);
}

export function moveListItemDown(state: EditorState) {
  return moveListItemDownOperation(state, listHelpers);
}

export function wrapSelectionInBlockquote(state: EditorState) {
  const container = state.documentEditor.regions.find(
    (entry) => entry.id === state.selection.anchor.regionId,
  );

  if (!container) {
    return null;
  }

  const rootIndex = state.documentEditor.document.blocks.findIndex((block) => block.id === container.blockId);

  if (rootIndex === -1) {
    return null;
  }

  const block = state.documentEditor.document.blocks[rootIndex]!;

  return applyRootBlockReplacement(state, rootIndex, createBlockquoteBlock({
    children: [block],
    path: `root.${rootIndex}`,
  }));
}

export function applyTextInputRule(state: EditorState, text: string) {
  return applyTextInputRuleOperation(state, text, {
    ...inputRuleHelpers,
    replaceSelectionText: insertSelectionText,
  });
}

export function replaceSelectionText(state: EditorState, text: string) {
  const replaced = replaceText(state.documentEditor, state.selection, text);

  return pushHistory(
    state,
    replaced.documentEditor.document,
    replaced.documentEditor,
    replaced.selection,
  );
}

export function insertSelectionText(state: EditorState, text: string) {
  const nextState = replaceSelectionText(state, text);

  return text.length > 0
    ? addInsertedTextHighlightAnimation(nextState, text.length)
    : nextState;
}

export function deleteSelectionText(state: EditorState) {
  return replaceSelectionText(state, "");
}

export function toggleTaskItem(state: EditorState, listItemId: string) {
  const blockEntry = state.documentEditor.blockIndex.get(listItemId);

  if (!blockEntry) {
    return null;
  }

  const rootBlock = state.documentEditor.document.blocks[blockEntry.rootIndex];

  if (!rootBlock) {
    return null;
  }

  const nextRootBlock = toggleTaskItemInTree(rootBlock, listItemId);

  if (!nextRootBlock) {
    return null;
  }

  const nextDocument = spliceDocument(
    state.documentEditor.document,
    blockEntry.rootIndex,
    1,
    [nextRootBlock],
  );

  return pushHistory(state, nextDocument, null, state.selection);
}

export function insertTable(state: EditorState, columnCount: number) {
  const context = resolveRootTextBlockContext(state);
  const resolvedColumnCount = Math.max(2, columnCount);

  if (
    !context ||
    context.block.type !== "paragraph" ||
    context.block.plainText.length > 0 ||
    state.selection.anchor.regionId !== state.selection.focus.regionId ||
    state.selection.anchor.offset !== 0 ||
    state.selection.focus.offset !== 0
  ) {
    return null;
  }

  const nextTable = createTableBlock({
    rows: [
      createEmptyTableRow(resolvedColumnCount),
      createEmptyTableRow(resolvedColumnCount),
    ],
  });

  return applyBlockReplacement(
    state,
    context.block.id,
    nextTable,
    focusTableCell(context.rootIndex, 0, 0),
  );
}

export function insertTableColumn(state: EditorState, direction: "left" | "right") {
  return insertTableColumnOperation(state, direction, tableHelpers);
}

export function deleteTableColumn(state: EditorState) {
  return deleteTableColumnOperation(state, tableHelpers);
}

export function insertTableRow(state: EditorState, direction: "above" | "below") {
  return insertTableRowOperation(state, direction, tableHelpers);
}

export function deleteTableRow(state: EditorState) {
  return deleteTableRowOperation(state, tableHelpers);
}

export function deleteTable(state: EditorState) {
  return deleteTableOperation(state, tableHelpers);
}

function createEmptyTableRow(columnCount: number) {
  return createTableRow({
    cells: Array.from({ length: columnCount }, () =>
      createTableCell({
        children: [],
      }),
    ),
  });
}

export function toggleSelectionMark(
  state: EditorState,
  mark: "italic" | "bold" | "strikethrough" | "underline",
) {
  return toggleSelectionMarkOperation(state, mark, markHelpers);
}

export function toggleSelectionInlineCode(state: EditorState) {
  return toggleSelectionInlineCodeOperation(state, inlineHelpers);
}

export function updateInlineLink(
  state: EditorState,
  regionId: string,
  startOffset: number,
  endOffset: number,
  url: string,
) {
  return applyInlineRangeOperation(
    state,
    regionId,
    startOffset,
    endOffset,
    (target) => replaceExactInlineLinkTarget(target, startOffset, endOffset, url),
  );
}

export function removeInlineLink(
  state: EditorState,
  regionId: string,
  startOffset: number,
  endOffset: number,
) {
  return applyInlineRangeOperation(
    state,
    regionId,
    startOffset,
    endOffset,
    (target) => replaceExactInlineLinkTarget(target, startOffset, endOffset, null),
  );
}

export function dispatchKey(state: EditorState, key: EditorCommand) {
  switch (key) {
    case "insertLineBreak":
      return (
        insertCodeLineBreak(state) ??
        insertTableCellLineBreakOperation(state, tableHelpers) ??
        splitStructuralBlock(state) ??
        splitTextBlock(state)
      );
    case "deleteBackward":
      return handleStructuralBackspace(state);
    case "indent":
      return (
        handleTableTabOperation(state, 1, tableHelpers) ??
        shiftHeadingDepthOperation(state, 1, blockHelpers) ??
        indentListItem(state)
      );
    case "dedent":
      return (
        handleTableTabOperation(state, -1, tableHelpers) ??
        shiftHeadingDepthOperation(state, -1, blockHelpers) ??
        dedentListItem(state)
      );
    case "moveListItemUp":
      return moveListItemUp(state);
    case "moveListItemDown":
      return moveListItemDown(state);
    case "toggleSelectionBold":
      return toggleSelectionMark(state, "bold");
    case "toggleSelectionItalic":
      return toggleSelectionMark(state, "italic");
    case "toggleSelectionStrikethrough":
      return toggleSelectionMark(state, "strikethrough");
    case "toggleSelectionUnderline":
      return toggleSelectionMark(state, "underline");
    case "toggleSelectionInlineCode":
      return toggleSelectionInlineCode(state);
    case "undo":
      return undoEditorState(state);
    case "redo":
      return redoEditorState(state);
    default:
      return null;
  }
}

const listHelpers = {
  applyBlockReplacement,
  extractListContext: resolveListItemContext,
  focusBlockContainer: focusBlockRegion,
  focusBlockContainerEnd: focusBlockRegionEnd,
  focusDescendantPrimaryRegion,
  focusRootPrimaryRegion,
  normalizeSelection,
  replaceListItemLeadingParagraphText,
  replaceRootRange,
  resolvePrimaryTextBlockId,
};

const blockHelpers = {
  applyRootBlockReplacement,
  focusBlockContainer: focusBlockRegion,
  focusBlockContainerEnd: focusBlockRegionEnd,
  focusDescendantPrimaryRegion,
  focusRootPrimaryRegion,
  normalizeSelection,
  replaceListItemLeadingParagraphText,
  replaceRootRange,
  replaceSelectionText,
  resolveBlockquoteContext,
  resolveBlockquoteTextBlockContext,
  resolvePrimaryTextBlockId,
  resolveRootTextBlockContext,
  resolveTrailingTextBlockId,
};

const inputRuleHelpers = {
  applyBlockReplacement,
  applyRootBlockReplacement,
  extractListContext: resolveListItemContext,
  findRootIndex,
  focusBlockContainer: focusBlockRegion,
  focusDescendantPrimaryRegion,
  focusRootPrimaryRegion,
  isRootParagraphInputRuleTarget,
  normalizeSelection,
  replaceRootRange,
  replaceListItemLeadingParagraphText,
  replaceSelectionText,
  resolvePrimaryTextBlockId,
  resolveRootTextBlockContext,
};

const markHelpers = {
  applyBlockReplacement,
  findBlockById,
  normalizeSelection,
};

const inlineHelpers = {
  applyBlockReplacement,
  findBlockById,
  normalizeSelection,
};

const tableHelpers = {
  applyBlockReplacement,
  focusTableCell,
  focusRootPrimaryRegion,
  setSelection,
};

function toggleTaskItemInTree(
  block: Block,
  listItemId: string,
): Block | null {
  switch (block.type) {
    case "blockquote": {
      const nextChildren = toggleTaskItemInTreeChildren(block.children, listItemId);
      return nextChildren ? createBlockquoteBlock({ children: nextChildren }) : null;
    }
    case "list": {
      const nextChildren = toggleTaskItemInTreeChildren(
        block.children,
        listItemId,
      ) as ListItemBlock[] | null;
      return nextChildren ? rebuildListBlock(block, nextChildren) : null;
    }
    case "listItem":
      if (block.id === listItemId && typeof block.checked === "boolean") {
        return { ...block, checked: !block.checked };
      }

      if (block.children.length === 0) {
        return null;
      }

      {
        const nextChildren = toggleTaskItemInTreeChildren(block.children, listItemId);
        return nextChildren ? rebuildListItemBlock(block, nextChildren) : null;
      }
    default:
      return null;
  }
}

function toggleTaskItemInTreeChildren(
  blocks: Block[],
  listItemId: string,
): Block[] | null {
  let didChange = false;

  const nextBlocks = blocks.map((block) => {
    const nextBlock = toggleTaskItemInTree(block, listItemId);

    if (!nextBlock) {
      return block;
    }

    didChange = true;
    return nextBlock;
  });

  return didChange ? nextBlocks : null;
}

function applyRootBlockReplacement(
  state: EditorState,
  rootIndex: number,
  replacement: Block,
  selection?: CanvasSelection | EditorSelectionTarget,
) {
  return replaceRootRange(state, rootIndex, 1, [replacement], selection);
}

function replaceRootRange(
  state: EditorState,
  rootIndex: number,
  count: number,
  replacements: Block[],
  selection?: CanvasSelection | EditorSelectionTarget,
) {
  const nextDocument = spliceDocument(
    state.documentEditor.document,
    rootIndex,
    count,
    replacements,
  );

  return pushHistory(state, nextDocument, null, selection);
}

function findRootIndex(state: EditorState, blockId: string) {
  const blockEntry = state.documentEditor.blockIndex.get(blockId);

  if (!blockEntry) {
    throw new Error(`Unknown root block: ${blockId}`);
  }

  return blockEntry.rootIndex;
}

function isRootParagraphInputRuleTarget(
  state: EditorState,
  container: EditorState["documentEditor"]["regions"][number],
) {
  if (container.blockType !== "paragraph") {
    return false;
  }

  const rootBlock = state.documentEditor.document.blocks[container.rootIndex];

  return rootBlock?.type === "paragraph";
}

function focusRootPrimaryRegion(
  rootIndex: number,
  offset: number | "end" = 0,
): EditorSelectionTarget {
  return {
    kind: "root-primary-region",
    offset,
    rootIndex,
  };
}

function focusDescendantPrimaryRegion(
  rootIndex: number,
  childIndices: number[],
  offset: number | "end" = 0,
): EditorSelectionTarget {
  return {
    childIndices,
    kind: "descendant-primary-region",
    offset,
    rootIndex,
  };
}

function focusTableCell(
  rootIndex: number,
  rowIndex: number,
  cellIndex: number,
  offset: number | "end" = 0,
): EditorSelectionTarget {
  return {
    cellIndex,
    kind: "table-cell",
    offset,
    rootIndex,
    rowIndex,
  };
}

function resolveListItemContext(state: EditorState) {
  const container = state.documentEditor.regions.find(
    (entry) => entry.id === state.selection.anchor.regionId,
  );

  if (!container) {
    return null;
  }

  const paragraphEntry = state.documentEditor.blockIndex.get(container.blockId);
  const itemEntry = findAncestorBlockEntry(state, paragraphEntry?.id ?? null, "listItem");
  const listEntry = findAncestorBlockEntry(state, paragraphEntry?.id ?? null, "list");

  if (!paragraphEntry || !itemEntry || !listEntry) {
    return null;
  }

  const list = findBlockById(state.documentEditor.document.blocks, listEntry.id);

  if (!list || list.type !== "list") {
    return null;
  }

  const itemIndex = list.children.findIndex((child) => child.id === itemEntry.id);
  const item = list.children[itemIndex];

  if (!item) {
    return null;
  }

  const parentItemEntry = listEntry.parentBlockId
    ? state.documentEditor.blockIndex.get(listEntry.parentBlockId) ?? null
    : null;
  const parentListEntry =
    parentItemEntry?.parentBlockId
      ? state.documentEditor.blockIndex.get(parentItemEntry.parentBlockId) ?? null
      : null;
  const parentItem =
    parentItemEntry?.type === "listItem"
      ? findBlockById(state.documentEditor.document.blocks, parentItemEntry.id)
      : null;
  const parentList =
    parentListEntry?.type === "list"
      ? findBlockById(state.documentEditor.document.blocks, parentListEntry.id)
      : null;
  const parentItemIndex =
    parentList?.type === "list" && parentItem
      ? parentList.children.findIndex((child) => child.id === parentItem.id)
      : -1;

  return {
    container,
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

function resolveRootTextBlockContext(state: EditorState) {
  const container = state.documentEditor.regions.find(
    (entry) => entry.id === state.selection.anchor.regionId,
  );

  if (!container) {
    return null;
  }

  const blockEntry = state.documentEditor.blockIndex.get(container.blockId);

  if (!blockEntry) {
    return null;
  }

  const rootIndex = blockEntry.rootIndex;
  const block = state.documentEditor.document.blocks[rootIndex];

  if (!block || (block.type !== "heading" && block.type !== "paragraph")) {
    return null;
  }

  return {
    block,
    container,
    rootIndex,
  };
}

function resolveBlockquoteContext(state: EditorState) {
  const container = state.documentEditor.regions.find(
    (entry) => entry.id === state.selection.anchor.regionId,
  );

  if (!container) {
    return null;
  }

  const paragraphEntry = state.documentEditor.blockIndex.get(container.blockId);
  const quoteEntry = findAncestorBlockEntry(state, paragraphEntry?.id ?? null, "blockquote");

  if (!quoteEntry) {
    return null;
  }

  const rootIndex = quoteEntry.rootIndex;
  const rootBlock = state.documentEditor.document.blocks[rootIndex];

  return rootBlock?.type === "blockquote" ? { quote: rootBlock, rootIndex } : null;
}

function resolveBlockquoteTextBlockContext(state: EditorState) {
  const container = state.documentEditor.regions.find(
    (entry) => entry.id === state.selection.anchor.regionId,
  );

  if (!container) {
    return null;
  }

  const blockEntry = state.documentEditor.blockIndex.get(container.blockId);
  const quoteEntry = findAncestorBlockEntry(state, blockEntry?.id ?? null, "blockquote");

  if (!blockEntry || !quoteEntry || blockEntry.parentBlockId !== quoteEntry.id) {
    return null;
  }

  const rootIndex = quoteEntry.rootIndex;
  const rootBlock = state.documentEditor.document.blocks[rootIndex];

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
    container,
    quote: rootBlock,
    rootIndex,
  };
}

function parseBlockChildIndices(path: string) {
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

function findAncestorBlockEntry(
  state: EditorState,
  blockId: string | null,
  type: Block["type"],
) {
  let current = blockId
    ? state.documentEditor.blockIndex.get(blockId) ?? null
    : null;

  while (current) {
    if (current.type === type) {
      return current;
    }

    const parentBlockId = current.parentBlockId;

    current = parentBlockId
      ? state.documentEditor.blockIndex.get(parentBlockId) ?? null
      : null;
  }

  return null;
}

function focusBlockRegion(state: EditorState, blockId: string) {
  const blockEntry = state.documentEditor.blockIndex.get(blockId);
  const container = blockEntry?.regionIds[0]
    ? state.documentEditor.regionIndex.get(blockEntry.regionIds[0])
    : null;

  if (!container) {
    return state;
  }

  return setSelection(state, {
    regionId: container.id,
    offset: 0,
  });
}

function focusBlockRegionEnd(state: EditorState, blockId: string) {
  const blockEntry = state.documentEditor.blockIndex.get(blockId);
  const container = blockEntry?.regionIds[0]
    ? state.documentEditor.regionIndex.get(blockEntry.regionIds[0])
    : null;

  if (!container) {
    return state;
  }

  return setSelection(state, {
    regionId: container.id,
    offset: container.text.length,
  });
}

function applyBlockReplacement(
  state: EditorState,
  targetBlockId: string,
  replacement: Block,
  selection?: CanvasSelection | EditorSelectionTarget,
) {
  const blockEntry = state.documentEditor.blockIndex.get(targetBlockId);

  if (!blockEntry) {
    return null;
  }

  const rootBlock = state.documentEditor.document.blocks[blockEntry.rootIndex];

  if (!rootBlock) {
    return null;
  }

  const nextRootBlock = replaceBlockInTree(
    rootBlock,
    targetBlockId,
    replacement,
  );

  if (!nextRootBlock) {
    return null;
  }

  const nextDocument = spliceDocument(
    state.documentEditor.document,
    blockEntry.rootIndex,
    1,
    [nextRootBlock],
  );

  return pushHistory(state, nextDocument, null, selection ?? state.selection);
}

function applyInlineRangeOperation(
  state: EditorState,
  regionId: string,
  startOffset: number,
  endOffset: number,
  applyTargetEdit: (
    target: NonNullable<ReturnType<typeof resolveInlineCommandTarget>>,
  ) => {
    block: Block;
    blockId: string;
    selection: CanvasSelection | EditorSelectionTarget;
  } | null,
) {
  const region = state.documentEditor.regionIndex.get(regionId);

  if (!region || startOffset >= endOffset) {
    return null;
  }

  const block = findBlockById(state.documentEditor.document.blocks, region.blockId);

  if (!block) {
    return null;
  }

  const target = resolveInlineCommandTarget(block, region.path, region.semanticRegionId);

  if (!target) {
    return null;
  }

  const replacement = applyTargetEdit(target);

  return replacement
    ? applyBlockReplacement(state, replacement.blockId, replacement.block, state.selection)
    : null;
}

function replaceBlockInTree(
  block: Block,
  targetBlockId: string,
  replacement: Block,
): Block | null {
  if (block.id === targetBlockId) {
    return replacement;
  }

  switch (block.type) {
    case "blockquote": {
      const nextChildren = replaceBlockInTreeChildren(
        block.children,
        targetBlockId,
        replacement,
      );
      return nextChildren ? createBlockquoteBlock({ children: nextChildren }) : null;
    }
    case "listItem": {
      const nextChildren = replaceBlockInTreeChildren(
        block.children,
        targetBlockId,
        replacement,
      );
      return nextChildren ? rebuildListItemBlock(block, nextChildren) : null;
    }
    case "list": {
      const nextChildren = replaceBlockInTreeChildren(
        block.children,
        targetBlockId,
        replacement,
      ) as ListItemBlock[] | null;
      return nextChildren ? rebuildListBlock(block, nextChildren) : null;
    }
    default:
      return null;
  }
}

function replaceBlockInTreeChildren(
  blocks: Block[],
  targetBlockId: string,
  replacement: Block,
): Block[] | null {
  let didChange = false;

  const nextBlocks = blocks.map((block) => {
    const nextBlock = replaceBlockInTree(block, targetBlockId, replacement);

    if (!nextBlock) {
      return block;
    }

    didChange = true;
    return nextBlock;
  });

  return didChange ? nextBlocks : null;
}

function replaceListItemLeadingParagraphText(item: ListItemBlock, text: string) {
  const firstChild = item.children[0];

  if (!firstChild || firstChild.type !== "paragraph") {
    return null;
  }

  const nextChildren = [createParagraphTextBlock({
    text,
  }), ...item.children.slice(1)];

  return rebuildListItemBlock(item, nextChildren);
}

function resolvePrimaryTextBlockId(item: ListItemBlock) {
  return item.children[0]?.id ?? item.id;
}

function resolveTrailingTextBlockId(block: Block): string {
  switch (block.type) {
    case "blockquote": {
      const lastChild = block.children.at(-1);
      return lastChild ? resolveTrailingTextBlockId(lastChild) : block.id;
    }
    case "list": {
      const lastItem = block.children.at(-1);
      return lastItem ? resolvePrimaryTextBlockId(lastItem) : block.id;
    }
    case "listItem":
      return resolvePrimaryTextBlockId(block);
    default:
      return block.id;
  }
}
