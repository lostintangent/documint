// `applyRootDelta`: the universal projection primitive. Every shape of update
// (cold build, single-region edit, root splice, append, structural replace)
// routes through this one function. Cold build is the degenerate case where
// `prev` is `null`: clones are empty maps, and every positioned root
// contributes its entries to the inserts.
//
// The map-clone path (`new Map(prev)`) is dramatically faster in V8/JSC than
// rebuilding via sequential `.set()` calls — empirically ~14× on a 3600-root
// document. That's what makes the splice hot path fast: the typing edit only
// pays for the per-root delta, not for re-iterating the whole document.
//
// Per-document projections (`commentContainerIndex`, `listItemMarkers`,
// `imageUrls`) live next to the primitive so the cache-reuse policies
// (`document.comments === prev.document.comments`, etc.) stay in one place.

import { resolveCommentThread, type Block, type Document } from "@/document";
import type {
  BlockEntry,
  DocumentIndex,
  ListItemMarker,
  RegionEntry,
  RootEntry,
} from "./types";

export function applyRootDelta(
  prev: DocumentIndex | null,
  positionedRoots: RootEntry[],
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

  // For each shared position, compare references and rootIndex:
  //   - same reference → reused, no work
  //   - different reference, same rootIndex → IDs unchanged (path-based); just
  //     set new entries (overwrites old values for the same keys)
  //   - different rootIndex → IDs shifted; must delete old entries first
  if (prevRoots) {
    for (let i = 0; i < sharedLength; i += 1) {
      const prevRoot = prevRoots[i]!;
      const positionedRoot = positionedRoots[i]!;
      if (positionedRoot === prevRoot) continue;
      if (positionedRoot.rootIndex !== prevRoot.rootIndex) {
        removeRootEntries(prevRoot, blockIndex, regionIndex, regionPathIndex);
      }
      addRootEntries(positionedRoot, blockIndex, regionIndex, regionPathIndex);
    }
    // Trailing prev roots (deletions at tail) — remove their entries.
    for (let i = sharedLength; i < prevRoots.length; i += 1) {
      removeRootEntries(prevRoots[i]!, blockIndex, regionIndex, regionPathIndex);
    }
  } else {
    // Cold build (no prev): every positioned root contributes entries.
    for (let i = 0; i < sharedLength; i += 1) {
      addRootEntries(positionedRoots[i]!, blockIndex, regionIndex, regionPathIndex);
    }
  }
  // Trailing positioned roots (additions at tail) — add their entries.
  for (let i = sharedLength; i < positionedRoots.length; i += 1) {
    addRootEntries(positionedRoots[i]!, blockIndex, regionIndex, regionPathIndex);
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
    listItemMarkers:
      prev && nextDocument.blocks === prev.document.blocks
        ? prev.listItemMarkers
        : createListItemMarkers(nextDocument.blocks),
    regionIndex,
    regionPathIndex,
    regions,
    roots: positionedRoots,
  };
}

function removeRootEntries(
  root: RootEntry,
  blockIndex: Map<string, BlockEntry>,
  regionIndex: Map<string, RegionEntry>,
  regionPathIndex: Map<string, RegionEntry>,
) {
  for (const entry of root.blocks) {
    blockIndex.delete(entry.block.id);
  }
  for (const region of root.regions) {
    regionIndex.delete(region.id);
    regionPathIndex.delete(region.path);
  }
}

function addRootEntries(
  root: RootEntry,
  blockIndex: Map<string, BlockEntry>,
  regionIndex: Map<string, RegionEntry>,
  regionPathIndex: Map<string, RegionEntry>,
) {
  for (const entry of root.blocks) {
    blockIndex.set(entry.block.id, entry);
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
    listItemMarkers:
      nextDocument.blocks === prev.document.blocks
        ? prev.listItemMarkers
        : createListItemMarkers(nextDocument.blocks),
  };
}

// Builds the document-level union of image URLs from per-root sets,
// reusing the previous index's reference when the URL set is unchanged so
// downstream consumers (notably the image loader hook's effect dep) can
// short-circuit on identity.
function createDocumentImageUrls(
  roots: RootEntry[],
  previous: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  const next = new Set<string>();
  for (const root of roots) {
    for (const url of root.imageUrls) next.add(url);
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

function createListItemMarkers(blocks: Block[]) {
  const markers = new Map<string, ListItemMarker>();
  appendListItemMarkers(markers, blocks);

  return markers;
}

function appendListItemMarkers(
  markers: Map<string, ListItemMarker>,
  blocks: Block[],
  orderedContext: { index: number; ordered: boolean; start: number | null } | null = null,
) {
  for (const block of blocks) {
    if (block.type === "list") {
      for (const [index, child] of block.items.entries()) {
        appendListItemMarkers(markers, [child], {
          index,
          ordered: block.ordered,
          start: block.start,
        });
      }

      continue;
    }

    if (block.type === "listItem") {
      if (typeof block.checked === "boolean") {
        markers.set(block.id, {
          checked: block.checked,
          kind: "task",
        });
      } else if (orderedContext?.ordered) {
        markers.set(block.id, {
          kind: "ordered",
          label: `${(orderedContext.start ?? 1) + orderedContext.index}.`,
        });
      } else {
        markers.set(block.id, {
          kind: "bullet",
          label: "•",
        });
      }

      appendListItemMarkers(markers, block.children, orderedContext);
    }

    if (block.type === "blockquote") {
      appendListItemMarkers(markers, block.children, orderedContext);
    }
  }
}
