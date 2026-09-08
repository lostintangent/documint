# Document Index

The document index is the editor's random-access fast path over immutable `Document` snapshots. It turns body blocks into flat, path-keyed, range-indexed streams so editing, layout, and rendering can answer questions such as "what is at this position," "what lives under this block," and "what comes next" without re-walking the document on every keystroke or frame. Structured metadata stays in the document map and resolves through deterministic field paths only when requested.

## Design Notes

- **Index coordinates make tree-shaped queries direct.** The index materializes runtime traversal facts as three coordinate families:
  - **Paths** support lookup by structural address, including block paths and table-cell paths used by selections.
  - **Array positions** support document-order block flow and root-local traversal without re-walking the tree.
  - **Ranges** support block-subtree containment without walking descendants.
- **Roots keep most document edits local.** Most edits change one top-level document block, so the index groups each top-level subtree into an `IndexedRoot`. `applyRootDelta` swaps changed root slices and preserves unchanged siblings by reference, letting layout and rendering skip unedited roots. Root construction also updates list-item context, image/resource URL sets, and `commentContainerIndex` while it already has the changed subtree in hand.
- **Metadata paths avoid a duplicate runtime projection.** `query.ts` resolves deterministic key and value paths directly against the ordered document map. Metadata text joins `IndexedText` only while a field-local operation needs it. Booleans remain non-text targets, and neither kind enters roots, flat block arrays, table cells, body traversal counts, or document-flow navigation.
- **Global text order makes cross-path comparisons direct.** Text-bearing blocks and table cells carry one `editorOrder` in document order. Selection range checks can compare two resolved positions with integer math, including table cells that share one table block, without preserving a second root-local order model.
- **Body paths preserve structural meaning.** Body selection paths target text-bearing blocks or table cells. Text-bearing `IndexedBlock` variants and `IndexedTableCell` records carry `text`, `inlines`, and `editorOrder` directly, while non-text blocks do not expose text fields. Table-cell rows exist only on the `cells` block variant. `query.ts` owns body text-path boundary traversal so metadata cannot accidentally join search, structural editing, or adjacent-block flow.
- **The index projects the document's block classification; it does not author it.** Each `IndexedBlock.kind` is `@/document`'s `blockContentKind(block)` (`blocks` | `inlines` | `source` | `cells` | `void`), stamped during construction. The visitor dispatches on it to project the matching payload, but never re-derives the taxonomy from `block.type`.

## Subsystem Map

- `splice.ts` owns the public build and update boundary: `createDocumentIndex`, `spliceDocumentIndex`, non-block document replacement, block replacement, and `commitDocument`.
- `roots.ts` owns root construction and positioning: it stamps each block's document `blockContentKind` and projects the payload that kind implies (`IndexedRoot` slices, global text order, flat block streams, table-cell rows, path stamping, ranges, list-item context, and per-root URL collection).
- `build.ts` owns `applyRootDelta`, lookup-map maintenance, document-level projection reuse, and comment-container index invalidation.
- `query.ts` owns the reusable index algebra for block/table-cell lookup, metadata field paths, containment, document-flow text-path traversal, and editor-text projections.
- `inlines.ts` owns runtime inline range construction and conversion between editor indexed offsets and document `plainText` offsets.
- `types.ts` owns the index record contracts: `DocumentIndex`, body records, minimal metadata text/boolean records, and their unions. The block-kind discriminant is the document's `BlockContentKind`, not an index-local type.

The only document content this folder creates is the empty paragraph used to host a caret in an otherwise empty document, and `commitDocument` removes it before saving. Do not put anchor matching, layout measurement, document construction, or text-editing rules here. Those responsibilities live in `src/document/query/anchors`, `src/editor/anchors`, `src/editor/layout`, `src/document/build`, and `src/editor/state/reducer`.
