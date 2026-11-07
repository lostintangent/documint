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
  cloneBlockTree,
  createParagraphTextBlock,
  createTableCell as createDocumentTableCell,
  rebuildCodeBlock,
  rebuildRawBlock,
  rebuildTableBlock,
  rebuildTextBlock,
  spliceDocument,
  type Block,
} from "@/document";
import { carryComments } from "../../anchors";
import { trimBlockToPrefix, trimBlockToSuffix } from "../fragments/blocks";
import { mergeTrimmedBlocks } from "./fragments";
import { resolveIndexedText } from "../index/query";
import { replaceEditorBlock, replaceIndexedDocument, spliceDocumentIndex } from "../index/splice";
import type { DocumentIndex, IndexedText, ResolvedMetadataText } from "../index/types";
import {
  normalizeSelection,
  resolveMetadataSelectionContext,
  target,
  type EditorSelection,
  type NormalizedEditorSelection,
  type SelectionTarget,
} from "../selection";
import { resolveFragmentRange } from "../fragments/context";
import { editIndexedInlines } from "./inlines";

type TextEditResult = {
  documentIndex: DocumentIndex;
  selection: SelectionTarget | null;
};

/* Entry points */

export function spliceText(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): TextEditResult | null {
  const metadataContext = resolveMetadataSelectionContext(documentIndex, selection);

  if (metadataContext !== undefined) {
    return metadataContext
      ? replaceMetadataText(documentIndex, metadataContext.normalized, metadataContext.field, text)
      : null;
  }

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

function replaceMetadataText(
  documentIndex: DocumentIndex,
  normalized: NormalizedEditorSelection,
  metadataField: ResolvedMetadataText,
  replacementText: string,
): TextEditResult | null {
  const metadata = documentIndex.document.metadata;
  if (!metadata || "raw" in metadata) {
    return null;
  }

  if (replacementText.includes("\r")) {
    return null;
  }

  const entries = [...metadata];
  const [currentKey, currentValue] = entries[metadataField.fieldIndex]!;
  const nextText = replacePathText(
    metadataField.text,
    normalized.start.offset,
    normalized.end.offset,
    replacementText,
  );

  if (nextText === metadataField.text) {
    return null;
  }

  let nextEntry: [string, string | boolean];
  if (metadataField.type === "key") {
    if (/[\r\n]/.test(nextText)) {
      return null;
    }

    const collides = entries.some(
      ([key], fieldIndex) => fieldIndex !== metadataField.fieldIndex && key === nextText,
    );
    if (collides) {
      return null;
    }

    nextEntry = [nextText, currentValue];
  } else {
    nextEntry = [currentKey, nextText];
  }

  entries[metadataField.fieldIndex] = nextEntry;
  const nextDocumentIndex = replaceIndexedDocument(documentIndex, {
    ...documentIndex.document,
    metadata: new Map(entries),
  });

  return {
    documentIndex: nextDocumentIndex,
    selection: target.path(normalized.start.path, normalized.start.offset + replacementText.length),
  };
}

// Replaces the selection with a structural fragment. The merge result tells
// comment carry how many characters from the fragment landed inside the
// start path (via front-seam absorb), so threads anchored before the edit
// point stay correctly offset. The fragment is cloned first, because a copy
// can hand back the document's own nodes and a Document never holds a node
// twice.
export function replaceWithBlocks(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  fragment: Block[],
): TextEditResult {
  const range = resolveFragmentRange(documentIndex, selection);

  if (!range) {
    throw new Error("Unknown selection endpoints.");
  }

  const { end, start } = range;
  const merged = mergeTrimmedBlocks(
    trimBlockToPrefix(start.root, start),
    fragment.map(cloneBlockTree),
    trimBlockToSuffix(end.root, end),
  );
  const replacementBlocks =
    merged.blocks.length > 0 ? merged.blocks : [createParagraphTextBlock("")];

  const rootIndex = start.indexedBlock.rootIndex;
  const count = end.indexedBlock.rootIndex - rootIndex + 1;
  const nextDocument = spliceDocument(documentIndex.document, rootIndex, count, replacementBlocks);
  const nextDocumentIndex = spliceDocumentIndex(documentIndex, nextDocument, rootIndex, count);
  // For cross-path selections the rest of the start path is consumed by
  // the splice — comment-repair sees a deletion through end-of-path. For
  // single-path selections only the selected slice is gone.
  // Remapping start-path comments through the edit needs the start path's
  // content at the new root[0] and, for a single path, the text after the
  // edit still following it there. Otherwise anchor offsets in the start path
  // are no longer meaningful, and the commit's carry re-resolves them.
  const singlePath = start.path === end.path;
  const startPathEditEnd = singlePath ? end.offset : start.text.length;
  const canRepairStartPath =
    merged.startPathPreservedAtRoot0 && !(singlePath && merged.suffixLeavesStartPath);
  const finalizedDocumentIndex = canRepairStartPath
    ? carryComments(documentIndex, nextDocumentIndex, {
        edit: {
          endOffset: startPathEditEnd,
          insertedText: merged.startPathInsertedText,
          path: start.path,
          startOffset: start.offset,
        },
      })
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
  const indexedText = resolveIndexedText(documentIndex, path);

  if (!indexedText) {
    return null;
  }

  const nextDocumentIndex = replaceEditorBlock(
    documentIndex,
    "cell" in indexedText ? indexedText.tablePath : path,
    (block) =>
      replaceBlockPathText(
        block,
        indexedText,
        normalized.start.offset,
        normalized.end.offset,
        text,
      ),
  );

  if (!nextDocumentIndex) {
    throw new Error(`Failed to replace block for editor path: ${path}`);
  }

  return {
    documentIndex: carryComments(documentIndex, nextDocumentIndex, {
      edit: {
        endOffset: normalized.end.offset,
        insertedText: text,
        path,
        startOffset: normalized.start.offset,
      },
    }),
    selection: target.path(path, normalized.start.offset + text.length),
  };
}

function replaceBlockPathText(
  block: Block,
  indexedText: IndexedText,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): Block {
  if ("cell" in indexedText && block.type === "table") {
    const { cellIndex, rowIndex } = indexedText;
    const nextCell = createDocumentTableCell(
      editIndexedInlines(indexedText.inlines, startOffset, endOffset, replacementText),
    );

    return rebuildTableBlock(
      block,
      block.rows.map((row, index) =>
        index === rowIndex
          ? {
              ...row,
              cells: row.cells.map((cell, index) => (index === cellIndex ? nextCell : cell)),
            }
          : row,
      ),
    );
  }

  if ("inlines" in indexedText && (block.type === "heading" || block.type === "paragraph")) {
    return rebuildTextBlock(
      block,
      editIndexedInlines(indexedText.inlines, startOffset, endOffset, replacementText),
    );
  }

  const nextText = replacePathText(indexedText.text, startOffset, endOffset, replacementText);

  switch (block.type) {
    case "code":
      return rebuildCodeBlock(block, nextText);
    case "raw":
      return rebuildRawBlock(block, nextText);
    default:
      throw new Error(`Path text replacement is not supported for block type: ${block.type}`);
  }
}

function replacePathText(
  currentText: string,
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
  return currentText.slice(0, startOffset) + replacementText + currentText.slice(endOffset);
}
