// Block-level mutations driven by a selection range.
//
// Two entry points:
//   - `spliceText` — the hot path for typing, paste-as-text, and cross-region
//     deletes. Inline edits inside a single region stay in `editRegionInlines`;
//     anything that crosses a region boundary is reframed as a structural
//     splice with a synthesized one-paragraph fragment.
//   - `replaceWithBlocks` — the structural path. Replaces the selection with
//     an arbitrary `Block[]` fragment, taking care of trimming the boundary
//     roots, joining the fragment to them at the seams, and re-targeting the
//     caret. Used by markdown paste; `spliceText` reuses it for the cross-
//     region text case so seam logic stays single-sourced.
//
// Low-level inline rewrites live in ./inlines — this file owns the
// block/region-level orchestration.

import {
  createParagraphTextBlock,
  createTableCell as createDocumentTableCell,
  rebuildCodeBlock,
  rebuildRawBlock,
  rebuildTableBlock,
  rebuildTextBlock,
  spliceDocument,
  type Block,
  type TableCell,
} from "@/document";
import { updateCommentThreadsForRegionEdit } from "../../anchors";
import { mergeTrimmedBlocks, trimBlockToPrefix, trimBlockToSuffix } from "../fragment/blocks";
import { replaceEditorBlock, replaceIndexedDocument, spliceDocumentIndex } from "../index/build";
import type { DocumentIndex, EditorRegion } from "../index/types";
import {
  createDescendantPrimaryRegionTarget,
  createRegionTarget,
  normalizeSelection,
  resolveRegion,
  resolveRegionByPath,
  type EditorSelection,
  type NormalizedEditorSelection,
  type SelectionTarget,
} from "../selection";
import { editRegionInlines, replaceEditorInlines } from "./inlines";

export type TextEditResult = {
  documentIndex: DocumentIndex;
  selection: SelectionTarget | null;
};

/* Entry points */

export function spliceText(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): TextEditResult {
  const normalized = normalizeSelection(documentIndex, selection);

  if (normalized.start.regionId === normalized.end.regionId) {
    return replaceInSingleRegion(documentIndex, normalized, text);
  }

  // Cross-region text edits reuse the structural path — model the inserted
  // text as a single-paragraph fragment so seam logic (text-like absorb,
  // bridge-merge) lives in one place. The merge itself reports what got
  // absorbed into the start-region, so comment repair stays accurate
  // without the caller threading the text through.
  const fragment = text.length > 0 ? [createParagraphTextBlock({ text })] : [];

  return replaceWithBlocks(documentIndex, selection, fragment);
}

// Replaces the selection with a structural fragment. The merge result
// tells `finalizeCommentsAfterEdit` how many characters from the fragment
// landed inside the start region (via front-seam absorb), so threads
// anchored before the edit point stay correctly offset.
export function replaceWithBlocks(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  fragment: Block[],
): TextEditResult {
  const normalized = normalizeSelection(documentIndex, selection);

  const startRegion = resolveRegion(documentIndex, normalized.start.regionId);
  const endRegion = resolveRegion(documentIndex, normalized.end.regionId);

  if (!startRegion || !endRegion) {
    throw new Error("Unknown selection endpoints.");
  }

  const startRoot = documentIndex.document.blocks[startRegion.rootIndex];
  const endRoot = documentIndex.document.blocks[endRegion.rootIndex];

  if (!startRoot || !endRoot) {
    throw new Error("Unknown root blocks for selection.");
  }

  const prefix = trimBlockToPrefix(startRoot, startRegion, normalized.start.offset);
  const suffix = trimBlockToSuffix(endRoot, endRegion, normalized.end.offset);
  const merged = mergeTrimmedBlocks(prefix, fragment, suffix);
  const replacementBlocks =
    merged.blocks.length > 0 ? merged.blocks : [createParagraphTextBlock({ text: "" })];

  const rootIndex = startRegion.rootIndex;
  const count = endRegion.rootIndex - startRegion.rootIndex + 1;
  const nextDocument = spliceDocument(documentIndex.document, rootIndex, count, replacementBlocks);
  const nextDocumentIndex = spliceDocumentIndex(documentIndex, nextDocument, rootIndex, count);
  // For cross-region selections the rest of the start region is consumed by
  // the splice — comment-repair sees a deletion through end-of-region. For
  // single-region selections only the selected slice is gone.
  // Only run the offset-based optimistic comment repair when the merge
  // result keeps the start region's content at the new root[0]. When it
  // doesn't, anchor offsets in the start region are no longer meaningful
  // — the full content-addressable resolver in `getCommentState` will
  // re-anchor the threads on the next read.
  const startRegionEditEnd =
    startRegion === endRegion ? normalized.end.offset : startRegion.text.length;
  const finalizedDocumentIndex = merged.startRegionPreservedAtRoot0
    ? finalizeCommentsAfterEdit(
        documentIndex,
        nextDocumentIndex,
        startRegion,
        normalized.start.offset,
        startRegionEditEnd,
        merged.startRegionInsertedText,
      )
    : nextDocumentIndex;

  return {
    documentIndex: finalizedDocumentIndex,
    selection: createDescendantPrimaryRegionTarget(
      rootIndex + merged.caretLocalIndex,
      merged.caretChildIndices,
      merged.caretOffset,
    ),
  };
}

/* Single-region replacement (typing hot path) */

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
    throw new Error(`Failed to replace block for region: ${region.id}`);
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

  return {
    documentIndex: finalizedDocumentIndex,
    selection: createRegionTarget(nextRegion.id, normalized.start.offset + text.length),
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
      return rebuildTextBlock(
        block,
        editRegionInlines(region, startOffset, endOffset, replacementText),
      );
    case "code":
      return rebuildCodeBlock(
        block,
        replaceRegionSourceText(region, startOffset, endOffset, replacementText),
      );
    case "table":
      return replaceTableCellText(block, region, startOffset, endOffset, replacementText);
    case "raw":
      return rebuildRawBlock(
        block,
        replaceRegionSourceText(region, startOffset, endOffset, replacementText),
      );
    default:
      throw new Error(`Region text replacement is not supported for block type: ${block.type}`);
  }
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

    const cells = row.cells.map<TableCell>((cell, currentCellIndex) =>
      currentCellIndex === cellIndex
        ? createDocumentTableCell({ children: nextChildren })
        : cell,
    );

    return { ...row, cells };
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

/* Comment thread repair */

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
