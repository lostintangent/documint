// Text-based mutations. Applies edits defined by a selection range:
// inline text splicing within a single region, or structural block
// trimming and merging when the selection spans multiple regions.

import {
  createBlockquoteBlock,
  createCode as createDocumentInlineCodeNode,
  createImage as createDocumentImageNode,
  createLineBreak as createDocumentLineBreakNode,
  createLink as createDocumentLinkNode,
  createParagraphTextBlock,
  createRaw as createDocumentUnsupportedInlineNode,
  createTableCell as createDocumentTableCell,
  createText as createDocumentTextNode,
  rebuildCodeBlock,
  rebuildListBlock,
  rebuildListItemBlock,
  rebuildTableBlock,
  rebuildTextBlock,
  rebuildRawBlock,
  spliceDocument,
  type Block,
  type Inline,
  type TableCell,
} from "@/document";
import { updateCommentThreadsForRegionEdit } from "../../anchors";
import { replaceEditorBlock, replaceIndexedDocument, spliceDocumentIndex } from "../index/build";
import { compactInlineNodes } from "../index/shared";
import type {
  DocumentIndex,
  EditorInline,
  EditorRegion,
  RuntimeImageAttributes,
  RuntimeLinkAttributes,
} from "../index/types";
import type { ActionSelection } from "../types";
import {
  normalizeSelection,
  resolveRegion,
  resolveRegionByPath,
  type EditorSelection,
  type NormalizedEditorSelection,
} from "../selection";

export type TextEditResult = {
  documentIndex: DocumentIndex;
  selection: ActionSelection | null;
};

/* Entry point */

export function spliceText(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): TextEditResult {
  const normalized = normalizeSelection(documentIndex, selection);

  if (normalized.start.regionId === normalized.end.regionId) {
    return replaceInSingleRegion(documentIndex, normalized, text);
  }

  return replaceAcrossRegions(documentIndex, normalized, text);
}

/* Single-region replacement */

function replaceInSingleRegion(
  documentIndex: DocumentIndex,
  normalized: NormalizedEditorSelection,
  text: string,
): TextEditResult {
  const region = resolveRegion(documentIndex, normalized.start.regionId);

  if (!region) {
    throw new Error(`Unknown region: ${normalized.start.regionId}`);
  }

  const nextDocument = replaceEditorBlock(documentIndex, region.blockId, (block) =>
    replaceBlockRegionText(block, region, normalized.start.offset, normalized.end.offset, text),
  );

  if (!nextDocument) {
    throw new Error(`Failed to replace block for canvas region: ${region.id}`);
  }

  const nextDocumentIndex = spliceDocumentIndex(documentIndex, nextDocument, region.rootIndex, 1);
  const finalizedDocumentIndex = finalizeCommentsAfterEdit(
    documentIndex,
    nextDocumentIndex,
    region,
    normalized.start.offset,
    normalized.end.offset,
    text,
  );

  const nextRegion = resolveRegionByPath(finalizedDocumentIndex, region.path);

  if (!nextRegion) {
    throw new Error(`Failed to remap region after replacement: ${region.path}`);
  }

  const nextOffset = normalized.start.offset + text.length;

  return {
    documentIndex: finalizedDocumentIndex,
    selection: collapsedSelection(nextRegion.id, nextOffset),
  };
}

function replaceBlockRegionText(
  block: Block,
  region: EditorRegion,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): Block {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return replaceInlineBlockText(block, region, startOffset, endOffset, replacementText);
    case "code":
      return rebuildCodeBlock(
        block,
        replaceRegionSourceText(region, startOffset, endOffset, replacementText),
      );
    case "table":
      return replaceTableCellText(block, region, startOffset, endOffset, replacementText);
    case "unsupported":
      return rebuildRawBlock(
        block,
        replaceRegionSourceText(region, startOffset, endOffset, replacementText),
      );
    default:
      throw new Error(`Canvas text replacement is not supported for block type: ${block.type}`);
  }
}

