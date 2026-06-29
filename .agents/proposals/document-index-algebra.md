# Document Index Algebra Proposal

## Goal

Make the document index read like a small runtime algebra instead of a collection of ad hoc lookup helpers, while keeping the document subsystem as the semantic source of truth.

The intended split:

- `src/document` owns semantic tree laws: path construction, path parsing, parent/sibling/root relations, structural child traversal, plain text, and content-addressable anchors.
- `src/editor/state/index` owns materialized runtime coordinates: flattened block order, flattened region order, editor selection-offset text, `EditableRegion` records, lookup maps, identity reuse, the empty-document caret shim, and incremental index updates.

The outcome should be a thinner index whose topology is a fast materialization of document-defined path and tree relations, not a second semantic model of the document.

## Starting Point

`DocumentIndex` already has a strong shape:

- `IndexedRoot` owns `blockRange` and `regionRange` over `DocumentIndex.blocks` and `DocumentIndex.regions`.
- `DocumentIndex.blockIndex` and `DocumentIndex.regionIndex` are path-keyed.
- `IndexedBlock.parentBlockPath`, `blockArrayIndex`, and `depth` make ancestry and flow queries fast.
- `EditableRegion` owns editor-only region text and offsets, which are distinct from document `plainText` offsets.

The weak spots at the start of this sequence were concentrated:

- `IndexedBlock.start` and `IndexedBlock.end` are written and shifted but not read by production code.
- `IndexedBlock.regionPaths` stores direct region paths. Its readers either used it on leaf blocks, where direct regions equal subtree regions, or used it as the seed for manual descendant scans.
- `resolvePrimaryRegionForBlockPath`, `selectionIntersectsBlockPath`, viewport table expansion, virtual table layout, and `walkLayoutBlocks` reconstruct region extents by scanning flat arrays or dereferencing paths.
- Virtual layout currently passes a shallow `DocumentIndex` clone whose `regions` array is sliced to viewport-local indices while `blocks`, `blockIndex`, and `regionIndex` remain global. Numeric global region ranges cannot safely compose with that shape.
- `roots.ts` defines `BLOCK_CONTRIBUTIONS`, while document code separately defines `blockContainerSpec` and text-anchor container policy. These are related but not identical concepts.

## Proposed Design

### Document Path Law

Add one narrow document path containment relation:

```ts
blockPathContainsPath(ancestorBlockPath, descendantPath): boolean
```

Contract:

- The ancestor must be a valid block path.
- The descendant may be any structural path whose containing block can be derived by the path algebra: block paths, child-container paths, source paths, table-row paths, and table-cell paths.
- The relation is reflexive for the same block path.
- A block path contains descendant block paths and the content paths owned by descendant blocks.
- A table block path, and any ancestor block path of that table, contains the table's row and cell paths.
- Sibling prefix traps such as `root.1` vs `root.10` return false.
- Malformed paths and invalid ancestor paths return false.

This helper is not for hot paths. It is the document-owned semantic law used by tests and source-level reasoning. The index materializes the same containment relation with numeric ranges.

### Index Range Encoding

Use hot-path scalar fields on `IndexedBlock`, not per-block range objects. `blockArrayIndex` is already the start of the block's pre-order subtree range, so do not add a duplicate block-range start field:

```ts
blockArrayIndex: number; // also the half-open block range start
blockRangeEnd: number;   // half-open end, this block plus descendants in DocumentIndex.blocks
regionRangeStart: number;
regionRangeEnd: number;  // half-open range, all editable regions under this block
```

Keep root range objects only where they already exist, but make `IndexedRoot.regionRange` always defined. A no-region root gets `{ start: regionIndex, end: regionIndex }`. Code that needs to know whether a root contributes visible regions should test `root.regions.length > 0`, not `regionRange === undefined`.

Range invariants:

