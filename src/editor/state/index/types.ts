// Runtime address-space types for a `Document`: root slices, flat block and
// region streams, inline range maps, and path-keyed lookups.
import type { Block, Document, Inline, Link } from "@/document";

// Closed taxonomy of how a block contributes to editor coordinate space.
// Stamped on `IndexedBlock.kind` so callers can dispatch in O(1) without
// re-classifying from `block.type`. The variant payloads live in roots.ts's
// `BLOCK_CONTRIBUTIONS` table; this type is only the discriminator.
//
//   - `container`     - structural wrapper; recurse into children, no own region
//   - `inline-text`   - text-bearing leaf; one region with indexed inlines
//   - `source-text`   - opaque-source leaf; one region with raw text
//   - `cells`         - table; one inline-bearing region per cell
//   - `inert`         - leaf with no editable region (divider, directive)
export type BlockKind = "container" | "inline-text" | "source-text" | "cells" | "inert";

// A document inline projected into a region's editor coordinate space. The
// source document inline stays referenced through `node`. Link wrappers are
// flattened and preserved through the orthogonal `link` field. The index adds
// only range coordinates.
//
// Indexed inlines only exist for inline-bearing editable regions
// (`content.kind === "inlines"`). Source-bearing editable regions (code,
// raw blocks) hold raw text in `region.text` and carry no indexed inlines.
export type IndexedInline = {
  end: number;
  link: Link | null;
  node: Exclude<Inline, Link>;
  start: number;
};

// Runtime list-item context. The document owns ordered/task semantics and tree
// shape; the index flattens the contextual facts layout, navigation, and paint
// need in O(1).
export type IndexedListItem =
  | { checked: boolean; depth: number; kind: "task" }
  | { depth: number; kind: "unordered" }
  | { depth: number; kind: "ordered"; ordinal: number };

export type EditableRegion = {
  // Direct reference to the document Block this editable region belongs to.
  // For table cell regions, this is the `table` block (the cell is identified
  // separately by `tableCellPosition`). For paragraph/heading/code/raw blocks
  // it's the block itself.
  block: Block;
  // What this editable region carries. Inline regions (paragraph, heading,
  // table cell) flatten their Inline trees into `content.inlines`; those
  // inlines may be text, soft breaks, images, mentions, resources, or raw
  // inline nodes. Source regions (code, raw) just point at the block; their
  // text comes from `region.text` or directly from `block.source` — no
  // synthetic inline wrapper. Editing primitives dispatch on `content.kind`.
  content: EditableRegionContent;
  // Path to the structural container this region addresses (the parent of
  // `path`). For inline-bearing blocks this is the block's path; for table
  // cells it's the cell's path; for source regions it's the block's path.
  // Consumers building inline-container projections use this instead of
  // re-parsing `path` with regex.
  containerPath: string;
  // Structural path of the owning block. For table cell regions, this is the
  // table block path, while `containerPath` and `path` identify the cell.
  blockPath: string;
  // Position of this region in `DocumentIndex.regions`. Stamped by the
  // indexer and re-stamped during positioning whenever the region's root
  // moves in region-array space. Used by selection ordering, document-order
  // comparisons, and flow walks for O(1) access without a map lookup.
  regionArrayIndex: number;
  path: string;
  rootIndex: number;
  tableCellPosition: { cellIndex: number; rowIndex: number } | null;
  text: string;
};

export type EditableRegionContent =
  | { kind: "inlines"; inlines: readonly IndexedInline[] }
  | { kind: "source" };

// A block projected into the editor index. Carries a direct reference to the
// source document `Block` (so `block.type` and the block's children are
// reached through one pointer hop, not duplicated) plus the index-only
// metadata: block-array position, depth, path/parent topology, taxonomy kind,
// and nested ranges over the flat block/region arrays.
export type IndexedBlock = {
  block: Block;
  // Position of this block in `DocumentIndex.blocks`. Set by the indexer,
  // re-stamped on every root reposition. Used by navigation's block-flow
  // walks to look up adjacency in O(1) instead of a linear `findIndex`.
  blockArrayIndex: number;
  // Half-open end of this block's pre-order subtree in `DocumentIndex.blocks`.
  // `blockArrayIndex` is the matching range start.
  blockRangeEnd: number;
  depth: number;
  // Closed taxonomy classification — see `BlockKind`. Stamped by the visitor
  // from `BLOCK_CONTRIBUTIONS` so every consumer that needs "is this a
  // container?" / "is this inert?" reads one field instead of re-deriving
  // from `block.type` literals.
  kind: BlockKind;
  parentBlockPath: string | null;
  path: string;
  regionRangeEnd: number;
  regionRangeStart: number;
  rootIndex: number;
};

// Runtime slice for one top-level document block. Groups every indexed block
// and editable region reachable from that root so incremental rebuilds can
// replace one slice while preserving siblings.
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
  regions: EditableRegion[];
  rootIndex: number;
};

// Flat runtime projection of a `Document`: pre-flattened block and region
// streams, path lookups, and small presentation projections. The semantic
// payload remains in `document` and the referenced document nodes.
export type DocumentIndex = {
  // Path-keyed block lookup. The map key is `IndexedBlock.path`.
  blockIndex: Map<string, IndexedBlock>;
  blocks: IndexedBlock[];
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
  // Path-keyed region lookup. The map key is `EditableRegion.path`.
  regionIndex: Map<string, EditableRegion>;
  regions: EditableRegion[];
  roots: IndexedRoot[];
};
