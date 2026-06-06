# Renderer

The renderer subsystem owns immediate-mode Canvas 2D painting from prepared frame values. It turns `DocumentFrame` and `OverlayFrame` snapshots into pixels on caller-provided canvas contexts.

This is a paint backend, not the editor presentation model. Frame creation translates editor state, layout state, resources, clocks, selection, comments, and animation descriptors into paint-ready rows. Frame painting consumes those rows without reading editor state or re-deriving editor/layout meaning.

## Design Principles

- **Frames are the paint contracts.** `frame/` owns pre-paint derivation and drawable rows: visible ranges, line metadata, text segments, chrome aggregates, selection/comment rects, caret geometry, and active animation maps.
- **Frame construction may translate editor/layout state.** `frame/` is allowed to read editor state, document indexes, and layout snapshots while building paint rows. That translation boundary stops at the frame value; painters must not cross it.
- **Frame geometry is paint-only.** Layout owns durable geometry shared by paint, navigation, hit testing, anchors, and virtualization. Frame owns visible-slice drawable rows derived from that geometry. If a value is per-line, document-stable, and useful outside paint, promote it into layout instead of recomputing it in frame.
- **Layout lines are an explicit dependency.** `DocumentFrameLine.layoutLine` is the durable line geometry carried into paint rows. Prefer adding paint-only fields beside it over copying layout fields into a second line model.
- **Painters draw only.** `painters/` should consume frame data and canvas contexts. Do not add editor-state queries, visible-range scans, selection resolution, inline walking, or block aggregate derivation to painters.
- **The orchestrator owns z-order.** `paintDocumentFrame` runs the content pass table, and the line foreground table owns per-line layering. Individual painters should not reorder neighboring concerns.
- **Canvas effects stay explicit.** Canvas drawing is side-effectful, but pixels should be a deterministic function of the frame, theme/resources carried by the frame, clocks, and the canvas context.
- **Document geometry stays shared.** Frame data and painters use document-space layout coordinates. The only global paint-space bridge is the layer translation applied before painting.
- **Layering is an invalidation contract.** Content and overlay paint separately so caret/presence blinking can avoid repainting document content.
- **Two clocks serve different animation classes.** Finite editor animations resolve from `now`; ambient loops such as decoration pulses, comment presence pulses, and resource shimmer resolve from `ambientAnimationTime`.
- **Frame APIs are the boundary.** Callers should create frames explicitly and pass them to `paintDocumentFrame` or `paintOverlayFrame`; renderer paint entry points should not accept editor state directly.

## Subsystem Map

- `index.ts` is the renderer facade and paint-order orchestrator for `DocumentFrame` and `OverlayFrame`.
- `frame/` owns paint-ready frame construction. `frame/line/` owns per-visible-line drawable rows, and `frame/chrome/` owns document-level chrome aggregates such as rules, table highlights, and list-marker planning.
- `canvas/` owns Canvas 2D layer setup: device-pixel-ratio scaling, clearing, optional background fill, document-space translation, and save/restore.
- `painters/` owns immediate-mode drawing modules for block chrome, table surfaces, line ranges, list markers, inline/replacement text content, text effects, and carets.
- `animations/` owns paint-time animation collection, progress resolution, pulse envelopes, and canvas color blending. Animation lifetime policy lives in editor state.

## Testing

Renderer tests live in `test/renderer/`. Prefer frame-level integration tests that build a `DocumentFrame` or `OverlayFrame`, paint it with a recording canvas context, and assert operation order or geometry. Add focused renderer tests when changing z-order, frame derivation, paint geometry, or animation rendering. Broader browser behavior belongs in the playground/component layer.