- Ranges are half-open: `start` is inclusive, `end` is exclusive.
- Block ranges are nested, not disjoint. A child block's block range is contained by every ancestor block's block range.
- Region ranges are nested by block ancestry. A container block's region range includes descendant leaf regions.
- Empty region ranges are valid and represent a block with no editable descendants.
- Flat, non-overlapping enumeration walks roots or leaf blocks. Code must not iterate every block and then every block's region range, because that counts descendant regions once per ancestor.
- For block paths in one snapshot, `blockPathContainsPath(parent.path, child.path)` and numeric block-range containment should agree.
- A root's range objects must match its root block's scalar ranges: `root.blockRange.start === rootBlock.blockArrayIndex`, `root.blockRange.end === rootBlock.blockRangeEnd`, and the root region range must match the root block's region range.

### Document Tree Structure

Do not add parent pointers or a persistent parent-linked document tree overlay.

The document already owns the immutable value tree. Its navigation form is the path algebra plus resolvers: parent, sibling, descendant, and containment operations are pure functions over `(document, path)`. That preserves structural sharing across snapshots. A persistent parent-linked overlay would reintroduce runtime identity tension because the same shared node can live under different parents across snapshots.

If a document-layer algorithm later profiles hot because it repeatedly resolves paths in one pass, use an operation-scoped map for that pass. Do not store parent links or indexed runtime coordinates on document nodes.

### Layout Scope

Before deleting `regionPaths`, virtual layout must stop passing a fake sliced `DocumentIndex`.

Exact full-document layout uses `regionStartIndex = 0` and `regionEndIndex = documentIndex.regions.length`.

Virtual layout passes the full `DocumentIndex` plus the chosen global `regionStartIndex` / `regionEndIndex` scalars and `startY`. `measureLayoutSlice` and `walkLayoutBlocks` then operate against canonical global `documentIndex.regions`, filtering leaf-block regions by those bounds. Measurement also derives a block coverage span from the first and last in-bounds regions so inert leaves between visible regions are included, while inert leaves outside the measured slice are excluded. This keeps global block and region ranges meaningful and avoids region-array index lies without introducing a new range type.

### Query Surface Direction

Add only the range-backed helpers that the migrations prove:

- `firstRegionInBlock(documentIndex, indexedBlock)` for primary-region resolution.
- `blockContainsBlock(parent, child)` for selection and ancestry checks.
- `blockContainsRegion(block, region)` for selection and target checks.
- A layout-specific leaf-region span helper if `walkLayoutBlocks` needs one.

Avoid helpers that allocate arrays on hot paths. Do not add a generic `regionsInBlock(...): EditableRegion[]` unless a non-hot caller needs a materialized array. Prefer direct loops or spans over slices.

### Taxonomy Direction

Do not make `document` own editor runtime regions. That would invert the leak.

The core sequence should make one narrow structural improvement: container traversal in the index should consume document-owned child traversal (`getBlockChildren` / `blockContainerSpec`) or get parity tests proving `BLOCK_CONTRIBUTIONS.container` agrees with document traversal.

Do not introduce a broad `blockContentRole` or god `blockSpec` in this sequence. Editability, anchorability, source handling, table-cell projection, and inert layout policy are related but distinct:

- `blockContainerSpec` owns child-block traversal and rebuild.
- `anchorKindForBlockType` owns text-anchor container policy.
- `BLOCK_CONTRIBUTIONS` owns editor runtime region projection.
- `BLOCK_TEXT_MUTATORS` owns text mutation rebuild policy.

`raw` is the key proof: it is editor-editable source text, but it is not currently a text-anchor container.

## Anti-Goals

- Do not move `EditableRegion`, editor selection-offset text, inline flattening, char offsets, lookup maps, identity reuse, or the empty-document caret shim into `src/document`.
- Do not introduce a document-owned flattened runtime projection.
- Do not add generic range/flow abstractions that are not proven by concrete migrations.
- Do not merge anchor containers and editable regions. They remain adjacent but distinct coordinate spaces.
- Do not keep both `regionPaths` and region ranges after the reader migration is complete.
- Do not reorganize all of `query.ts` in the same milestone as the range substrate. Rename or regroup only after the new primitive has simplified callers.

