// `applyRootDelta`: the universal projection primitive. Every shape of update
// (cold build, single-region edit, root splice, append, structural replace)
// routes through this one function. Cold build is the degenerate case where
// `prev` is `null`: clones are empty maps, and every positioned root
// contributes its indexed records to the inserts.
//
// The map-clone path (`new Map(prev)`) is dramatically faster in V8/JSC than
// rebuilding via sequential `.set()` calls — empirically ~14× on a 3600-root
// document. That's what makes the splice hot path fast: the typing edit only
// pays for the per-root delta, not for re-iterating the whole document.
//
// Per-document projections (`commentContainerIndex`, `listItems`,
// `imageUrls`, `resourceUrls`) live next to the primitive so the cache-reuse policies
// (`document.comments === prev.document.comments`, etc.) stay in one place.

import { resolveCommentThread, type Document } from "@/document";
import type {
  IndexedBlock,
  DocumentIndex,
  IndexedListItem,
  EditableRegion,
  IndexedRoot,
} from "./types";

const EMPTY_URLS: ReadonlySet<string> = new Set();

export function applyRootDelta(
  prev: DocumentIndex | null,
  positionedRoots: IndexedRoot[],
  nextDocument: Document,
): DocumentIndex {
  // Fast path: roots are reference-identical (metadata-only change such as
  // `replaceDocumentMetadata`). Every map and flat array is byte-for-byte
  // identical to `prev`; only document-derived projections may need to
  // refresh.
  if (prev && positionedRoots === prev.roots) {
    return refreshDocumentProjections(prev, nextDocument);
  }

  const blockIndex = new Map(prev?.blockIndex);
  const regionIndex = new Map(prev?.regionIndex);
  const regionPathIndex = new Map(prev?.regionPathIndex);

  const prevRoots = prev?.roots;
  const sharedLength = prevRoots ? Math.min(prevRoots.length, positionedRoots.length) : 0;

  // For each shared position, compare references:
  //   - same reference → reused, no work
  //   - different reference → remove previous records, then add next records.
  //     Same rootIndex does not imply stable block/region ids; root replacement
  //     and root insertion can both put different block ids at the same slot.
  if (prevRoots) {
    for (let i = 0; i < sharedLength; i += 1) {
      const prevRoot = prevRoots[i]!;
      const positionedRoot = positionedRoots[i]!;
      if (positionedRoot === prevRoot) continue;
      removeRootRecords(prevRoot, blockIndex, regionIndex, regionPathIndex);
      addRootRecords(positionedRoot, blockIndex, regionIndex, regionPathIndex);
    }
    // Trailing prev roots (deletions at tail) — remove their records.
    for (let i = sharedLength; i < prevRoots.length; i += 1) {
      removeRootRecords(prevRoots[i]!, blockIndex, regionIndex, regionPathIndex);
    }
  } else {
    // Cold build (no prev): every positioned root contributes records.
    for (let i = 0; i < sharedLength; i += 1) {
      addRootRecords(positionedRoots[i]!, blockIndex, regionIndex, regionPathIndex);
    }
  }
  // Trailing positioned roots (additions at tail) — add their records.
  for (let i = sharedLength; i < positionedRoots.length; i += 1) {
    addRootRecords(positionedRoots[i]!, blockIndex, regionIndex, regionPathIndex);
  }

  const blocks = positionedRoots.flatMap((root) => root.blocks);
  const regions = positionedRoots.flatMap((root) => root.regions);

  return {
    blockIndex,
    blocks,
    commentContainerIndex:
      prev && nextDocument.comments === prev.document.comments
        ? prev.commentContainerIndex
        : createCommentContainerIndex(nextDocument),
    document: nextDocument,
    imageUrls: createDocumentImageUrls(positionedRoots, prev?.imageUrls),
    resourceUrls: createDocumentResourceUrls(positionedRoots, prev?.resourceUrls),
    listItems: createDocumentListItems(positionedRoots, prev?.listItems),
    regionIndex,
    regionPathIndex,
    regions,
    roots: positionedRoots,
  };
}

