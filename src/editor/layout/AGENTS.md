# Layout

The layout subsystem owns editor geometry. It turns `EditorState` into an `EditorLayoutState`: positioned lines, regions, blocks, total scroll height, paint overscan, off-screen bounds, and queryable geometry for caret measurement, navigation, anchors, and renderer paint.

Small/common documents use exact full-document layout. Large documents use whole-document height estimation to choose a virtualized visible slice, then measure that slice exactly.

## Design Principles

- **Visible geometry is exact.** Estimation is only a large-document optimization. Anything visible, selected, or hit-testable must have exact measured geometry, even when pinned outside the ordinary viewport slice.
- **Document space is the shared coordinate system.** Line/block Y values are positions in the full document, even when measured from a virtualized slice.
- **Exact and estimated paths must agree.** Both paths must walk blocks the same way and use the same gap, inset, image, and table policies. If one policy changes, update the other.
- **Cache keys are correctness.** Prepared text, measured lines, boundaries, heights, grapheme widths, and virtual layouts all depend on text, resources, and layout options.
- **Refinement is the cache write-back boundary.** Virtualized layout may update cached estimated heights after exact slice measurement; other layout work treats cache reads as memoization.
- **Hit testing is geometric here.** Layout may answer which measured line/offset a point lands on. Editor policies such as inert-leaf redirects, drag clamping, word selection, link hits, and task-toggle targeting belong above layout.
- **Measurement details stay behind layout/text APIs.** Browser-backed text metrics and resource-dependent image sizes are inputs to measurement, not reasons for callers to inspect DOM or duplicate layout math.
- **Store core geometry, derive visual geometry.** `DocumentLayout` stores the
  measured primitives that define document space: line boxes, block extents,
  region bounds, line indices, options, and total height. Cheap or
  caller-specific geometry lives in `query/` helpers and is resolved just in
  time from prepared lines: caret visual X, list-marker anchors/bounds, inline
  object bounds, and text segment bounds. This keeps virtualized layout from
  eagerly computing intra-line chrome for offscreen content while still giving
  paint, navigation, and hit testing one shared geometry API. Promote derived
  geometry into measured layout state only when it affects wrapping,
  virtualization, broad hit testing, or becomes stable prepared render input
  that multiple callers would otherwise recompute.

## Subsystem Map

- `index.ts` exposes the layout API and editor-facing adapters.
- `lib/` owns shared layout policy: options, block spacing, and list/task marker metrics.
- `state/` owns `createEditorLayoutState` and the per-editor `LayoutCache`.
- `measure/` owns exact layout composition for text, inline objects, tables, lines, regions, and blocks.
- `virtualize/` owns large-document estimates, virtual layout construction, visible slice selection, exact slice measurement, and refinement.
- `query/` owns reads over prepared geometry: visible ranges, caret measurement, point-to-line hit testing, and visual bounds.