## Implementation Sequence

### Milestone 1: Remove Dead Block Character Coordinates

What changes:

- Delete `IndexedBlock.start` and `IndexedBlock.end`.
- Stop stamping and shifting those fields in `roots.ts`.
- Update comments in `types.ts`, `roots.ts`, and `src/editor/state/index/AGENTS.md`.

Why now:

- These fields are verified write-only in production.
- This removes an unused coordinate space before introducing the new one.

Self-critique and risk:

- Tests may assert these fields even though production does not read them.
- If a hidden consumer outside `src/` reads them, this is an API break. Current repo evidence says they are internal.

Validation:

- Targeted grep for `indexedBlock.start`, `indexedBlock.end`, and `IndexedBlock` construction.
- `bun typecheck`
- `bun test test/editor/state/index.test.ts test/editor/state/build.test.ts`

### Milestone 2: Add Strict Block Path Containment

What changes:

- Add `blockPathContainsPath` to `src/document/model/paths.ts`.
- Parse paths through the existing path parser helpers. Do not use string prefix matching.
- Cover block ancestors, nested table cells, sibling prefix traps, malformed paths, source paths, child-container paths, and row paths.

Why now:

- It names the semantic relation that index block ranges materialize.
- It lets range tests compare fast integer containment against document-owned path containment from the start.

Self-critique and risk:

- Keep the ancestor requirement in the name. A fully generic `pathContains` would imply table cells, rows, or content slots can also be ancestors, which this relation does not support.
- This helper should not move into typing, selection, or layout hot paths.

Validation:

- `bun test test/document/paths.test.ts`
- New path tests for reflexive block containment, nested block containment, block-to-content-path containment, table block to row/cell containment, ancestor block to nested row/cell containment, cross-root false, sibling false, `root.1` vs `root.10` false, invalid ancestor false, and malformed descendant false.

### Milestone 3: Add Per-Block Order Ranges

What changes:

- Add scalar range fields to `IndexedBlock`: `blockRangeEnd`, `regionRangeStart`, `regionRangeEnd`.
- Reuse `blockArrayIndex` as the block range start. Do not add a duplicate `blockRangeStart`.
- Make `IndexedRoot.regionRange` always defined, with empty ranges for no-region roots.
- Audit existing `root.regionRange === undefined` behavior and move visibility checks to `root.regions.length > 0` where preserving today's no-visible-region behavior matters.
- In `createIndexedRoot`, capture `blockStart` and `regionStart`, push the indexed block, recurse or emit regions, then assign half-open end indices.
- In `positionIndexedRoot`, compute separate deltas:
  - `blockIndexDelta = nextRoot.blockRange.start - root.blockRange.start`
  - `regionIndexDelta = nextRoot.regionRange.start - root.regionRange.start`
  - `charDelta = nextRoot.start - root.start`
- Shift `blockRangeEnd` by `blockIndexDelta` and region range scalar fields by `regionIndexDelta`.
- Shift region `documentOrder` by `regionIndexDelta` and region char offsets by `charDelta`.
- Preserve correct behavior when `positionIndexedRoots` receives a mix of fresh local roots and already-positioned suffix roots from `spliceDocumentIndex`.
- Either route container child traversal through document `getBlockChildren` or add a parity test proving index container traversal matches document traversal.

Why now:

- This is the substrate that replaces manual descendant scans and `regionPaths`.
- It can land before migrating all consumers, making the range invariants testable in isolation.

Self-critique and risk:

- The tricky part is range stamping for recursive containers, tables, inert blocks, and mixed fresh/positioned roots during splices.
- Region-less roots and blocks need correct empty insertion ranges, not `undefined`.
- Extra scalar fields add per-block data, but they replace two dead block char coordinates and allow `regionPaths` arrays to be deleted later.