function replaceInlineBlockText(
  block: Extract<Block, { type: "heading" | "paragraph" }>,
  region: EditorRegion,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): Extract<Block, { type: "heading" | "paragraph" }> {
  return rebuildTextBlock(
    block,
    editRegionInlines(region, startOffset, endOffset, replacementText),
  );
}

function replaceTableCellText(
  block: Extract<Block, { type: "table" }>,
  region: EditorRegion,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): Extract<Block, { type: "table" }> {
  const rowIndex = region.tableCellPosition?.rowIndex;
  const cellIndex = region.tableCellPosition?.cellIndex;

  if (rowIndex === undefined || cellIndex === undefined) {
    throw new Error(`Unable to resolve table cell position for region: ${region.id}`);
  }

  const nextChildren = editRegionInlines(region, startOffset, endOffset, replacementText);
  const rows = block.rows.map((row, currentRowIndex) => {
    if (currentRowIndex !== rowIndex) {
      return row;
    }

    const cells = row.cells.map<TableCell>((cell, currentCellIndex) => {
      if (currentCellIndex !== cellIndex) {
        return cell;
      }

      return createDocumentTableCell({
        children: nextChildren,
      });
    });

    return {
      ...row,
      cells,
    };
  });

  return rebuildTableBlock(block, rows);
}

function replaceRegionSourceText(
  region: EditorRegion,
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
  return replaceEditorInlines(region.inlines, startOffset, endOffset, replacementText)
    .map((run) => run.text)
    .join("");
}

/* Cross-region replacement */

type TextLikeBlock = Extract<Block, { type: "heading" | "paragraph" }>;

function isTextLikeBlock(block: Block | null): block is TextLikeBlock {
  return block !== null && (block.type === "heading" || block.type === "paragraph");
}

function replaceAcrossRegions(
  documentIndex: DocumentIndex,
  normalized: NormalizedEditorSelection,
  text: string,
): TextEditResult {
  const startRegion = resolveRegion(documentIndex, normalized.start.regionId);
  const endRegion = resolveRegion(documentIndex, normalized.end.regionId);

  if (!startRegion || !endRegion) {
    throw new Error("Unknown cross-region selection endpoints.");
  }

  const startRootBlock = documentIndex.document.blocks[startRegion.rootIndex];
  const endRootBlock = documentIndex.document.blocks[endRegion.rootIndex];

  if (!startRootBlock || !endRootBlock) {
    throw new Error("Unknown root blocks for cross-region selection.");
  }

  const prefixBlock = trimBlockToPrefix(startRootBlock, startRegion, normalized.start.offset);
  const suffixBlock = trimBlockToSuffix(endRootBlock, endRegion, normalized.end.offset);
  const merged = mergeTrimmedBlocks(prefixBlock, suffixBlock, text);
  const replacementBlocks =
    merged.blocks.length > 0 ? merged.blocks : [createParagraphTextBlock({ text: "" })];

  const rootIndex = startRegion.rootIndex;
  const count = endRegion.rootIndex - startRegion.rootIndex + 1;
  const nextDocument = spliceDocument(documentIndex.document, rootIndex, count, replacementBlocks);
  const nextDocumentIndex = spliceDocumentIndex(documentIndex, nextDocument, rootIndex, count);
  const finalizedDocumentIndex = finalizeCommentsAfterEdit(
    documentIndex,
    nextDocumentIndex,
    startRegion,
    normalized.start.offset,
    startRegion.text.length,
    isTextLikeBlock(prefixBlock) ? text : "",
  );

  const caretRegion =
    finalizedDocumentIndex.roots[rootIndex + merged.caretLocalIndex]?.regions[0] ?? null;

  return {
    documentIndex: finalizedDocumentIndex,
    selection: collapsedSelection(
      caretRegion?.id ?? startRegion.id,
      caretRegion ? merged.caretOffset : 0,
    ),
  };
}

type MergeResult = {
  blocks: Block[];
  caretLocalIndex: number;
  caretOffset: number;
};

