// Builds compact markdown line patches from local editor transitions. Patches
// describe persisted markdown, not editor reducer semantics.
import {
  trimTrailingWhitespace,
  type Block,
  type Document,
  type Inline,
  type ListBlock,
  type ListItemBlock,
  type TableBlock,
  type TableRow,
} from "@/document";
import { serializeCommentAppendix, serializeFragment } from "@/markdown";
import type { EditorStateTransition } from "@/component/store/editor/transitions";
import {
  countMarkdownLines,
  resolveMarkdownLineReplacement,
  resolveRootEndLine,
  resolveRootStartLine,
  serializeRootMarkdown,
} from "./markdown-lines";

export type DocumintPatch = {
  // Revision of the `content` prop this patch applies to.
  revision: string | null;
  changes: DocumintPatchChange[];
};

export type DocumintPatchChange = {
  // Zero-based line range in the base revision. `endLine` is exclusive.
  startLine: number;
  endLine: number;
  // Replacement markdown for the line range. Empty text deletes the range.
  text: string;
};

export function applyDocumintPatch(content: string, patch: DocumintPatch) {
  const lines = content.split("\n");

  for (const change of [...patch.changes].sort((left, right) => right.startLine - left.startLine)) {
    lines.splice(
      change.startLine,
      change.endLine - change.startLine,
      ...(change.text.length > 0 ? change.text.split("\n") : []),
    );
  }

  return lines.join("\n");
}

type RootSpan = {
  nextEnd: number;
  nextStart: number;
  previousEnd: number;
  previousStart: number;
};

export function resolveDocumintPatch(
  transition: EditorStateTransition,
  revision: string | null,
): DocumintPatch | null {
  if (transition.source !== "local" || !transition.documentChanged) {
    return null;
  }

  const previousDocument = transition.previous.documentIndex.document;
  const nextDocument = transition.next.documentIndex.document;

  if (!canPatchDocumentChange(previousDocument, nextDocument)) {
    return null;
  }

  const changes: DocumintPatchChange[] = [];

  const rootChanges = resolveRootChanges(transition, previousDocument, nextDocument);

  if (!rootChanges) {
    return null;
  }

  changes.push(...rootChanges);

  const commentChange = resolveCommentAppendixChange(previousDocument, nextDocument);

  if (commentChange) {
    changes.push(commentChange);
  }

  return changes.length > 0 ? { changes, revision } : null;
}

function canPatchDocumentChange(previousDocument: Document, nextDocument: Document) {
  return (
    previousDocument.frontMatter === nextDocument.frontMatter &&
    !isRuntimeEmptyDocument(previousDocument) &&
    !isRuntimeEmptyDocument(nextDocument)
  );
}

function isRuntimeEmptyDocument(document: Document) {
  const block = document.blocks[0];

  return document.blocks.length === 1 && block?.type === "paragraph" && block.children.length === 0;
}

function resolveSavableRoot(root: Block | undefined) {
  return root ? (trimTrailingWhitespace([root])[0] ?? null) : null;
}

function resolveRootChanges(
  transition: EditorStateTransition,
  previousDocument: Document,
  nextDocument: Document,
): DocumintPatchChange[] | null {
  if (
    previousDocument.blocks === nextDocument.blocks ||
    transition.changedRootIndexes.length === 0
  ) {
    return [];
  }

  if (previousDocument.blocks.length !== nextDocument.blocks.length) {
    const replacement = resolveStructuralRootReplacement(previousDocument, nextDocument);
    return replacement ? [replacement] : null;
  }

  const changes: DocumintPatchChange[] = [];

  for (const rootIndex of transition.changedRootIndexes) {
    const previousRoot = resolveSavableRoot(previousDocument.blocks[rootIndex]);
    const nextRoot = resolveSavableRoot(nextDocument.blocks[rootIndex]);

    if (!previousRoot || !nextRoot) {
      return null;
    }

    const lineReplacement = resolveRootLineReplacement(previousRoot, nextRoot);

    if (!lineReplacement) {
      continue;
    }

    const rootStartLine = resolveRootStartLine(previousDocument, rootIndex);
    changes.push({
      startLine: rootStartLine + lineReplacement.startLine,
      endLine: rootStartLine + lineReplacement.endLine,
      text: lineReplacement.nextText,
    });
  }

  return changes;
}