Validation:

- Add tests asserting nested block and region ranges on blockquote/list/table/inert shapes.
- Add tests for empty document shim and a container whose descendants are all inert.
- Add tests for existing `resolveRegionOutsideRoot` / no-visible-root behavior before and after root `regionRange` becomes always defined.
- Add tests asserting each `IndexedRoot` range matches its root `IndexedBlock` scalar ranges.
- Add tests asserting shifted suffix roots preserve document block identity while re-stamped ranges remain correct.
- Add invariant tests:
  - every child block range is contained by its parent block range
  - every region under a block has `documentOrder` inside the block's region range
  - `blockPathContainsPath(parent.path, child.path)` agrees with block-range containment for representative indexed blocks
  - `blockPathContainsPath(block.path, region.path)` agrees with region-range containment for representative editable regions

### Milestone 4: Replace Sliced Layout Indexes With Explicit Region Scope

What changes:

- Change `measureLayoutSlice` to accept the full `DocumentIndex` plus optional `regionStartIndex` / `regionEndIndex` scalar parameters, instead of requiring callers to replace `documentIndex.regions` with a slice.
- Change `createVirtualizedLayoutSlice` to pass the full `documentIndex` and global slice bounds.
- Change `walkLayoutBlocks` to receive canonical block coverage and visible region filtering derived from the active bounds. Inert leaves use the derived block coverage span, since they have empty region ranges.
- Keep inert leaf behavior: inert blocks still lay out even though they have empty region ranges.

Why now:

- Global numeric region ranges cannot safely compose with the current fake sliced `DocumentIndex`.
- This is the blocker that must be resolved before deleting `regionPaths`.

Self-critique and risk:

- This touches layout plumbing and must preserve exact full-layout and virtual-layout geometry.
- `walkLayoutBlocks` currently exposes `blockRegionsInScope` as paths. Converting that to spans or an iterator is a real API change inside layout.
- With a full `DocumentIndex`, inert leaves outside the active virtual scope must not be accidentally laid out just because they have no region range to filter against.
- Virtualized table expansion must still measure the whole table when any cell is visible.

Validation:

- Existing layout tests:
  - `bun test test/editor/layout/state.test.ts test/editor/layout/measure.test.ts`
  - `bun test test/renderer/frame.test.ts test/renderer/paint.test.ts`
- Add virtual layout tests proving:
  - a viewport slice containing one table cell measures the whole table
  - exact layout and virtual layout stay aligned for a large document with visible inert blocks
  - an inert leaf between two visible regions enters the measured slice
  - inert leaves outside explicit virtual region bounds do not enter the measured slice
  - a sliced viewport no longer depends on a mutated `DocumentIndex.regions` array

### Milestone 5: Migrate Range Consumers And Delete `regionPaths`

What changes:

- `resolvePrimaryRegionForBlockPath` uses `firstRegionInBlock`.
- `selectionIntersectsBlockPath` uses range arithmetic:
  - collapsed selections check whether the focused block is within the target block range
  - non-collapsed selections compare normalized endpoint region orders against the target region range, with boundary-offset checks where needed
- `expandViewportSliceToBlockBoundaries` expands table scopes using leaf block region ranges.
- `appendTableEstimateEntries` / virtual table layout use the table block's leaf region span, not `regionPaths.length`.
- `walkLayoutBlocks` no longer reads `regionPaths`.
- Remove `IndexedBlock.regionPaths` and all writes in `roots.ts`.
- Update `src/editor/state/index/AGENTS.md` to describe nested scalar ranges as the index topology substrate.

Why now:

- Once layout scope is explicit, all remaining `regionPaths` readers can move safely.
- Keeping `regionPaths` after this would leave a second vocabulary for the same runtime extent.

Self-critique and risk:

