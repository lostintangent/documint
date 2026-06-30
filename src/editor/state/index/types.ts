// Runtime address-space types for a `Document`: root slices, flat block
// projections, inline range maps, and path-keyed lookups.

import type { Block, BlockContentKind, Document, Inline, Link, TableCell } from "@/document";

// Flat runtime projection of a `Document`: pre-flattened blocks, path lookups,
// and small presentation projections. The semantic payload remains in
// `document` and the referenced document nodes.
export type DocumentIndex = {
  // Path-keyed block lookup. The map key is `IndexedBlock.path`.
  blockIndex: Map<string, IndexedBlock>;
  blocks: IndexedBlock[];

  // Narrow table-cell lookup keyed by semantic cell path. Values are the same
  // `IndexedTableCell` records stored under the owning table block.
  tableCellIndex: Map<string, IndexedTableCell>;

  roots: IndexedRoot[];

  commentContainerIndex: Map<string, number[]>;
  document: Document;

  // Union of image URLs across every root. Reference-stable when the URL
  // set is unchanged (value-compared against the previous index), so
  // consumers can use it directly as a React `useEffect` dep without
  // having to derive a content-based signature.
  imageUrls: ReadonlySet<string>;

  // Union of resource URLs across every root, with the same reference-stable
  // value-comparison policy as `imageUrls`.
  resourceUrls: ReadonlySet<string>;

  // Contextual list-item projections keyed by list item block path.
  listItems: ReadonlyMap<string, IndexedListItem>;

  pathsWithTextCount: number;
};

export type IndexedBlock =
  | (IndexedBlockBase & {
      kind: "blocks" | "void";
    })
  | (IndexedBlockBase & {
      editorOrder: number;
      inlines: readonly IndexedInline[];
      kind: "inlines";
      text: string;
    })
  | (IndexedBlockBase & {
      editorOrder: number;
      kind: "source";
      text: string;
    })
  | (IndexedBlockBase & {
      kind: "cells";
      tableCellRows: readonly (readonly IndexedTableCell[])[];
    });

export type IndexedText =
  | Extract<IndexedBlock, { kind: "inlines" | "source" }>
  | IndexedTableCell;

// A block projected into the editor index. Carries a direct reference to the
// source document `Block` (so `block.type` and the block's children are
// reached through one pointer hop, not duplicated) plus the index-only
// metadata: block-array position, depth, path/parent topology, taxonomy kind,
// and nested range over the flat block array.
type IndexedBlockBase = {
  block: Block;

  // Position of this block in `DocumentIndex.blocks`. Set by the indexer,
  // re-stamped on every root reposition. Used by navigation's block-flow
  // walks to look up adjacency in O(1) instead of a linear `findIndex`.
  blockArrayIndex: number;

  // Half-open end of this block's pre-order subtree in `DocumentIndex.blocks`.
  // `blockArrayIndex` is the matching range start.
  blockRangeEnd: number;
  depth: number;

  // The document's block content kind (`@/document`'s `blockContentKind`),
  // stamped by the visitor so consumers dispatch in O(1) without re-deriving
  // from `block.type`. Also the discriminant for this union's payload arms.
  kind: BlockContentKind;

  path: string;
  parentBlockPath: string | null;
  rootIndex: number;
};

// Runtime slice for one top-level document block. Groups every indexed block
// reachable from that root so incremental rebuilds can replace one slice while
// preserving siblings.
export type IndexedRoot = {
  blocks: IndexedBlock[];
  // URLs of image inlines reachable from this root. Collected during the
  // existing inline walk so the per-document image-resource hook can read
  // the set without re-walking the tree on every keystroke. Reused by
  // reference identity when the root itself is reused (`canReuseIndexedRoot`).
  imageUrls: ReadonlySet<string>;
  // URLs of resource inlines reachable from this root. Collected during the
  // existing inline walk so the component can notify the host about discovered
  // resources and reconcile host-provided active resource state.
  resourceUrls: ReadonlySet<string>;
  // Contextual list-item projections inside this root, keyed by the list
  // item block path. Collected while the root is already being walked so
  // unrelated root edits don't force a full-document list-item rebuild.
  listItems: ReadonlyMap<string, IndexedListItem>;
  rootIndex: number;
  pathsWithTextCount: number;
};

// A document inline projected into an editor text path's coordinate space. The
// source document inline stays referenced through `node`. Link wrappers are
// flattened and preserved through the orthogonal `link` field. The index adds
// only range coordinates.
//
// Indexed inlines only exist for inline-bearing block or table-cell paths.
// Source-bearing blocks (code, raw blocks) hold raw editor text directly and
// carry no indexed inlines.
export type IndexedInline = {
  end: number;
  link: Link | null;
  node: Exclude<Inline, Link>;
  start: number;
};

// Projection for a semantic table cell. Stored under the indexed table block
// and also keyed directly by cell path in `DocumentIndex.tableCellIndex`, so a
// cell path resolves to the same indexed record without row/column relookup.
export type IndexedTableCell = {
  cell: TableCell;
  cellIndex: number;
  editorOrder: number;
  inlines: readonly IndexedInline[];
  path: string;
  rootIndex: number;
  rowIndex: number;
  tablePath: string;
  text: string;
};

// Runtime list-item context. The document owns ordered/task semantics and tree
// shape; the index flattens the contextual facts layout, navigation, and paint
// need in O(1).
export type IndexedListItem =
  | { checked: boolean; depth: number; kind: "task" }
  | { depth: number; kind: "unordered" }
  | { depth: number; kind: "ordered"; ordinal: number };
