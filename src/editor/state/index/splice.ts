// Public splice API: the entry points the rest of the codebase uses to
// build or update a `DocumentIndex`. Each routes through `applyRootDelta`
// after constructing the positioned roots. `createRuntimeEditableDocument` /
// `collapseRuntimeEditableDocument` are the empty-document shim so a fresh
// editor always has at least one paragraph to host a caret.

import {
  createDocument,
  createParagraphTextBlock,
  mapBlockTree,
  spliceDocument,
  type Block,
  type Document,
} from "@/document";
import { getCommentState } from "../../anchors";
import { applyRootDelta } from "./build";
import { createRootEntry, positionRootEntries } from "./roots";
import type { DocumentIndex } from "./types";

export function createDocumentIndex(document: Document): DocumentIndex {
  const runtimeDocument = createRuntimeEditableDocument(document);
  const positionedRoots = positionRootEntries(
    runtimeDocument.blocks.map((block, rootIndex) => createRootEntry(block, rootIndex)),
  );

  return applyRootDelta(null, positionedRoots, runtimeDocument);
}

// Materialize a savable `Document` from a `DocumentIndex`, undoing the
// empty-document shim and committing any anchor-repair `getCommentState`
// produced from the most recent edits. Use this at persistence boundaries —
// "save the editor's current state to markdown" — not during normal editing.
export function commitDocument(documentIndex: DocumentIndex): Document {
  const commentState = getCommentState(documentIndex);

  return createDocument(
    collapseRuntimeEditableDocument(documentIndex.document).blocks,
    commentState.threads,
    documentIndex.document.frontMatter,
  );
}

export function spliceDocumentIndex(
  model: DocumentIndex,
  nextDocument: Document,
  rootIndex: number,
  count: number,
): DocumentIndex {
  const replacementCount = nextDocument.blocks.length - (model.roots.length - count);

  if (replacementCount < 0) {
    throw new Error("Editor model splice received an invalid replacement count.");
  }

  const canPreserveSuffixRoots = replacementCount === count;
  const unpositionedRoots = [
    ...model.roots.slice(0, rootIndex),
    ...nextDocument.blocks
      .slice(rootIndex, rootIndex + replacementCount)
      .map((block, index) => createRootEntry(block, rootIndex + index)),
    ...(canPreserveSuffixRoots
      ? model.roots.slice(rootIndex + count)
      : nextDocument.blocks
          .slice(rootIndex + replacementCount)
          .map((block, index) => createRootEntry(block, rootIndex + replacementCount + index))),
  ];
  const positionedRoots = positionRootEntries(unpositionedRoots, model.roots);

  return applyRootDelta(model, positionedRoots, nextDocument);
}

// Replace the index's document where only comments or front matter changed;
// every root keeps reference identity. Throws if blocks differ — that's a
// splice, not a metadata replace.
export function replaceDocumentMetadata(model: DocumentIndex, document: Document): DocumentIndex {
  if (document.blocks !== model.document.blocks) {
    throw new Error(
      "Editor model metadata replacement requires preserving root blocks.",
    );
  }

  return applyRootDelta(model, model.roots, document);
}

// Replace a single block (by id) inside the document, rebuilding the
// containing root via the shared `mapBlockTree` primitive and committing
// the change with `spliceDocument` + `spliceDocumentIndex` (warm path).
// Uses `blockIndex` to skip the cross-root scan — the block index already
// knows which root holds the target.
//
// Returns the new `DocumentIndex` directly so callers don't have to choose
// between the warm path (`spliceDocumentIndex`) and the cold path
// (`createDocumentIndex`). Returns `null` when the target block doesn't
// exist or the replacer rejects it.
export function replaceEditorBlock(
  documentIndex: DocumentIndex,
  targetBlockId: string,
  replacer: (block: Block) => Block | null,
): DocumentIndex | null {
  const blockEntry = documentIndex.blockIndex.get(targetBlockId);

  if (!blockEntry) {
    return null;
  }

  const rootBlock = documentIndex.document.blocks[blockEntry.rootIndex];

  if (!rootBlock) {
    return null;
  }

  let found = false;
  const nextRoots = mapBlockTree([rootBlock], (block, { recurse }) => {
    if (block.id === targetBlockId) {
      found = true;
      return replacer(block);
    }
    return recurse();
  });

  if (!found) {
    return null;
  }

  const nextDocument = spliceDocument(documentIndex.document, blockEntry.rootIndex, 1, nextRoots);
  return spliceDocumentIndex(documentIndex, nextDocument, blockEntry.rootIndex, 1);
}

// An empty `Document` has no blocks, but the editor must always have at
// least one block to host a caret. The runtime synthesizes a single empty
// paragraph for that case; `collapseRuntimeEditableDocument` reverses it on
// save so persistence still sees zero blocks. The fiction lives here, at
// the public API boundary, so the rest of the index treats every document
// as non-empty.
//
// Implication for callers: `documentIndex.document` is not always reference-
// equal to the `document` passed into `createDocumentIndex`. Always go
// through `commitDocument` to obtain a savable Document — never read
// `documentIndex.document` directly at persistence boundaries.
function createRuntimeEditableDocument(document: Document): Document {
  if (document.blocks.length > 0) {
    return document;
  }

  return createDocument([createParagraphTextBlock("")], document.comments, document.frontMatter);
}

function collapseRuntimeEditableDocument(document: Document): Document {
  const firstBlock = document.blocks[0];

  if (
    document.blocks.length !== 1 ||
    !firstBlock ||
    firstBlock.type !== "paragraph" ||
    firstBlock.children.length > 0
  ) {
    return document;
  }

  return createDocument([], document.comments, document.frontMatter);
}