- `selectionIntersectsBlockPath` currently handles collapsed and range selections through region-level intersection. The range rewrite must preserve edge behavior at region boundaries.
- Regionless containers should keep current behavior: no editable descendant means no primary region and no selection intersection unless a future UX rule says otherwise.
- Leaf-only layout walkers must not accidentally enumerate descendant ranges for containers.

Validation:

- `rg "regionPaths" src test` returns no implementation reads.
- Focused tests:
  - `bun test test/editor/state/selection/query.test.ts`
  - `bun test test/editor/layout/state.test.ts test/editor/layout/measure.test.ts`
  - `bun test test/editor/navigation/flow.test.ts`
- Add selection tests for:
  - collapsed table-cell selection intersects the table and enclosing container
  - selection spanning before-to-after a table/list intersects it
  - selection spanning a regionless inert-only container preserves current behavior
  - selection from the previous region's end to the target region's start preserves the intended boundary-intersection behavior

## Follow-Up Debt

- Audit remaining block taxonomy duplication after the range work lands. Keep the audit narrow: structural traversal may be document-owned, but editability, anchorability, and runtime region projection are distinct.
- Revisit block identity reuse after deleting `IndexedBlock.start/end`. Blocks may no longer need cloning for char-offset-only root shifts, while regions still do.
- Consider query surface organization after `regionPaths` is gone and the remaining read algebra is visible.
- Consider root range shape cleanup if root object ranges remain noisy after block ranges move to scalar fields.

## Risks

- **Inverted ownership leak.** Moving runtime projections into document would make the document layer know editor facts. Mitigation: document only gets strict path relations and structural child traversal.
- **Virtual layout index lies.** Global ranges are wrong against a sliced `DocumentIndex.regions`. Mitigation: pass explicit `regionStartIndex` / `regionEndIndex` scalars before deleting `regionPaths`.
- **Nested-range double enumeration.** Block ranges overlap by design. Mitigation: document the invariant and migrate callers through leaf/root walks or targeted range predicates.
- **Range stamping bugs.** Recursive range end stamping can be off by one for containers, tables, inert blocks, mixed fresh/positioned roots, and empty ranges. Mitigation: direct invariant tests over representative trees.
- **Hot-path allocation regressions.** Object ranges and `slice()` helpers can add churn. Mitigation: use scalar per-block fields, reuse `blockArrayIndex` as the block range start, and prefer loops/spans over materialized arrays.
- **Helper creep.** A generic range/flow toolkit could be as hard to read as the current phrasebook. Mitigation: add helpers only when a migration deletes repeated code.

## Validation Plan

Every milestone:

- `bun typecheck`
- `bun run lint`
- `git diff --check`
- Focused unit tests for touched subsystem.

Before calling the sequence complete:

- `bun test`
- Focused benchmarks:
  - `editor_typing_long`
  - `editor_splice_blocks_long`
  - `editor_typing_long_full_frame`
  - `editor_typing_table`
  - `editor_typing_comments_elsewhere`
  - layout scroll/canvas rows that exercise virtual layout
- Add or run a front-splice/suffix-shift benchmark if existing rows do not cover it, because range re-stamping is most visible there.
- One grep pass for deleted vocabulary:
  - `IndexedBlock.start`
  - `IndexedBlock.end`
  - `regionPaths`

## Open Questions

- Should the document path algebra ever expose a general path ordering helper? Not until concrete callers prove a total order across mixed path kinds is useful and unambiguous.
- Should list-item and resource/image projections move toward document semantic queries? Not now. They are collected during the index's single hot-path walk, and moving them risks extra traversals for low cohesion gain.
- Should range fields eventually become object-shaped at public boundaries? Per-block hot-path records should stay scalar unless measurements prove object ranges are harmless.
- Should document add more navigation helpers such as parent/sibling/ancestor resolvers? Only when migrations reveal repeated hand-rolled path navigation. Keep them lazy pure path operations, not a persistent tree overlay.
