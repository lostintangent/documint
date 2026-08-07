// Block-level mutations driven by a selection range.
//
// Two entry points:
//   - `spliceText` — the hot path for typing, paste-as-text, and cross-path
//     deletes. Inline edits inside one path use indexed inline projections;
//     anything that crosses a path boundary is reframed as a structural
//     splice with a synthesized one-paragraph fragment.
//   - `replaceWithBlocks` — the structural path. Replaces the selection with
//     an arbitrary `Block[]` fragment, taking care of trimming the boundary
//     roots, joining the fragment to them at the seams, and re-targeting the
//     caret. Used by markdown paste; `spliceText` reuses it for the cross-
//     path text case so seam logic stays single-sourced.
//
// Low-level inline rewrites live in ./inlines — this file owns the
// block/path-level orchestration.

import {
  blockPathFromCoordinates,
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
import { updateCommentThreadsForPathEdit } from "../../anchors";
import { trimBlockToPrefix, trimBlockToSuffix } from "../fragments/blocks";
import { mergeTrimmedBlocks } from "./fragments";
import {
  resolveIndexedBlockContainingPath,
  resolveIndexedText,
  resolveIndexedTextInlines,
  resolveIndexedTableCell,
} from "../index/query";
import { replaceDocumentMetadata, replaceEditorBlock, spliceDocumentIndex } from "../index/splice";
import type { DocumentIndex, IndexedBlock, IndexedInline } from "../index/types";
import {
  normalizeSelection,
  target,
  type EditorSelection,
  type NormalizedEditorSelection,
  type SelectionTarget,
} from "../selection";
import { resolveFragmentEndpoint } from "../fragments/context";
import { editorInlinesToDocumentInlines, replaceEditorInlines } from "./inlines";

export type TextEditResult = {
  documentIndex: DocumentIndex;
  selection: SelectionTarget | null;
};

/* Entry points */

export function spliceText(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): TextEditResult | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (normalized.start.path === normalized.end.path) {
    return replaceInSinglePath(documentIndex, normalized, text);
  }

  // Cross-path text edits reuse the structural path — model the inserted
  // text as a single-paragraph fragment so seam logic (text-like absorb,
  // bridge-merge) lives in one place. The merge itself reports what got
  // absorbed into the start path, so comment repair stays accurate
  // without the caller threading the text through.
  const fragment = text.length > 0 ? [createParagraphTextBlock(text)] : [];

  return replaceWithBlocks(documentIndex, selection, fragment);
}

// Replaces the selection with a structural fragment. The merge result
// tells `finalizeCommentsAfterEdit` how many characters from the fragment
// landed inside the start path (via front-seam absorb), so threads
// anchored before the edit point stay correctly offset.
export function replaceWithBlocks(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  fragment: Block[],
): TextEditResult {
  const normalized = normalizeSelection(documentIndex, selection);

  const startEndpoint = resolveFragmentEndpoint(documentIndex, normalized.start.path);
  const endEndpoint = resolveFragmentEndpoint(documentIndex, normalized.end.path);

  if (!startEndpoint || !endEndpoint) {
    throw new Error("Unknown selection endpoints.");
  }

  const startRoot = documentIndex.document.blocks[startEndpoint.indexedBlock.rootIndex];
  const endRoot = documentIndex.document.blocks[endEndpoint.indexedBlock.rootIndex];

  if (!startRoot || !endRoot) {
    throw new Error("Unknown root blocks for selection.");
  }

  const prefix = trimBlockToPrefix(startRoot, startEndpoint, normalized.start.offset);
  const suffix = trimBlockToSuffix(endRoot, endEndpoint, normalized.end.offset);
  const merged = mergeTrimmedBlocks(prefix, fragment, suffix);
  const replacementBlocks =
    merged.blocks.length > 0 ? merged.blocks : [createParagraphTextBlock("")];

  const rootIndex = startEndpoint.indexedBlock.rootIndex;
  const count = endEndpoint.indexedBlock.rootIndex - startEndpoint.indexedBlock.rootIndex + 1;
  const nextDocument = spliceDocument(documentIndex.document, rootIndex, count, replacementBlocks);
  const nextDocumentIndex = spliceDocumentIndex(documentIndex, nextDocument, rootIndex, count);
  // For cross-path selections the rest of the start path is consumed by
  // the splice — comment-repair sees a deletion through end-of-path. For
  // single-path selections only the selected slice is gone.
  // Only run the offset-based optimistic comment repair when the merge
  // result keeps the start path's content at the new root[0]. When it
  // doesn't, anchor offsets in the start path are no longer meaningful
  // — the full content-addressable resolver in `getCommentState` will
  // re-anchor the threads on the next read.
  const startPathEditEnd =
    startEndpoint.path === endEndpoint.path ? normalized.end.offset : startEndpoint.text.length;
  const finalizedDocumentIndex = merged.startPathPreservedAtRoot0
    ? finalizeCommentsAfterEdit(
        documentIndex,
        nextDocumentIndex,
        startEndpoint.path,
        normalized.start.offset,
        startPathEditEnd,
        merged.startPathInsertedText,
      )
    : nextDocumentIndex;

  const caretBlockPath = blockPathFromCoordinates(
    rootIndex + merged.caretLocalIndex,
    merged.caretChildIndices,
  );
  if (!caretBlockPath) {
    throw new Error("Cross-path text edit resolved to an invalid caret block path.");
  }

  return {
    documentIndex: finalizedDocumentIndex,
    selection: target.blockPath(caretBlockPath, merged.caretOffset),
  };
}