function resolveStructuralRootReplacement(
  previousDocument: Document,
  nextDocument: Document,
): DocumintPatchChange | null {
  const span = resolveChangedRootSpan(previousDocument.blocks, nextDocument.blocks);
  const previousRoots = previousDocument.blocks.slice(span.previousStart, span.previousEnd);
  const nextRoots = nextDocument.blocks.slice(span.nextStart, span.nextEnd);
  const previousText = serializeRootsMarkdown(previousRoots);
  const nextText = serializeRootsMarkdown(nextRoots);

  if (previousText === nextText) {
    return null;
  }

  return resolveRootSpanLineChange(previousDocument, span, nextText);
}

function resolveChangedRootSpan(previousBlocks: Block[], nextBlocks: Block[]): RootSpan {
  let start = 0;
  const maxPrefix = Math.min(previousBlocks.length, nextBlocks.length);

  while (start < maxPrefix && areRootsEquivalent(previousBlocks[start], nextBlocks[start])) {
    start += 1;
  }

  let previousEnd = previousBlocks.length;
  let nextEnd = nextBlocks.length;

  while (
    previousEnd > start &&
    nextEnd > start &&
    areRootsEquivalent(previousBlocks[previousEnd - 1], nextBlocks[nextEnd - 1])
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return {
    nextEnd,
    nextStart: start,
    previousEnd,
    previousStart: start,
  };
}

function areRootsEquivalent(left: Block | undefined, right: Block | undefined) {
  if (!left || !right) {
    return false;
  }

  if (areSimpleTextBlocksEquivalent(left, right)) {
    return true;
  }

  return left === right || resolveRootEquivalenceKey(left) === resolveRootEquivalenceKey(right);
}

function areSimpleTextBlocksEquivalent(left: Block, right: Block) {
  const isLeftSimpleTextBlock = left.type === "paragraph" || left.type === "heading";
  const isRightSimpleTextBlock = right.type === "paragraph" || right.type === "heading";

  if (
    left.type !== right.type ||
    !isLeftSimpleTextBlock ||
    !isRightSimpleTextBlock ||
    left.children.length !== 1 ||
    right.children.length !== 1
  ) {
    return false;
  }

  const leftChild = left.children[0]!;
  const rightChild = right.children[0]!;

  return (
    leftChild.type === "text" &&
    rightChild.type === "text" &&
    leftChild.marks.length === 0 &&
    rightChild.marks.length === 0 &&
    leftChild.text === rightChild.text
  );
}

function resolveRootEquivalenceKey(root: Block) {
  switch (root.type) {
    case "paragraph":
    case "heading":
      return `${root.type}:${serializeInlineEquivalenceKey(root.children)}`;
    case "divider":
      return root.type;
    case "code":
      return `${root.type}:${root.language ?? ""}:${root.meta ?? ""}:${root.source}`;
    case "raw":
      return `${root.type}:${root.originalType}:${root.source}`;
    case "directive":
      return `${root.type}:${root.name}:${root.attributes}:${root.body}`;
    default:
      return serializeRootMarkdown(root);
  }
}

function resolveRootSpanLineChange(
  previousDocument: Document,
  span: RootSpan,
  nextText: string,
): DocumintPatchChange {
  const previousRootCount = span.previousEnd - span.previousStart;
  const nextRootCount = span.nextEnd - span.nextStart;

  if (previousRootCount === 0) {
    return resolveInsertedRootSpanLineChange(previousDocument, span.previousStart, nextText);
  }

  const startLine = resolveRootStartLine(previousDocument, span.previousStart);
  const rootEndLine = resolveRootEndLine(previousDocument, span.previousEnd - 1) ?? startLine;

  if (nextRootCount === 0) {
    return resolveDeletedRootSpanLineChange(previousDocument, span.previousStart, rootEndLine);
  }

  return {
    endLine: rootEndLine,
    startLine,
    text: nextText,
  };
}

function resolveInsertedRootSpanLineChange(
  previousDocument: Document,
  rootIndex: number,
  nextText: string,
): DocumintPatchChange {
  if (previousDocument.blocks.length === 0) {
    return {
      endLine: resolveDocumentBodyEndLine(previousDocument),
      startLine: resolveDocumentBodyEndLine(previousDocument),
      text: nextText,
    };
  }

  if (rootIndex < previousDocument.blocks.length) {
    const startLine = resolveRootStartLine(previousDocument, rootIndex);

    return {
      endLine: startLine,
      startLine,
      text: `${nextText}\n`,
    };
  }

  const endLine = resolveDocumentBodyEndLine(previousDocument);

  return {
    endLine,
    startLine: endLine,
    text: `\n${nextText}`,
  };
}

function resolveDeletedRootSpanLineChange(
  previousDocument: Document,
  rootIndex: number,
  rootEndLine: number,
): DocumintPatchChange {
  const startLine = resolveRootStartLine(previousDocument, rootIndex);
  const hasPreviousRoot = rootIndex > 0;
  const hasNextRoot = rootEndLine < resolveDocumentBodyEndLine(previousDocument);

  if (hasNextRoot) {
    return {
      endLine: rootEndLine + 1,
      startLine,
      text: "",
    };
  }

  if (hasPreviousRoot) {
    return {
      endLine: rootEndLine,
      startLine: startLine - 1,
      text: "",
    };
  }

  return {
    endLine: rootEndLine,
    startLine,
    text: "",
  };
}

function resolveRootLineReplacement(previousRoot: Block, nextRoot: Block) {
  if (previousRoot.type === "code" && nextRoot.type === "code") {
    const sourceReplacement = resolveMarkdownLineReplacement(previousRoot.source, nextRoot.source);

    return sourceReplacement
      ? {
          ...sourceReplacement,
          endLine: sourceReplacement.endLine + 1,
          startLine: sourceReplacement.startLine + 1,
        }
      : null;
  }

  if (previousRoot.type === "table" && nextRoot.type === "table") {
    return (
      resolveTableBodyRowReplacement(previousRoot, nextRoot) ??
      resolveMarkdownLineReplacement(
        serializeRootMarkdown(previousRoot),
        serializeRootMarkdown(nextRoot),
      )
    );
  }

  if (previousRoot.type === "list" && nextRoot.type === "list") {
    return (
      resolveListItemSpanReplacement(previousRoot, nextRoot) ??
      resolveMarkdownLineReplacement(
        serializeRootMarkdown(previousRoot),
        serializeRootMarkdown(nextRoot),
      )
    );
  }

  return resolveMarkdownLineReplacement(
    serializeRootMarkdown(previousRoot),
    serializeRootMarkdown(nextRoot),
  );
}

function resolveTableBodyRowReplacement(previousTable: TableBlock, nextTable: TableBlock) {
  if (
    previousTable.rows.length !== nextTable.rows.length ||
    !tableAlignEqual(previousTable.align, nextTable.align) ||
    !tableRowsTextEqual(previousTable.rows[0], nextTable.rows[0])
  ) {
    return null;
  }

  const changedRowIndex = resolveSingleChangedRowIndex(previousTable.rows, nextTable.rows);

  if (changedRowIndex === null || changedRowIndex === 0) {
    return null;
  }

  const previousLine = serializeTableBodyRow(previousTable, previousTable.rows[changedRowIndex]!);
  const nextLine = serializeTableBodyRow(nextTable, nextTable.rows[changedRowIndex]!);

  if (previousLine === nextLine) {
    return null;
  }

  const lineIndex = changedRowIndex + 1;

  return {
    endLine: lineIndex + 1,
    nextText: nextLine,
    startLine: lineIndex,
  };
}

function resolveSingleChangedRowIndex(previousRows: TableRow[], nextRows: TableRow[]) {
  let changedRowIndex: number | null = null;

  for (let index = 0; index < nextRows.length; index += 1) {
    if (tableRowsTextEqual(previousRows[index], nextRows[index])) {
      continue;
    }

    if (changedRowIndex !== null) {
      return null;
    }

    changedRowIndex = index;
  }

  return changedRowIndex;
}

function serializeTableBodyRow(table: TableBlock, row: TableRow) {
  return serializeRootMarkdown({ ...table, rows: [table.rows[0]!, row] }).split("\n")[2] ?? "";
}

function tableAlignEqual(left: TableBlock["align"], right: TableBlock["align"]) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function tableRowsTextEqual(left: TableRow | undefined, right: TableRow | undefined) {
  if (!left || !right || left.cells.length !== right.cells.length) {
    return false;
  }

  for (let index = 0; index < left.cells.length; index += 1) {
    if (left.cells[index]?.plainText !== right.cells[index]?.plainText) {
      return false;
    }
  }

  return true;
}

function resolveListItemSpanReplacement(previousList: ListBlock, nextList: ListBlock) {
  if (
    previousList.spread ||
    nextList.spread ||
    previousList.ordered !== nextList.ordered ||
    previousList.start !== nextList.start
  ) {
    return null;
  }

  const span = resolveChangedListItemSpan(previousList.items, nextList.items);
  const previousItems = previousList.items.slice(span.previousStart, span.previousEnd);
  const nextItems = nextList.items.slice(span.nextStart, span.nextEnd);
  const previousText = serializeListItemsMarkdown(previousList, previousItems, span.previousStart);
  const nextText = serializeListItemsMarkdown(nextList, nextItems, span.nextStart);

  if (previousText === nextText) {
    return null;
  }

  const startLine = resolveListItemStartLine(previousList, span.previousStart);

  return {
    endLine: startLine + countMarkdownLines(previousText),
    nextText,
    startLine,
  };
}

function resolveChangedListItemSpan(previousItems: ListItemBlock[], nextItems: ListItemBlock[]) {
  let start = 0;
  const maxPrefix = Math.min(previousItems.length, nextItems.length);

  while (start < maxPrefix && areListItemsEquivalent(previousItems[start], nextItems[start])) {
    start += 1;
  }

  let previousEnd = previousItems.length;
  let nextEnd = nextItems.length;

  while (
    previousEnd > start &&
    nextEnd > start &&
    areListItemsEquivalent(previousItems[previousEnd - 1], nextItems[nextEnd - 1])
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return {
    nextEnd,
    nextStart: start,
    previousEnd,
    previousStart: start,
  };
}

function areListItemsEquivalent(left: ListItemBlock | undefined, right: ListItemBlock | undefined) {
  if (!left || !right) {
    return false;
  }

  if (left.checked === right.checked && areListItemChildrenEquivalent(left, right)) {
    return true;
  }

  return (
    left === right ||
    (left.checked === right.checked && left.children === right.children) ||
    serializeListItemsMarkdown(createListForItems([left]), [left], 0) ===
      serializeListItemsMarkdown(createListForItems([right]), [right], 0)
  );
}

function resolveListItemStartLine(list: ListBlock, itemIndex: number) {
  let line = 0;

  for (let index = 0; index < itemIndex; index += 1) {
    line += countListItemMarkdownLines(list, index);
  }

  return line;
}

function countListItemMarkdownLines(list: ListBlock, itemIndex: number) {
  const item = list.items[itemIndex];

  if (!item) {
    return 0;
  }

  const [firstChild, ...rest] = item.children;

  if (
    rest.length === 0 &&
    (!firstChild || firstChild.type === "paragraph" || firstChild.type === "heading")
  ) {
    return 1;
  }

  return countMarkdownLines(serializeListItemsMarkdown(list, [item], itemIndex));
}

function areListItemChildrenEquivalent(left: ListItemBlock, right: ListItemBlock) {
  if (left.children.length !== right.children.length) {
    return false;
  }

  if (left.children.length === 1) {
    const leftChild = left.children[0]!;
    const rightChild = right.children[0]!;

    if (areSimpleTextBlocksEquivalent(leftChild, rightChild)) {
      return true;
    }

    return resolveRootEquivalenceKey(leftChild) === resolveRootEquivalenceKey(rightChild);
  }

  for (let index = 0; index < left.children.length; index += 1) {
    const leftChild = left.children[index]!;
    const rightChild = right.children[index]!;

    if (
      !areSimpleTextBlocksEquivalent(leftChild, rightChild) &&
      resolveRootEquivalenceKey(leftChild) !== resolveRootEquivalenceKey(rightChild)
    ) {
      return false;
    }
  }

  return true;
}

function serializeInlineEquivalenceKey(inlines: readonly Inline[]): string {
  let key = "";

  for (const inline of inlines) {
    key += `${key.length > 0 ? "|" : ""}${serializeInlineNodeEquivalenceKey(inline)}`;
  }

  return key;
}

function serializeInlineNodeEquivalenceKey(inline: Inline): string {
  switch (inline.type) {
    case "text":
      return `text:${inline.marks.join(",")}:${inline.text}`;
    case "link":
      return [
        "link",
        inline.url,
        inline.title ?? "",
        serializeInlineEquivalenceKey(inline.children),
      ].join(":");
    case "image":
      return `image:${inline.url}:${inline.alt ?? ""}:${inline.title ?? ""}:${inline.width ?? ""}`;
    case "mention":
      return `mention:${inline.userId}:${inline.name}`;
    case "resource":
      return `resource:${inline.protocol}:${inline.url}:${inline.label}`;
    case "raw":
      return `raw:${inline.originalType}:${inline.source}`;
    case "lineBreak":
      return "lineBreak";
  }
}

function serializeListItemsMarkdown(list: ListBlock, items: ListItemBlock[], startIndex: number) {
  if (items.length === 0) {
    return "";
  }

  return serializeRootMarkdown({
    ...list,
    items,
    start: list.ordered && list.start !== null ? list.start + startIndex : list.start,
  });
}

function createListForItems(items: ListItemBlock[]): ListBlock {
  return {
    id: "sync-list-item-comparison",
    items,
    ordered: false,
    plainText: items.map((item) => item.plainText).join("\n"),
    spread: false,
    start: null,
    type: "list",
  };
}

function resolveCommentAppendixChange(
  previousDocument: Document,
  nextDocument: Document,
): DocumintPatchChange | null {
  if (previousDocument.comments === nextDocument.comments) {
    return null;
  }

  const previousText = serializeCommentAppendix(previousDocument.comments);
  const nextText = serializeCommentAppendix(nextDocument.comments);

  if (previousText === nextText) {
    return null;
  }

  const previousHasComments = previousText.length > 0;
  const nextHasComments = nextText.length > 0;
  const bodyEndLine = resolveDocumentBodyEndLine(previousDocument);
  const hasBody = hasSerializedBody(previousDocument);

  if (!previousHasComments) {
    return {
      endLine: bodyEndLine,
      startLine: bodyEndLine,
      text: hasBody ? `\n${nextText}` : nextText,
    };
  }

  const appendixStartLine = hasBody ? bodyEndLine + 1 : 0;
  const appendixEndLine = appendixStartLine + countMarkdownLines(previousText);

  if (!nextHasComments) {
    return {
      endLine: appendixEndLine,
      startLine: hasBody ? bodyEndLine : 0,
      text: "",
    };
  }

  return {
    endLine: appendixEndLine,
    startLine: appendixStartLine,
    text: nextText,
  };
}

function serializeRootsMarkdown(blocks: Block[]) {
  const savableBlocks = trimTrailingWhitespace(blocks);

  return savableBlocks.length > 0
    ? serializeFragment({ kind: "blocks", blocks: savableBlocks })
    : "";
}

function hasSerializedBody(document: Document) {
  return document.frontMatter !== undefined || document.blocks.length > 0;
}

function resolveDocumentBodyEndLine(document: Document) {
  if (document.blocks.length > 0) {
    return resolveRootEndLine(document, document.blocks.length - 1) ?? 0;
  }

  if (document.frontMatter !== undefined) {
    return countMarkdownLines(document.frontMatter);
  }

  return 0;
}
