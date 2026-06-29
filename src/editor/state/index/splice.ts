// Public splice API: the entry points the rest of the editor uses to build,
// update, and commit a `DocumentIndex`. Each mutation constructs positioned
// root slices and routes through `applyRootDelta`. The runtime empty-document
// shim lives here because it belongs at the document/index boundary.

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
import { createIndexedRoot, positionIndexedRoots } from "./roots";
import type { DocumentIndex } from "./types";

export function createDocumentIndex(document: Document): DocumentIndex {
  const runtimeDocument = createRuntimeEditableDocument(document);
  const positionedRoots = positionIndexedRoots(
    runtimeDocument.blocks.map((block, rootIndex) => createIndexedRoot(block, rootIndex)),
  );

  return applyRootDelta(null, positionedRoots, runtimeDocument);
}

// Materializes the savable `Document`: removes the empty-document shim and
// commits any anchor repair produced by the most recent index state.
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
      .map((block, index) => createIndexedRoot(block, rootIndex + index)),
    ...(canPreserveSuffixRoots
      ? model.roots.slice(rootIndex + count)
      : nextDocument.blocks
          .slice(rootIndex + replacementCount)
          .map((block, index) => createIndexedRoot(block, rootIndex + replacementCount + index))),
  ];
  const positionedRoots = positionIndexedRoots(unpositionedRoots, model.roots);

  return applyRootDelta(model, positionedRoots, nextDocument);
}

// Replace the index's document where only comments or front matter changed;
// every root keeps reference identity. Throws if blocks differ — that's a
// splice, not a metadata replace.
export function replaceDocumentMetadata(model: DocumentIndex, document: Document): DocumentIndex {
  if (document.blocks !== model.document.blocks) {
    throw new Error("Editor model metadata replacement requires preserving root blocks.");
  }

  return applyRootDelta(model, model.roots, document);
}

// Replace a single block by path. The block index locates the containing root;
// `mapBlockTree` rebuilds only the changed spine inside that root; the result
// commits through the same document/index splice path as structural edits.
//
// Returns the new `DocumentIndex` directly so callers don't have to choose
// between the warm path (`spliceDocumentIndex`) and the cold path
// (`createDocumentIndex`). Returns `null` when the target block doesn't
// exist or the replacer rejects it.
export function replaceEditorBlock(
  documentIndex: DocumentIndex,
  targetBlockPath: string,
  replacer: (block: Block) => Block | null,
): DocumentIndex | null {
  const indexedBlock = documentIndex.blockIndex.get(targetBlockPath);

  if (!indexedBlock) {
    return null;
  }

  const rootBlock = documentIndex.document.blocks[indexedBlock.rootIndex];

  if (!rootBlock) {
    return null;
  }

  let found = false;
  let rejected = false;
  const nextRoots = mapBlockTree([rootBlock], (block, { recurse }) => {
    if (block === indexedBlock.block) {
      found = true;
      const nextBlock = replacer(block);

      if (!nextBlock) {
        rejected = true;
        return block;
      }

      return nextBlock;
    }
    return recurse();
  });

  if (!found || rejected) {
    return null;
  }

  const nextDocument = spliceDocument(documentIndex.document, indexedBlock.rootIndex, 1, nextRoots);
  return spliceDocumentIndex(documentIndex, nextDocument, indexedBlock.rootIndex, 1);
}

// An empty `Document` has no blocks, but the editor always has a caret host.
// The runtime synthesizes one empty paragraph at index construction time, and
// `commitDocument` collapses it again before persistence. `documentIndex.document`
// is therefore the runtime document, not necessarily the savable document.
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