/* Single-path replacement (typing hot path) */

function replaceInSinglePath(
  documentIndex: DocumentIndex,
  normalized: NormalizedEditorSelection,
  text: string,
): TextEditResult | null {
  const path = normalized.start.path;
  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);
  const indexedText = resolveIndexedText(documentIndex, path);

  if (!indexedBlock || !indexedText) {
    return null;
  }

  const nextDocumentIndex = replaceEditorBlock(documentIndex, indexedBlock.path, (block) =>
    replaceBlockPathText(
      documentIndex,
      block,
      indexedBlock,
      path,
      indexedText.text,
      resolveIndexedTextInlines(indexedText),
      normalized,
      text,
    ),
  );

  if (!nextDocumentIndex) {
    throw new Error(`Failed to replace block for editor path: ${path}`);
  }

  const finalizedDocumentIndex =
    documentIndex.document.comments.length === 0
      ? nextDocumentIndex
      : finalizeCommentsAfterPathEdit(
          documentIndex,
          nextDocumentIndex,
          path,
          normalized.start.offset,
          normalized.end.offset,
          text,
        );

  return {
    documentIndex: finalizedDocumentIndex,
    selection: target.path(path, normalized.start.offset + text.length),
  };
}

function finalizeCommentsAfterPathEdit(
  previousDocumentIndex: DocumentIndex,
  nextDocumentIndex: DocumentIndex,
  path: string,
  startOffset: number,
  endOffset: number,
  insertedText: string,
): DocumentIndex {
  return finalizeCommentsAfterEdit(
    previousDocumentIndex,
    nextDocumentIndex,
    path,
    startOffset,
    endOffset,
    insertedText,
  );
}

function replaceBlockPathText(
  documentIndex: DocumentIndex,
  block: Block,
  indexedBlock: IndexedBlock,
  path: string,
  currentText: string,
  currentInlines: readonly IndexedInline[] | null,
  normalized: NormalizedEditorSelection,
  replacementText: string,
): Block {
  const startOffset = normalized.start.offset;
  const endOffset = normalized.end.offset;

  switch (block.type) {
    case "code":
      return rebuildCodeBlock(
        block,
        replacePathText(currentText, startOffset, endOffset, replacementText),
      );
    case "raw":
      return rebuildRawBlock(
        block,
        replacePathText(currentText, startOffset, endOffset, replacementText),
      );
    case "heading":
    case "paragraph": {
      if (!currentInlines) {
        throw new Error(`Inline text replacement is not supported for block type: ${block.type}`);
      }

      return rebuildTextBlock(
        block,
        editPathInlines(currentInlines, startOffset, endOffset, replacementText, path),
      );
    }
    case "table":
      return replaceTableCellText(
        documentIndex,
        block,
        indexedBlock,
        path,
        startOffset,
        endOffset,
        replacementText,
      );
    default:
      throw new Error(`Path text replacement is not supported for block type: ${block.type}`);
  }
}

function replaceTableCellText(
  documentIndex: DocumentIndex,
  block: Extract<Block, { type: "table" }>,
  indexedBlock: IndexedBlock,
  path: string,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): Extract<Block, { type: "table" }> {
  const indexedCell = resolveIndexedTableCell(documentIndex, path);
  const rowIndex = indexedCell?.rowIndex;
  const cellIndex = indexedCell?.cellIndex;

  if (
    indexedBlock.kind !== "cells" ||
    rowIndex === undefined ||
    cellIndex === undefined ||
    !indexedCell
  ) {
    throw new Error(`Unable to resolve table cell position for editor path: ${path}`);
  }

  const nextChildren = editPathInlines(
    indexedCell.inlines,
    startOffset,
    endOffset,
    replacementText,
    path,
  );
  const rows = block.rows.map((row, currentRowIndex) => {
    if (currentRowIndex !== rowIndex) {
      return row;
    }

    const cells = row.cells.map<TableCell>((cell, currentCellIndex) =>
      currentCellIndex === cellIndex ? createDocumentTableCell(nextChildren) : cell,
    );

    return { ...row, cells };
  });

  return rebuildTableBlock(block, rows);
}

function editPathInlines(
  inlines: readonly IndexedInline[] | null,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  path: string,
) {
  if (!inlines) {
    throw new Error(`Editor path does not expose indexed inlines: ${path}`);
  }

  return editorInlinesToDocumentInlines(
    replaceEditorInlines(inlines, startOffset, endOffset, replacementText),
  );
}

function replacePathText(
  currentText: string,
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
  return currentText.slice(0, startOffset) + replacementText + currentText.slice(endOffset);
}

/* Comment thread repair */

function finalizeCommentsAfterEdit(
  previousDocumentIndex: DocumentIndex,
  nextDocumentIndex: DocumentIndex,
  path: string,
  startOffset: number,
  endOffset: number,
  insertedText: string,
): DocumentIndex {
  if (previousDocumentIndex.document.comments.length === 0) {
    return nextDocumentIndex;
  }

  const nextComments = updateCommentThreadsForPathEdit(
    previousDocumentIndex,
    nextDocumentIndex,
    path,
    startOffset,
    endOffset,
    insertedText,
  );

  return nextComments === nextDocumentIndex.document.comments
    ? nextDocumentIndex
    : replaceDocumentMetadata(nextDocumentIndex, {
        ...nextDocumentIndex.document,
        comments: nextComments,
      });
}
