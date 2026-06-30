# Layout Query

Layout query is the read-only geometry layer over a prepared `DocumentLayout`. Finished layout goes in, and document-space answers come out. Its central vocabulary is derived geometry: caret targets, line lookups, visual marker bounds, inline object bounds, visible ranges, and viewport reveal positions. These answers are resolved just in time for paint, navigation, hit testing, overlays, and scrolling without becoming new layout state.

## Design Notes

- **Finished layout stays the source of truth.** Query helpers read `DocumentLayout`, `EditorLayoutState`, and explicit caller inputs without mutating layout or reaching into host effects, so paint, navigation, and overlays share geometry without recomputing measurement.
- **Line lookup is the geometry choke point.** `line-lookup.ts` owns the binary searches, path-line indices, boundary midpoint rules, and same-row disambiguation needed to map points and offsets back to prepared lines. Duplicating that logic risks table cells, wrapped lines, and end-offset cases drifting apart.
- **Derived visuals stay cheap unless they affect measurement.** Caret visual X, list-marker bounds, and inline image rectangles are reads over measured lines plus shared metric policy. If a value changes wrapping, list text inset, virtualization, broad hit testing, or cache keys, it belongs in `lib/`, `measure/`, or `state/` instead of `query/`.
- **Hit tests return geometry before editor meaning.** `hitTestDocumentLayout` returns the line and source offset a point lands on, while editor policies such as task toggles, inert-leaf redirects, link hits, word selection, and drag clamping remain in navigation.
- **Viewport queries choose targets, hosts perform scroll.** Visible-range and reveal helpers classify prepared geometry and resolve scroll-top candidates in document space. The component host still owns browser scroll effects and scheduling.

## Subsystem Map

- `index.ts` owns the public query surface re-exported through the layout API.
- `line-lookup.ts` owns line lookup, path-line disambiguation, and text-boundary offset/left projection.
- `caret.ts` owns caret target measurement plus visual-left and hit-test-X adjustments.
- `hit-test.ts` owns layout-only point-to-offset hit testing.
- `line-visuals.ts` owns just-in-time visual bounds and marker anchors shared by paint, navigation, and hit testing.
- `viewport-ranges.ts` owns visible line/block range queries over prepared layout.
- `viewport-position.ts` owns viewport-relative classification and scroll-reveal target calculation.
