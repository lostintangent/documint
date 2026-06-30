# Document Index

The document index is the editor's random-access fast path over immutable `Document` snapshots. It turns the document tree into flat, path-keyed, range-indexed streams so editing, layout, and rendering can answer questions such as "what is at this position," "what lives under this block," and "what comes next" without re-walking the tree on every keystroke or frame. A `DocumentIndex` never copies semantic payload: document nodes remain the source of truth, and indexed records only describe where those nodes live in editor coordinate space.

## Design Notes

- **Index coordinates make tree-shaped queries direct.** The index materializes runtime traversal facts as three coordinate families:
  - **Paths** support lookup by structural address, including block paths and table-cell paths used by selections.
  - **Array positions** support document-order block flow and root-local traversal without re-walking the tree.
  - **Ranges** support block-subtree containment without walking descendants.
- **Roots keep most document edits local.** Most edits change one top-level document block, so the index groups each top-level subtree into an `IndexedRoot`. `applyRootDelta` swaps changed root slices and preserves unchanged siblings by reference, letting layout and rendering skip unedited roots. Root construction also updates list-item context, image/resource URL sets, and `commentContainerIndex` while it already has the changed subtree in hand.
- **Global text order makes cross-path comparisons direct.** Text-bearing blocks and table cells carry one `editorOrder` in document order. Selection range checks can compare two resolved positions with integer math, including table cells that share one table block, without preserving a second root-local order model.
- **Paths are the editor address space.** Selection paths target either text-bearing blocks or table cells. Text-bearing `IndexedBlock` variants and `IndexedTableCell` records carry `text`, `inlines`, and `editorOrder` directly, while non-text blocks do not expose text fields. `IndexedText` names that existing record union without adding another runtime object. Table-cell rows exist only on the `cells` block variant. `query.ts` owns text-path boundary traversal so consumers ask for the first or last text path inside a document or block without introducing a second editable-surface concept.
- **The index projects the document's block classification; it does not author it.** Each `IndexedBlock.kind` is `@/document`'s `blockContentKind(block)` (`blocks` | `inlines` | `source` | `cells` | `void`), stamped during construction. The visitor dispatches on it to project the matching payload, but never re-derives the taxonomy from `block.type`.

## Subsystem Map

- `splice.ts` owns the public build and update boundary: `createDocumentIndex`, `spliceDocumentIndex`, metadata replacement, block replacement, and `commitDocument`.
- `roots.ts` owns root construction and positioning: it stamps each block's document `blockContentKind` and projects the payload that kind implies (`IndexedRoot` slices, global text order, flat block streams, table-cell rows, path stamping, ranges, list-item context, and per-root URL collection).
- `build.ts` owns `applyRootDelta`, lookup-map maintenance, document-level projection reuse, and comment-container index invalidation.
- `query.ts` owns the reusable index algebra for block/table-cell lookup, containment, document-flow text-path traversal, and editor-text projections.
- `inlines.ts` owns runtime inline range construction and conversion between editor indexed offsets and document `plainText` offsets.
- `types.ts` owns the index record contracts: `DocumentIndex`, `IndexedBlock`, `IndexedText`, `IndexedTableCell`, `IndexedInline`, `IndexedRoot`, and `IndexedListItem`. The block-kind discriminant is the document's `BlockContentKind`, not an index-local type.

The only document content this folder creates is the empty paragraph used to host a caret in an otherwise empty document, and `commitDocument` removes it before saving. Do not put anchor matching, layout measurement, document construction, or text-editing rules here. Those responsibilities live in `src/document/query/anchors`, `src/editor/anchors`, `src/editor/layout`, `src/document/build`, and `src/editor/state/reducer`.
