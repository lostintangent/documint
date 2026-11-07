// `applyRootDelta`: the universal projection primitive. Every shape of update
// (cold build, text edit, root splice, append, structural replace)
// routes through this one function. Cold build is the degenerate case where
// `prev` is `null`: clones are empty maps, and every positioned root
// contributes its indexed records to the inserts.
//
// The map-clone path (`new Map(prev)`) is dramatically faster in V8/JSC than
// rebuilding via sequential `.set()` calls — empirically ~14× on a 3600-root
// document. That's what makes the splice hot path fast: the typing edit only
// pays for the per-root delta, not for re-iterating the whole document.
//
// Per-document projections (`listItems`, `imageUrls`, `resourceUrls`) live
// next to the primitive so their cache-reuse policies stay in one place.

import type { Document } from "@/document";
import type {
  IndexedBlock,
  DocumentIndex,
  IndexedTableCell,
  IndexedListItem,
  IndexedRoot,
} from "./types";

const EMPTY_URLS: ReadonlySet<string> = new Set();

export function applyRootDelta(
  prev: DocumentIndex | null,
  positionedRoots: IndexedRoot[],
  nextDocument: Document,
): DocumentIndex {
  // Fast path: roots are reference-identical (document-only change such as
  // comments or metadata via `replaceIndexedDocument`). Every map and flat
  // array is byte-for-byte identical to `prev`.
  if (prev && positionedRoots === prev.roots) {
    return nextDocument === prev.document ? prev : { ...prev, document: nextDocument };
  }

  const blockIndex = new Map(prev?.blockIndex);
  const tableCellIndex = new Map(prev?.tableCellIndex);

  const prevRoots = prev?.roots;
  const sharedLength = prevRoots ? Math.min(prevRoots.length, positionedRoots.length) : 0;

  // For each shared position, compare references:
  //   - same reference → reused, no work
  //   - different reference → remove previous records, then add next records.
  //     Same rootIndex does not imply stable block or cell paths; root replacement
  //     and root insertion can both put different content at the same slot.
  if (prevRoots) {
    for (let i = 0; i < sharedLength; i += 1) {
      const prevRoot = prevRoots[i]!;
      const positionedRoot = positionedRoots[i]!;
      if (positionedRoot === prevRoot) continue;
      removeRootRecords(prevRoot, blockIndex, tableCellIndex);
      addRootRecords(positionedRoot, blockIndex, tableCellIndex);
    }
    // Trailing prev roots (deletions at tail) — remove their records.
    for (let i = sharedLength; i < prevRoots.length; i += 1) {
      removeRootRecords(prevRoots[i]!, blockIndex, tableCellIndex);
    }
  }
  // Trailing positioned roots, including every root on cold build.
  for (let i = sharedLength; i < positionedRoots.length; i += 1) {
    addRootRecords(positionedRoots[i]!, blockIndex, tableCellIndex);
  }

  const blocks = positionedRoots.flatMap((root) => root.blocks);

  return {
    blockIndex,
    blocks,
    document: nextDocument,
    imageUrls: createDocumentUrlSet(positionedRoots, prev?.imageUrls, (root) => root.imageUrls),
    resourceUrls: createDocumentUrlSet(
      positionedRoots,
      prev?.resourceUrls,
      (root) => root.resourceUrls,
    ),
    listItems: createDocumentListItems(positionedRoots, prev?.listItems),
    roots: positionedRoots,
    tableCellIndex,
    pathsWithTextCount: positionedRoots.reduce((count, root) => count + root.pathsWithTextCount, 0),
  };
}

function removeRootRecords(
  root: IndexedRoot,
  blockIndex: Map<string, IndexedBlock>,
  tableCellIndex: Map<string, IndexedTableCell>,
) {
  for (const indexedBlock of root.blocks) {
    blockIndex.delete(indexedBlock.path);
    if (indexedBlock.kind === "cells") {
      for (const row of indexedBlock.tableCellRows) {
        for (const cell of row) {
          tableCellIndex.delete(cell.path);
        }
      }
    }
  }
}

function addRootRecords(
  root: IndexedRoot,
  blockIndex: Map<string, IndexedBlock>,
  tableCellIndex: Map<string, IndexedTableCell>,
) {
  for (const indexedBlock of root.blocks) {
    blockIndex.set(indexedBlock.path, indexedBlock);
    if (indexedBlock.kind === "cells") {
      for (const row of indexedBlock.tableCellRows) {
        for (const cell of row) {
          tableCellIndex.set(cell.path, cell);
        }
      }
    }
  }
}

// URL projections -----------------------------------------------------------

// Builds a document-level union of URLs from per-root sets, reusing the
// previous index's reference when the URL set is unchanged.
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

// List-item projection ------------------------------------------------------

// Builds the document-level contextual list-item map from per-root maps,
// reusing the previous map when the projected values are unchanged.
function createDocumentListItems(
  roots: IndexedRoot[],
  previous: ReadonlyMap<string, IndexedListItem> | undefined,
): ReadonlyMap<string, IndexedListItem> {
  const next = new Map<string, IndexedListItem>();
  for (const root of roots) {
    for (const [path, item] of root.listItems) next.set(path, item);
  }
  return previous && areListItemMapsEqual(previous, next) ? previous : next;
}

function areListItemMapsEqual(
  a: ReadonlyMap<string, IndexedListItem>,
  b: ReadonlyMap<string, IndexedListItem>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [path, item] of a) {
    const next = b.get(path);
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