function mergeTrimmedBlocks(
  prefix: Block | null,
  suffix: Block | null,
  insertedText: string,
): MergeResult {
  if (isTextLikeBlock(prefix) && isTextLikeBlock(suffix)) {
    return {
      blocks: [concatenateTextLikeBlocks(prefix, suffix, insertedText)],
      caretLocalIndex: 0,
      caretOffset: prefix.plainText.length + insertedText.length,
    };
  }

  if (isTextLikeBlock(prefix)) {
    const absorbedPrefix =
      insertedText.length > 0 ? appendTextToTextLikeBlock(prefix, insertedText) : prefix;
    const blocks: Block[] = [absorbedPrefix];

    if (suffix) {
      blocks.push(suffix);
    }

    return {
      blocks,
      caretLocalIndex: 0,
      caretOffset: prefix.plainText.length + insertedText.length,
    };
  }

  if (isTextLikeBlock(suffix)) {
    const absorbedSuffix =
      insertedText.length > 0 ? prependTextToTextLikeBlock(suffix, insertedText) : suffix;
    const blocks: Block[] = [];

    if (prefix) {
      blocks.push(prefix);
    }

    const caretLocalIndex = blocks.length;
    blocks.push(absorbedSuffix);

    return { blocks, caretLocalIndex, caretOffset: insertedText.length };
  }

  const blocks: Block[] = [];

  if (prefix) {
    blocks.push(prefix);
  }

  if (insertedText.length > 0) {
    const caretLocalIndex = blocks.length;
    blocks.push(createParagraphTextBlock({ text: insertedText }));

    if (suffix) {
      blocks.push(suffix);
    }

    return { blocks, caretLocalIndex, caretOffset: insertedText.length };
  }

  if (suffix) {
    const caretLocalIndex = blocks.length;
    blocks.push(suffix);

    return { blocks, caretLocalIndex, caretOffset: 0 };
  }

  return { blocks, caretLocalIndex: 0, caretOffset: 0 };
}

function concatenateTextLikeBlocks(
  prefix: TextLikeBlock,
  suffix: TextLikeBlock,
  insertedText: string,
): Block {
  const insertedNodes =
    insertedText.length > 0 ? [createDocumentTextNode({ text: insertedText })] : [];

  return rebuildTextBlock(
    prefix,
    compactInlineNodes([...prefix.children, ...insertedNodes, ...suffix.children]),
  );
}

function appendTextToTextLikeBlock(block: TextLikeBlock, text: string): Block {
  return rebuildTextBlock(
    block,
    compactInlineNodes([...block.children, createDocumentTextNode({ text })]),
  );
}

function prependTextToTextLikeBlock(block: TextLikeBlock, text: string): Block {
  return rebuildTextBlock(
    block,
    compactInlineNodes([createDocumentTextNode({ text }), ...block.children]),
  );
}

/* Block trimming */

function trimBlockToPrefix(block: Block, targetRegion: EditorRegion, offset: number): Block | null {
  if (block.type === "table") {
    return null;
  }

  if (block.id === targetRegion.blockId) {
    return trimLeafBlockToPrefix(block, targetRegion, offset);
  }

  return trimContainerBlock(block, (children) =>
    trimContainerChildrenToPrefix(children, targetRegion, offset),
  );
}

function trimBlockToSuffix(block: Block, targetRegion: EditorRegion, offset: number): Block | null {
  if (block.type === "table") {
    return null;
  }

  if (block.id === targetRegion.blockId) {
    return trimLeafBlockToSuffix(block, targetRegion, offset);
  }

  return trimContainerBlock(block, (children) =>
    trimContainerChildrenToSuffix(children, targetRegion, offset),
  );
}

function trimLeafBlockToPrefix(block: Block, region: EditorRegion, offset: number): Block | null {
  if (offset === 0) {
    return null;
  }

  switch (block.type) {
    case "heading":
    case "paragraph":
      return rebuildTextBlock(block, editRegionInlines(region, offset, region.text.length, ""));
    case "code":
      return rebuildCodeBlock(block, region.text.slice(0, offset));
    case "unsupported":
      return rebuildRawBlock(block, region.text.slice(0, offset));
    default:
      return null;
  }
}