function removeRootRecords(
  root: IndexedRoot,
  blockIndex: Map<string, IndexedBlock>,
  regionIndex: Map<string, EditableRegion>,
  regionPathIndex: Map<string, EditableRegion>,
) {
  for (const indexedBlock of root.blocks) {
    blockIndex.delete(indexedBlock.block.id);
  }
  for (const region of root.regions) {
    regionIndex.delete(region.id);
    regionPathIndex.delete(region.path);
  }
}

function addRootRecords(
  root: IndexedRoot,
  blockIndex: Map<string, IndexedBlock>,
  regionIndex: Map<string, EditableRegion>,
  regionPathIndex: Map<string, EditableRegion>,
) {
  for (const indexedBlock of root.blocks) {
    blockIndex.set(indexedBlock.block.id, indexedBlock);
  }
  for (const region of root.regions) {
    regionIndex.set(region.id, region);
    regionPathIndex.set(region.path, region);
  }
}

// Roots unchanged but the document reference may have been swapped (comments,
// front matter). Reuse everything except the document-derived projections,
// which still gate on their own input identity.
function refreshDocumentProjections(prev: DocumentIndex, nextDocument: Document): DocumentIndex {
  if (nextDocument === prev.document) {
    return prev;
  }
  return {
    ...prev,
    commentContainerIndex:
      nextDocument.comments === prev.document.comments
        ? prev.commentContainerIndex
        : createCommentContainerIndex(nextDocument),
    document: nextDocument,
    listItems: prev.listItems,
  };
}

// Builds the document-level union of image URLs from per-root sets,
// reusing the previous index's reference when the URL set is unchanged so
// downstream consumers (notably the image loader hook's effect dep) can
// short-circuit on identity.
function createDocumentImageUrls(
  roots: IndexedRoot[],
  previous: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  return createDocumentUrlSet(roots, previous, (root) => root.imageUrls);
}

function createDocumentResourceUrls(
  roots: IndexedRoot[],
  previous: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  return createDocumentUrlSet(roots, previous, (root) => root.resourceUrls);
}

function createDocumentUrlSet(
  roots: IndexedRoot[],
  previous: ReadonlySet<string> | undefined,
  readRootUrls: (root: IndexedRoot) => ReadonlySet<string>,
): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const root of roots) {
    for (const url of readRootUrls(root)) {
      next ??= new Set();
      next.add(url);
    }
  }

  if (!next) {
    return previous && previous.size === 0 ? previous : EMPTY_URLS;
  }

  return previous && areUrlSetsEqual(previous, next) ? previous : next;
}

function areUrlSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

// Builds the document-level contextual list-item map from per-root maps,
// reusing the previous map when the projected values are unchanged.
function createDocumentListItems(
  roots: IndexedRoot[],
  previous: ReadonlyMap<string, IndexedListItem> | undefined,
): ReadonlyMap<string, IndexedListItem> {
  const next = new Map<string, IndexedListItem>();
  for (const root of roots) {
    for (const [id, item] of root.listItems) next.set(id, item);
  }
  return previous && areListItemMapsEqual(previous, next) ? previous : next;
}

function areListItemMapsEqual(
  a: ReadonlyMap<string, IndexedListItem>,
  b: ReadonlyMap<string, IndexedListItem>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, item] of a) {
    const next = b.get(id);
    if (!next || !areListItemsEqual(item, next)) return false;
  }
  return true;
}

function areListItemsEqual(a: IndexedListItem, b: IndexedListItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.depth !== b.depth) return false;
  switch (a.kind) {
    case "task":
      return b.kind === "task" && a.checked === b.checked;
    case "unordered":
      return b.kind === "unordered";
    case "ordered":
      return b.kind === "ordered" && a.ordinal === b.ordinal;
  }
}

// Note: this is O(C × N) on cold build — each thread resolves against the
// full document via `resolveCommentThread`. Reuse via `document.comments`
// identity hides this on edits, but documents loaded with many existing
// threads pay it once.
function createCommentContainerIndex(document: Document) {
  const commentContainerIndex = new Map<string, number[]>();

  for (const [threadIndex, thread] of document.comments.entries()) {
    const containerId = resolveCommentThread(thread, document).match?.containerId ?? null;

    if (!containerId) {
      continue;
    }

    const threadIndices = commentContainerIndex.get(containerId) ?? [];
    threadIndices.push(threadIndex);
    commentContainerIndex.set(containerId, threadIndices);
  }

  return commentContainerIndex;
}
