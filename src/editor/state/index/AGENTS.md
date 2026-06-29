# Document Index

The document index is the editor's random-access fast path over immutable `Document` snapshots. It turns the document tree into flat, path-keyed, range-indexed streams so editing, layout, and rendering can answer questions such as "what is at this position," "what lives under this block," and "what comes next" without re-walking the tree on every keystroke or frame. A `DocumentIndex` never copies semantic payload: document nodes remain the source of truth, and indexed records only describe where those nodes live in editor coordinate space.

## Design Notes

- **Index coordinates make tree-shaped queries direct.** The index materializes runtime traversal facts as three coordinate families:
  - **Paths** support lookup by structural address, such as resolving the block or region for a selection point.
  - **Array positions** support document-order flow, such as moving to the previous or next block or region.
  - **Ranges** support subtree containment, such as asking which regions live under a block without walking its descendants.
- **Roots keep most document edits local.** Most edits change one top-level document block, so the index groups each top-level subtree into an `IndexedRoot`. `applyRootDelta` swaps changed root slices and preserves unchanged siblings by reference, letting layout and rendering skip unedited roots. Root construction also updates list-item context, image/resource URL sets, and `commentContainerIndex` while it already has the changed subtree in hand.
- **Regions let every editable surface behave like one text field.** Semantic blocks do not map one-to-one to caret hosts: one table block contains many editable cells, while an inert block like a divider contains none. The index projects each editable surface into an `EditableRegion` with region-local text and offsets. Selection, hit testing, layout, and paint work with regions instead of branching over prose, source text, table cells, and inert blocks.

## Subsystem Map

- `splice.ts` owns the public build and update boundary: `createDocumentIndex`, `spliceDocumentIndex`, metadata replacement, block replacement, and `commitDocument`.
- `roots.ts` owns root construction and positioning, including `BLOCK_CONTRIBUTIONS`, `IndexedRoot` slices, flat block and region streams, path stamping, ranges, list-item context, and per-root URL collection.
- `build.ts` owns `applyRootDelta`, lookup-map maintenance, document-level projection reuse, and comment-container index invalidation.
- `query.ts` owns the reusable index algebra for lookup, containment, flow, shape checks, active handles, and primary-region resolution.
- `inlines.ts` owns runtime inline range construction, region inline accessors, and conversion between region offsets and document `plainText` offsets.
- `types.ts` owns the index record contracts: `DocumentIndex`, `IndexedBlock`, `EditableRegion`, `IndexedInline`, `IndexedRoot`, `BlockKind`, and `IndexedListItem`.

The only document content this folder creates is the empty paragraph used to host a caret in an otherwise empty document, and `commitDocument` removes it before saving. Do not put anchor matching, layout measurement, document construction, or text-editing rules here. Those responsibilities live in `src/document/query/anchors`, `src/editor/anchors`, `src/editor/layout`, `src/document/build`, and `src/editor/state/reducer`.