function trimLeafBlockToSuffix(block: Block, region: EditorRegion, offset: number): Block | null {
  if (offset === region.text.length) {
    return null;
  }

  switch (block.type) {
    case "heading":
    case "paragraph":
      return rebuildTextBlock(block, editRegionInlines(region, 0, offset, ""));
    case "code":
      return rebuildCodeBlock(block, region.text.slice(offset));
    case "unsupported":
      return rebuildRawBlock(block, region.text.slice(offset));
    default:
      return null;
  }
}

function trimContainerBlock(
  block: Block,
  trimChildren: <T extends Block>(children: T[]) => T[],
): Block | null {
  switch (block.type) {
    case "blockquote": {
      const nextChildren = trimChildren(block.children);
      return nextChildren.length === 0 ? null : createBlockquoteBlock({ children: nextChildren });
    }
    case "list": {
      const nextItems = trimChildren(block.items);
      return nextItems.length === 0 ? null : rebuildListBlock(block, nextItems);
    }
    case "listItem": {
      const nextChildren = trimChildren(block.children);
      return nextChildren.length === 0 ? null : rebuildListItemBlock(block, nextChildren);
    }
    default:
      return null;
  }
}

function trimContainerChildrenToPrefix<T extends Block>(
  children: T[],
  targetRegion: EditorRegion,
  offset: number,
): T[] {
  const targetIndex = children.findIndex((child) => blockContainsRegion(child, targetRegion));

  if (targetIndex === -1) {
    return [];
  }

  const preservedSiblings = children.slice(0, targetIndex);
  const trimmedTarget = trimBlockToPrefix(children[targetIndex]!, targetRegion, offset);

  return trimmedTarget ? [...preservedSiblings, trimmedTarget as T] : preservedSiblings;
}

function trimContainerChildrenToSuffix<T extends Block>(
  children: T[],
  targetRegion: EditorRegion,
  offset: number,
): T[] {
  const targetIndex = children.findIndex((child) => blockContainsRegion(child, targetRegion));

  if (targetIndex === -1) {
    return [];
  }

  const preservedSiblings = children.slice(targetIndex + 1);
  const trimmedTarget = trimBlockToSuffix(children[targetIndex]!, targetRegion, offset);

  return trimmedTarget ? [trimmedTarget as T, ...preservedSiblings] : preservedSiblings;
}

function blockContainsRegion(block: Block, region: EditorRegion): boolean {
  if (block.id === region.blockId) {
    return true;
  }

  switch (block.type) {
    case "blockquote":
    case "listItem":
      return block.children.some((child) => blockContainsRegion(child, region));
    case "list":
      return block.items.some((item) => blockContainsRegion(item, region));
    default:
      return false;
  }
}

/* Comments */

function finalizeCommentsAfterEdit(
  previousDocumentIndex: DocumentIndex,
  nextDocumentIndex: DocumentIndex,
  region: EditorRegion,
  startOffset: number,
  endOffset: number,
  insertedText: string,
): DocumentIndex {
  if (previousDocumentIndex.document.comments.length === 0) {
    return nextDocumentIndex;
  }

  const nextComments = updateCommentThreadsForRegionEdit(
    previousDocumentIndex,
    nextDocumentIndex,
    region,
    startOffset,
    endOffset,
    insertedText,
  );

  return nextComments === nextDocumentIndex.document.comments
    ? nextDocumentIndex
    : replaceIndexedDocument(nextDocumentIndex, {
        ...nextDocumentIndex.document,
        comments: nextComments,
      });
}

/* Helpers */

function collapsedSelection(regionId: string, offset: number): EditorSelection {
  return {
    anchor: { regionId, offset },
    focus: { regionId, offset },
  };
}

/* Editor inline manipulation */

type DraftEditorInline = Omit<EditorInline, "end" | "start">;

function editRegionInlines(
  region: EditorRegion,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): Inline[] {
  return editorInlinesToDocumentInlines(
    replaceEditorInlines(region.inlines, startOffset, endOffset, replacementText),
  );
}

