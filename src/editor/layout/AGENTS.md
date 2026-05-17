# Layout

The layout subsystem owns editor geometry. It turns `EditorState` into an `EditorLayoutState`: positioned lines, regions, blocks, total scroll height, paint overscan, off-screen bounds, and queryable geometry for caret, hit testing, navigation, anchors, and canvas paint.

Small/common documents use exact full-document layout. Large documents use whole-document height estimation to choose a virtualized visible slice, then measure that slice exactly.

## Design Principles

- **Visible geometry is exact.** Estimation is only a large-document optimization. Anything visible, selected, or hit-testable must have exact measured geometry, even when pinned outside the ordinary viewport slice.
- **Document space is the shared coordinate system.** Line/block Y values are positions in the full document, even when measured from a virtualized slice.
- **Exact and estimated paths must agree.** Both paths must walk blocks the same way and use the same gap, inset, image, and table policies. If one policy changes, update the other.
- **Cache keys are correctness.** Prepared text, measured lines, boundaries, heights, grapheme widths, and virtual layouts all depend on text, resources, and layout options.
- **Refinement is the cache write-back boundary.** Virtualized layout may update cached estimated heights after exact slice measurement; other layout work treats cache reads as memoization.
- **Hit testing is layered.** Prefer line containment, then block-padding fallback, then inert-leaf redirect through document flow when geometry alone cannot answer.
- **Measurement details stay behind layout/text APIs.** Browser-backed text metrics and resource-dependent image sizes are inputs to measurement, not reasons for callers to inspect DOM or duplicate layout math.

## Subsystem Map

- `index.ts` exposes the layout API and editor-facing adapters.
- `lib/` owns shared geometry, options, marker insets, and spacing policy.
- `state/` owns `createEditorLayoutState` and the per-editor `LayoutCache`.
- `measure/` owns exact layout composition for text, images, tables, lines, regions, and blocks.
- `virtualize/` owns large-document estimation, visible slice selection, pinned regions, exact slice measurement, and refinement.
- `query/` owns reads over prepared geometry: visible ranges, caret measurement, hit testing, and interaction targets.
