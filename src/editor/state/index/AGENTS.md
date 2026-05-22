# Document Index

The index layer is a *pure index over `Document`*. It adds editor coordinate space and O(1) lookups, and projects link wrappers and atomic inlines into a flat character-offset sequence — but it never duplicates document payload. Block payload is reached through entry references; inline payload is reached through flattened-inline node references. The document is the source of truth; the index says where things live in editor coordinate space and accelerates the queries editing needs.

The mental model: if a field can be read from a `Block` or `Inline` node, the entry does not copy it. If a field is a coordinate the document doesn't have (`start`, `end`, `documentOrder`, `depth`, `path`), the entry owns it. If a field is a taxonomy classification the rest of the editor needs in O(1) (`kind`), the entry owns it.

## Invariants

**Coordinate space.** Regions carry char offsets in *editor selection-offset space* — the editor's name for what the document calls inline text-coordinate space (see `src/document/query/visit.ts`). The two names refer to the same space; the editor adopts the document's coordinate convention directly. Regions in a root are joined by `\n` (one char each); atomic inline objects (image, mention) project to `￼` (one char); line breaks project to `\n` (one char). This is the coordinate system selection arithmetic, caret motion, and hit testing use, and it is distinct from the document/anchor offset space the document layer also defines for content-addressable positions.

**Identity discipline.** Roots, regions, blocks, and inlines reuse references whenever their underlying input is unchanged. Identity reuse is what lets layout caches and React effect deps prove what didn't change. Map containers themselves are new objects per edit (cheap clones), but their *entries* keep reference equality for unchanged roots. `imageUrls` is additionally value-compared because it's a React effect dep whose downstream consumers depend on identity for short-circuit equality.

Identity reuse is *per-root*. When a root's `start` or its `blockRange`/`regionRange` shifts (e.g., insert-at-front), the affected root is re-stamped — every `BlockEntry` and `RegionEntry` inside it gets a new clone with updated global indices. Downstream caches keyed by entry references should expect to refill on edits that shift root positions; caches keyed by block/region *id* survive that.

**Applies-as-a-delta.** Every projection update — cold build, single-region edit, root splice, append, structural replace — is one operation: `applyRootDelta(prev, positionedRoots, document)`. The cold path is the degenerate case where `prev` is `null`. There is no separate "build from scratch" code path; building from scratch is just applying an empty delta to an empty index. The metadata-only case (roots identical, document changed) takes the `refreshDocumentProjections` fast path and skips the map clones entirely. This is what makes the layer's hot path uniformly fast across input shapes.

**Runtime empty-document shim.** `Document` can be empty (`blocks.length === 0`), but the editor must always have at least one block to host a caret. `createDocumentIndex` synthesizes a single empty paragraph in that case; `commitDocument` reverses it on save so persistence still sees zero blocks. Implication: `documentIndex.document` is not always reference-equal to the `document` passed into `createDocumentIndex`. Always go through `commitDocument` at persistence boundaries — never read `documentIndex.document` directly when saving.

## Three identifiers, three jobs

Three string identifiers travel with each region; they serve three different consumer classes and have three different stability requirements. Conflating them silently breaks at least one.

- **`region.id`** — runtime address. Unique per editor session, used in selection points and as the key for `regionIndex`. Format: `${block.id}:${path}`. May change across rebuilds; consumers that need to survive rebuilds use `path` instead.
- **`region.path`** — structural address. Derived from the region's position in the document tree (e.g., `root.1.children`, `root.2.rows.0.cells.1`). Stable across edits at the same structural position; survives any rebuild that preserves shape. Used by `regionPathIndex`, reconciliation, and markdown-line-diff.
- **`region.semanticRegionId`** — anchor-container address. Identifies the *semantic* container an anchor projects into: the block id for paragraph/heading/code, or the cell id for table cells. Used by comments and anchors, which speak a content-addressable language distinct from runtime ids.

`region.containerPath` is a structural sibling to these three — the path of the *parent* container (block path or cell path). Inline-container resolution uses it directly so it doesn't have to regex-parse `path`.

## Block taxonomy

Every `BlockEntry` carries `kind: BlockKind`. The five values are:

- `container` — structural wrapper; recurse into children, no own region. blockquote, list, listItem.
- `inline-text` — text-bearing leaf; emits one region with flattened inlines. heading, paragraph.
- `source-text` — opaque-source leaf; emits one region with raw text. code, raw.
- `cells` — table; emits one inline-bearing region per cell. table.
- `inert` — leaf with no editable region. divider, directive.