export function replaceEditorInlines(
  inlines: EditorInline[],
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
  const context = {
    didInsert: false,
    generatedRunCount: 0,
    replacementText,
  };
  const nextInlines = editEditorInlines(inlines, startOffset, endOffset, context);

  return finalizeEditorInlines(compactEditorInlines(nextInlines));
}

export function editorInlinesToDocumentInlines(inlines: EditorInline[]): Inline[] {
  const nodes: Inline[] = [];

  for (let index = 0; index < inlines.length; index += 1) {
    const run = inlines[index]!;

    if (run.link) {
      const children: Inline[] = [];
      const link = run.link;

      while (index < inlines.length && sameRuntimeLink(inlines[index]!.link, link)) {
        const child = editorInlineToDocumentInline(inlines[index]!);

        if (child) {
          children.push(child);
        }

        index += 1;
      }

      index -= 1;

      if (children.length > 0) {
        nodes.push(
          createDocumentLinkNode({
            children: compactInlineNodes(children),
            title: link.title,
            url: link.url,
          }),
        );
      }

      continue;
    }

    const node = editorInlineToDocumentInline(run);

    if (node) {
      nodes.push(node);
    }
  }

  return compactInlineNodes(nodes);
}

function editEditorInlines(
  inlines: EditorInline[],
  startOffset: number,
  endOffset: number,
  context: {
    didInsert: boolean;
    generatedRunCount: number;
    replacementText: string;
  },
): DraftEditorInline[] {
  const nextInlines: DraftEditorInline[] = [];

  for (const [index, run] of inlines.entries()) {
    if (!context.didInsert && startOffset === endOffset && startOffset === run.start) {
      pushGeneratedTextRun(
        nextInlines,
        context,
        resolveBoundaryLinkForInsertion(inlines[index - 1] ?? null, run),
      );
    }

    if (endOffset <= run.start || startOffset >= run.end) {
      nextInlines.push(createDraftEditorInline(run));
      continue;
    }

    const localStart = Math.max(0, startOffset - run.start);
    const localEnd = Math.min(run.text.length, endOffset - run.start);
    const replacement =
      !context.didInsert && context.replacementText.length > 0 ? context.replacementText : "";
    const nextForRun = replaceEditorInline(run, localStart, localEnd, replacement, context);

    if (localStart !== localEnd || replacement.length > 0) {
      context.didInsert = true;
    }

    nextInlines.push(...nextForRun);
  }

  if (!context.didInsert) {
    pushGeneratedTextRun(
      nextInlines,
      context,
      resolveBoundaryLinkForInsertion(inlines.at(-1) ?? null, null),
    );
  }

  return nextInlines;
}

function replaceEditorInline(
  run: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  context: {
    didInsert: boolean;
    generatedRunCount: number;
    replacementText: string;
  },
) {
  switch (run.kind) {
    case "text":
    case "inlineCode":
    case "unsupported":
      return replaceTextLikeEditorInline(run, startOffset, endOffset, replacementText);
    case "break":
      return replaceBreakEditorInline(run, startOffset, endOffset, replacementText, context);
    case "image":
      return replaceImageEditorInline(run, startOffset, endOffset, replacementText);
  }
}

function replaceTextLikeEditorInline(
  run: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
  const nextText = run.text.slice(0, startOffset) + replacementText + run.text.slice(endOffset);

  return nextText.length > 0
    ? [
        {
          ...createDraftEditorInline(run),
          text: nextText,
        },
      ]
    : [];
}

function replaceBreakEditorInline(
  run: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  context: {
    didInsert: boolean;
    generatedRunCount: number;
    replacementText: string;
  },
) {
  if (startOffset === endOffset) {
    return [createDraftEditorInline(run)];
  }

  const nextInlines: DraftEditorInline[] = [];

  if (replacementText.length > 0) {
    pushGeneratedTextRun(nextInlines, context, run.link);
  }

  return nextInlines;
}

