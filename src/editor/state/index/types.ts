// Editor model type definitions: the runtime representation of a document
// as flattened roots, blocks, regions, editor inlines, and lookup indexes.
import type { Block, Document, Inline, Link } from "@/document";

// Closed taxonomy of how a block contributes to editor coordinate space.
// Stamped on `BlockEntry.kind` so callers can dispatch in O(1) without
// re-classifying from `block.type`. The variant payloads live in roots.ts's
// `BLOCK_CONTRIBUTIONS` table; this type is only the discriminator.
//
//   - `container`     - structural wrapper; recurse into children, no own region
//   - `inline-text`   - text-bearing leaf; one region with flattened inlines
//   - `source-text`   - opaque-source leaf; one region with raw text
//   - `cells`         - table; one inline-bearing region per cell
//   - `inert`         - leaf with no editable region (divider, directive)
export type BlockKind = "container" | "inline-text" | "source-text" | "cells" | "inert";

// A flattened inline entry. References the source document Inline node
// directly; the discriminator is `node.type`. Link wrappers are flattened
// (their children appear as siblings) and propagated via the orthogonal
// `link` field. The index adds only what the document doesn't carry:
// `start`/`end` char offsets in the region's coordinate space, and the
// projected `text` (which differs from `node`'s own text for references
// — image/mention/resource project to `￼`, lineBreak projects to `\n`).
//
// Inline entries only exist for inline-bearing regions (`content.kind ===
// "inline-text"`). Source-bearing regions (code, raw blocks) hold raw text
// in `region.text` and carry no flattened inlines.
export type InlineEntry = {
  end: number;
  link: Link | null;
  node: Exclude<Inline, Link>;
  start: number;
  text: string;
};

// Effective list-item marker semantics derived from document tree context.
// The document owns the source facts (`ListBlock.ordered/start`,
// `ListItemBlock.checked`, and nesting shape); the index caches the per-item
// projection layout/paint needs in O(1). Rendered glyphs such as bullets or
// ordered-label strings belong to the renderer, not this type.
export type ListItemMarker =
  | { checked: boolean; depth: number; kind: "task" }
  | { depth: number; kind: "unordered" }
  | { depth: number; kind: "ordered"; ordinal: number };

export type RegionEntry = {
  // Direct reference to the document Block this region belongs to. For table
  // regions, this is the `table` block (the cell is identified separately by
  // `tableCellPosition`). For text/code/raw blocks it's the block itself.
  block: Block;
  // What this region carries. Inline-bearing regions (paragraph, heading,
  // table cell) flatten their Inline trees into `content.inlines`. Source-
  // bearing regions (code, raw) just point at the block; their text comes
  // from `region.text` or directly from `block.source` — no synthetic inline
  // wrapper. Editing primitives dispatch on `content.kind`. The discriminators
  // match the corresponding `BlockKind` values so contribution → content
  // mapping is identity-preserving.
  content: RegionContent;
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

export type RegionContent =
  | { kind: "inline-text"; inlines: readonly InlineEntry[] }
  | { kind: "source-text" };

// A block entry in `DocumentIndex.blockIndex`. Carries a direct reference to
// the source document `Block` (so `entry.block.type`, `entry.block.id`, and
// the block's children are reached through one pointer hop, not duplicated)
// plus the index-only metadata: char-offset coordinates, document-order
// position, depth, parent, taxonomy kind, and the regions this block
// contributes.
export type BlockEntry = {
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

// Internal optimization scaffolding. Groups all blocks and regions from a
// single top-level document block, enabling incremental model rebuilds that
// only reprocess the affected root.
export type RootEntry = {
  blockRange: { end: number; start: number };
  blocks: BlockEntry[];
  end: number;
  // URLs of image inlines reachable from this root. Collected during the
  // existing inline walk so the per-document image-resource hook can read
  // the set without re-walking the tree on every keystroke. Reused by
  // reference identity when the root itself is reused (`canReuseRootEntry`).
  imageUrls: ReadonlySet<string>;
  // URLs of resource inlines reachable from this root. Collected during the
  // existing inline walk so the component can notify the host about discovered
  // resources and reconcile host-provided active resource state.
  resourceUrls: ReadonlySet<string>;
  // List/task/ordered marker semantics for list items inside this root.
  // Collected while the root is already being walked so unrelated root edits
  // don't force a full-document marker rebuild.
  listItemMarkers: ReadonlyMap<string, ListItemMarker>;
  regionRange: { end: number; start: number } | undefined;
  regions: RegionEntry[];
  rootIndex: number;
  start: number;
};

// A flat, indexed projection of a `Document` for the editing engine: pre-flattened
// blocks/regions, character-offset coordinates, and lookup tables for O(1) hot-path
// access. Holds a reference back to the source `document`; carries no semantic
// content of its own — every field is either a coordinate, a topology aid, an
// index, or a runtime presentation projection.
export type DocumentIndex = {
  blockIndex: Map<string, BlockEntry>;
  blocks: BlockEntry[];
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
  listItemMarkers: ReadonlyMap<string, ListItemMarker>;
  regionIndex: Map<string, RegionEntry>;
  regionPathIndex: Map<string, RegionEntry>;
  regions: RegionEntry[];
  roots: RootEntry[];
};
