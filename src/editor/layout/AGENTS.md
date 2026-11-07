# Layout

The layout subsystem owns editor geometry. It turns `EditorState` into an `EditorLayoutState`: positioned lines, text-path bounds, blocks, total scroll height, paint overscan, off-screen bounds, and queryable geometry for caret measurement, navigation, anchors, and renderer paint.

Small/common documents use exact full-document layout. Large documents use whole-document height estimation to choose a virtualized visible slice, then measure that slice exactly.

## Design Principles

- **Visible geometry is exact.** Estimation is only a large-document optimization. Anything visible, selected, or hit-testable must have exact measured geometry, even when pinned outside the ordinary viewport slice.
- **Line ranges tile the source, so every typed character has geometry.** A text path's lines cover every source offset, giving leading, doubled, and trailing whitespace real width and caret stops as a `pre-wrap` editor would, while wrapping stays `white-space: normal` and a lone soft newline still reads as one space. Pretext's normal mode collapses whitespace, so `measure/text.ts` pins runs with same-length no-break spaces and hangs trailing whitespace on the last line. The tradeoff is that extra spaces at a wrap point count toward the previous word instead of hanging. Query, paint, and navigation trust that every offset sits inside its line, so fix coverage gaps here rather than adding caret or paint workarounds downstream.
- **Document space is the shared coordinate system.** Line/block Y values are positions in the full document, even when measured from a virtualized slice.
- **Structured metadata prefixes compose without entering body flow.** Structured metadata owns header, row, cell, text, and checkbox geometry in `DocumentLayout.metadata`; raw compatibility metadata remains a Markdown-only value. Body measurement and virtual estimates stay body-relative, then composition applies one prefix offset so exact layout, viewport slices, path bounds, and scroll height agree.
- **Virtual slices keep the index whole.** Exact slice measurement receives the canonical `DocumentIndex` plus slice boundaries expressed over measured block/path bounds. Do not pass a shallow index with sliced records, because index block ranges are global coordinates.
- **Exact and estimated paths must agree.** Both paths must walk blocks the same way and use the same gap, inset, padding, image, and table policies. If one policy changes, update the other.
- **Cache keys are correctness.** Prepared text, measured lines, boundaries, heights, grapheme widths, and virtual layouts all depend on text, resources, and layout options. A small document reuses its full layout across scrolls while its index and resources are the same objects, so resource changes must arrive as a new resources object.
- **Refinement is the cache write-back boundary.** Virtualized layout may update cached estimated heights after exact slice measurement; other layout work treats cache reads as memoization. Refinement touches only the slice and shifts later entries only when the slice drifted, so scrolling over refined content never walks the whole document.
- **Measured heights survive edits, so typing in a long document doesn't jump the view.** Every edit rebuilds the virtual layout, so heights are keyed by text, inline signature, width, and typography rather than by path, and an Enter that re-paths everything below still finds them. Eviction drops the least recently measured heights, and each pass keeps its slice fresh, so a long typing session never evicts what is on screen. Measured lines stay path-keyed, because a hash collision there would paint the wrong text, while a colliding height only skews an off-screen estimate.
- **Hit testing is geometric here.** Layout may answer which measured line/offset a point lands on. Editor policies such as inert-leaf redirects, drag clamping, word selection, link hits, and task-toggle targeting belong above layout.
- **Measurement details stay behind layout/text APIs.** Browser-backed text metrics and resource-dependent image sizes are inputs to measurement, not reasons for callers to inspect DOM or duplicate layout math.
- **Pretext picks wrap points, and canvas measures caret stops.** Pretext exposes widths only at segment edges and has no per-grapheme API, so caret x positions and per-run paint widths still come from canvas measurement in `measure/text.ts` and `query/`. Moving caret measurement to Pretext would mean running both measurers and would keep the grapheme caches anyway.
- **Pills break as atomic boxes at the width they paint.** Mentions, resources, and inline images enter Pretext as `RichInlineBox` items sized to the pill width, including minimum widths (18px mention, 30px resource). The old text item with `extraWidth` skipped those minimums, so a short pill could wrap its line narrower than the pill drawn on it. The painter insets the label inside the pill, so layout owns only the outer edge. Images use the same path, so a soft newline between image-only lines joins them onto one line.
- **Layout sizes each image box once, so paint and pointer targets agree.** Images keep their aspect ratio, shrink only to fit the line, and reserve a placeholder while loading so nearby text stays put. Paint, hit testing, and image overlays all read that one box, so a minimum applied downstream would draw a box layout never reserved.
- **The list item owns its marker gutter, so markers and block surfaces never overlap.** Markers anchor on the item's own left edge through `resolveListMarkerTarget`, which paint and task-toggle hits share, so bullets line up whatever block an item starts with. Block surfaces such as table grids, quote bars, divider rules, and code backgrounds start after the gutter at `resolveBlockSurfaceLeft`. Chrome placed from block depth alone would land under the marker.
- **Pretext picks its breaking rules from the user agent, so tests pin one set.** Firefox, WebKit, and Blink each get a profile, and an unmatched user agent falls back to Blink. Bun's user agent matches none, so `test/setup-canvas.ts` appends Blink tokens to the host user agent to keep golden wraps deterministic. Keep OS tokens out of that string, because `resolveEditorHostPlatform` reads the same user agent and would report a Linux host as Mac.
- **Store core geometry, derive visual geometry.** `DocumentLayout` stores the
  measured primitives that define document space: line boxes, block extents,
  text-path bounds, line indices, options, and total height. Cheap or
  caller-specific geometry lives in `query/` helpers and is resolved just in
  time from prepared lines: caret visual X, list-marker anchors/bounds, inline
  object bounds, and text segment bounds. This keeps virtualized layout from
  eagerly computing intra-line chrome for offscreen content while still giving
  paint, navigation, and hit testing one shared geometry API. Promote derived
  geometry into measured layout state only when it affects wrapping,
  virtualization, broad hit testing, or becomes stable prepared render input
  that multiple callers would otherwise recompute.

## Known Limitations

Pretext widths can differ from canvas paint by a few pixels. In WebKit, bold 26px text drifts up to about 1.4px, and monospace text with CJK fallback drifts up to 4.2px in Chromium. A wrap can then land where paint is a few pixels wider or narrower than the line. Caret positions still match paint, because they come from canvas measurement. Fixing this would mean canvas-measuring every break, which removes the reason to use Pretext. Revisit if drift grows to about a glyph at body sizes, or if a Pretext release changes its profiles.

## Subsystem Map

- `index.ts` exposes the layout API.
- `lib/` owns shared layout policy: options, block spacing, and list/task marker metrics.
- `state/` owns `createEditorLayoutState` and the per-editor `LayoutCache`.
- `measure/` owns exact layout composition for metadata, text, inline objects, tables, lines, text paths, and blocks. Pretext computes line breaks in `text.ts`, with pills and images entering it as boxes from `inline-reference.ts`.
- `virtualize/` owns large-document estimates, virtual layout construction, visible slice selection, exact slice measurement, and refinement.
- [`query/`](query/AGENTS.md) owns reads over prepared geometry: visible ranges, caret measurement, point-to-line hit testing, and visual bounds.