function replaceImageEditorInline(
  run: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
  if (startOffset === 0 && endOffset === run.text.length) {
    return replacementText.length > 0 ? [createGeneratedTextRun(replacementText, run.link, 0)] : [];
  }

  return [createDraftEditorInline(run)];
}

function pushGeneratedTextRun(
  inlines: DraftEditorInline[],
  context: {
    didInsert: boolean;
    generatedRunCount: number;
    replacementText: string;
  },
  link: RuntimeLinkAttributes | null,
) {
  if (context.replacementText.length === 0) {
    context.didInsert = true;
    return;
  }

  inlines.push(createGeneratedTextRun(context.replacementText, link, context.generatedRunCount));
  context.generatedRunCount += 1;
  context.didInsert = true;
}

function createGeneratedTextRun(
  text: string,
  link: RuntimeLinkAttributes | null,
  index: number,
): DraftEditorInline {
  return {
    id: `generated:${index}`,
    image: null,
    inlineCode: false,
    kind: "text",
    link,
    marks: [],
    originalType: null,
    text,
  };
}

function resolveBoundaryLinkForInsertion(
  previousRun: EditorInline | null,
  nextRun: EditorInline | null,
) {
  return previousRun?.link && nextRun?.link && sameRuntimeLink(previousRun.link, nextRun.link)
    ? previousRun.link
    : null;
}

function createDraftEditorInline(run: EditorInline): DraftEditorInline {
  return {
    id: run.id,
    image: run.image,
    inlineCode: run.inlineCode,
    kind: run.kind,
    link: run.link,
    marks: run.marks,
    originalType: run.originalType,
    text: run.text,
  };
}

function finalizeEditorInlines(inlines: DraftEditorInline[]) {
  const finalized: EditorInline[] = [];
  let position = 0;

  for (const run of inlines) {
    const start = position;
    const end = start + run.text.length;

    finalized.push({
      ...run,
      end,
      start,
    });
    position = end;
  }

  return finalized;
}

function compactEditorInlines(inlines: DraftEditorInline[]) {
  const compacted: DraftEditorInline[] = [];

  for (const run of inlines) {
    const previous = compacted.at(-1);

    if (previous && canMergeEditorInlines(previous, run)) {
      compacted[compacted.length - 1] = {
        ...previous,
        text: previous.text + run.text,
      };
      continue;
    }

    compacted.push(run);
  }

  return compacted;
}

function canMergeEditorInlines(previous: DraftEditorInline, next: DraftEditorInline) {
  return (
    previous.kind === next.kind &&
    previous.inlineCode === next.inlineCode &&
    sameRuntimeLink(previous.link, next.link) &&
    sameRuntimeImage(previous.image, next.image) &&
    previous.originalType === next.originalType &&
    previous.marks.join(",") === next.marks.join(",")
  );
}

function editorInlineToDocumentInline(run: EditorInline): Inline | null {
  switch (run.kind) {
    case "break":
      return createDocumentLineBreakNode();
    case "image":
      return run.image ? createImageNodeFromRuntimeAttributes(run.image) : null;
    case "inlineCode":
      return createDocumentInlineCodeNode({
        code: run.text,
      });
    case "text":
      return run.text.length > 0
        ? createDocumentTextNode({
            marks: run.marks,
            text: run.text,
          })
        : null;
    case "unsupported":
      return createDocumentUnsupportedInlineNode({
        originalType: run.originalType ?? "unsupported",
        source: run.text,
      });
  }
}

function createImageNodeFromRuntimeAttributes(image: RuntimeImageAttributes) {
  return createDocumentImageNode({
    alt: image.alt,
    title: image.title,
    url: image.url,
    width: image.width,
  });
}

function sameRuntimeLink(left: RuntimeLinkAttributes | null, right: RuntimeLinkAttributes | null) {
  return left?.url === right?.url && left?.title === right?.title;
}

function sameRuntimeImage(
  left: RuntimeImageAttributes | null,
  right: RuntimeImageAttributes | null,
) {
  return (
    left?.url === right?.url &&
    left?.title === right?.title &&
    left?.alt === right?.alt &&
    left?.width === right?.width
  );
}
