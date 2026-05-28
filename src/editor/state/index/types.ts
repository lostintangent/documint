// Editor model type definitions: the runtime representation of a document
// as flattened roots, indexed blocks, regions, indexed inlines, and lookup indexes.
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

// A document inline projected into the editor index. References the source
// document Inline node directly; the discriminator is `node.type`. Link
// wrappers are flattened (their children appear as siblings) and propagated
// via the orthogonal `link` field. The index adds only what the document
// doesn't carry: `start`/`end` char offsets in the region's coordinate space.
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

// A list item projected into the editor index. The document owns the source
// facts (`ListBlock.ordered/start`, `ListItemBlock.checked`, and nesting
// shape); the index flattens those contextual facts onto the item so layout,
// navigation, and paint can read them in O(1).
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
  // Position of this region in `DocumentIndex.regions` (document-order rank).
  // Stamped by the indexer; re-stamped during positioning whenever the
  // region's root gets a new `regionRange.start`. Used by selection
  // ordering, document-order comparisons, and flow walks for O(1) access
  // without a map lookup.
  documentOrder: number;
  end: number;
  id: string;
  path: string;
  rootIndex: number;
  semanticRegionId: string;
  start: number;
  tableCellPosition: { cellIndex: number; rowIndex: number } | null;
  text: string;
};

export type EditableRegionContent =
  | { kind: "inlines"; inlines: readonly IndexedInline[] }
  | { kind: "source" };

// A block projected into the editor index. Carries a direct reference to the
// source document `Block` (so `block.type`, `block.id`, and the block's
// children are reached through one pointer hop, not duplicated) plus the
// index-only metadata: char-offset coordinates, document-order position,
// depth, parent, taxonomy kind, and the regions this block contributes.
export type IndexedBlock = {
  block: Block;
  // Position of this block in `DocumentIndex.blocks`. Set by the indexer,
  // re-stamped on every root reposition. Used by navigation's block-flow
  // walks to look up adjacency in O(1) instead of a linear `findIndex`.
  blockArrayIndex: number;
  depth: number;
  end: number;
  // Closed taxonomy classification — see `BlockKind`. Stamped by the visitor
  // from `BLOCK_CONTRIBUTIONS` so every consumer that needs "is this a
  // container?" / "is this inert?" reads one field instead of re-deriving
  // from `block.type` literals.
  kind: BlockKind;
  parentBlockId: string | null;
  path: string;
  regionIds: string[];
  rootIndex: number;
  start: number;
};

// A top-level document block projected into the editor index. Groups every
// indexed block and editable region reachable from that root, enabling
// incremental model rebuilds that only reprocess the affected root.
export type IndexedRoot = {
  blockRange: { end: number; start: number };
  blocks: IndexedBlock[];
  end: number;
  // URLs of image inlines reachable from this root. Collected during the
  // existing inline walk so the per-document image-resource hook can read
  // the set without re-walking the tree on every keystroke. Reused by
  // reference identity when the root itself is reused (`canReuseIndexedRoot`).
  imageUrls: ReadonlySet<string>;
  // URLs of resource inlines reachable from this root. Collected during the
  // existing inline walk so the component can notify the host about discovered
  // resources and reconcile host-provided active resource state.
  resourceUrls: ReadonlySet<string>;
  // Contextual list-item projections inside this root. Collected while the
  // root is already being walked so unrelated root edits don't force a
  // full-document list-item rebuild.
  listItems: ReadonlyMap<string, IndexedListItem>;
  regionRange: { end: number; start: number } | undefined;
  regions: EditableRegion[];
  rootIndex: number;
  start: number;
};

// A flat, indexed projection of a `Document` for the editing engine: pre-flattened
// blocks/editable regions, character-offset coordinates, and lookup tables for O(1) hot-path
// access. Holds a reference back to the source `document`; carries no semantic
// content of its own — every field is either a coordinate, a topology aid, an
// index, or a runtime presentation projection.
export type DocumentIndex = {
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
  listItems: ReadonlyMap<string, IndexedListItem>;
  regionIndex: Map<string, EditableRegion>;
  regionPathIndex: Map<string, EditableRegion>;
  regions: EditableRegion[];
  roots: IndexedRoot[];
};