This is the single source of truth for "what kind of block is this?" across the editor. Navigation predicates (`isContainerBlock`, `isInertBlock`), layout planning, and the deletion boundary-collapse rule all read `entry.kind` instead of literal `block.type` checks.

Adding a new block type is one entry in `BLOCK_CONTRIBUTIONS` (in `roots.ts`):

```ts
paragraph: (b) => ({ kind: "inline-text", inlines: b.children })  // text container
code:      (b) => ({ kind: "source-text", source: b.source })     // source container
blockquote:(b) => ({ kind: "container", children: b.children })   // recursive container
table:     (b) => ({ kind: "cells", cells: /* row × cell */ })    // table cells
divider:   ()  => ({ kind: "inert" })                             // inert leaf
```

The visitor dispatches on `contribution.kind`, not on `block.type`, so adding a new inline-text or source-text block type doesn't require any per-type branches in the visitor itself. Editing primitives in `reducer/text.ts` dispatch through `BLOCK_TEXT_MUTATORS`, a sibling data table keyed by `block.type` (it needs the finer granularity because code and raw rebuild differently). New block types touch both tables; the visitor and reducer stay free of per-type branching.

The discriminator on inline entries is `inline.node.type` — the document's `Inline` union — so adding an inline kind likewise touches the document layer and one case in `flattenInlineNodes`.

## What lives here

- `types.ts` — entry shapes (`BlockEntry`, `RegionEntry`, `InlineEntry`, `RootEntry`), `DocumentIndex`, the `BlockKind` taxonomy, and `ListItemMarker`.
- `inlines.ts` — `flattenInlineNodes` (the projection primitive), `regionInlines` / `findInlinesInSpan` (the canonical accessors), and `INLINE_OBJECT_REPLACEMENT_TEXT`. The length oracle is `measureInlineNodeText` from `@/document` — the index uses the document's canonical length helper rather than duplicating it. The `INLINE_OBJECT_REPLACEMENT_TEXT.length === 1` invariant is the cross-layer contract that keeps the two sides in lockstep.
- `roots.ts` — root construction, root positioning, and `BLOCK_CONTRIBUTIONS` (the declarative table mapping each block type to how it contributes regions).
- `build.ts` — `applyRootDelta`, the universal projection primitive, plus the per-document derived projections (`createCommentContainerIndex`, `createListItemMarkers`, `createDocumentImageUrls`).
- `query.ts` — core read algebra over the index: region/block lookup, structural-path lookup, table-cell resolution through document paths, primary-region resolution, ancestry traversal, editor-position comparison, and document-flow adjacency.
- `splice.ts` — public splice API: `createDocumentIndex`, `spliceDocumentIndex`, `replaceDocumentMetadata`, `replaceEditorBlock`, `commitDocument`.

`commentContainerIndex` is built here despite being anchor-flavored. The pragmatic reason: anchor reattachment uses it on the edit hot path and we already have the document reference and the visit. The substrate algebra still lives in `src/document/query/anchors.ts`. Note: `createCommentContainerIndex` is O(C × N) on cold build — each thread runs `resolveCommentThread` against the document. Reuse via `document.comments` identity hides this on edits; documents loaded with many existing threads pay it once.

## What doesn't live here

- **Anchor algebra** — `src/document/query/anchors.ts` (substrate) and `src/editor/anchors` (editor projection). Anchors project against runtime offsets but speak a content-addressable language. The index *exposes* `semanticRegionId` and `commentContainerIndex` for anchors to use; it does not own anchor resolution.
- **Layout cache** — `src/editor/layout`. The index produces immutable snapshots; layout is the cache-aware measurement layer above.
- **Document construction** — `src/document/build`. Builders, canonicalization, and id assignment live there; the index consumes finished `Document` values.
- **Text mutation** — `src/editor/state/reducer/text.ts`. The reducer owns block mutation via `BLOCK_TEXT_MUTATORS`; the index produces the read-only projection the reducer needs.

## Public query surface

Consumers above the index should use `query.ts` for reusable index algebra instead of reaching into `blockIndex`, `regionIndex`, `regionPathIndex`, `documentOrder`, `blockArrayIndex`, `parentBlockId`, or `regionIds` directly. Those fields are the storage substrate; `query.ts` is the stable vocabulary. Navigation still owns UX behavior like grapheme motion, visual-X retention, table caret policy, and hit-test composition, but it should compose index flow primitives (`previousRegionInFlow`, `nextBlockInFlow`, `isInertBlock`, etc.) rather than redefining editor topology.
