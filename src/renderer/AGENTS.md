# Renderer

The renderer subsystem is Documint's Canvas 2D paint backend. It turns prepared editor/layout inputs, resources, theme, and caller-provided time into the pixels users see while typing, selecting, scrolling, and editing. Its central model is the paint-ready `DocumentFrame`: a viewport-scoped snapshot that makes drawing deterministic without owning measurement, loading, scheduling, or browser effects.

## Design Notes

- **Frames turn editor meaning into paint contracts so painters only draw.** `createDocumentFrame` and `createOverlayFrame` resolve editor/layout state into inspectable frame atoms and reusable geometry such as layout lines, text segments, selections, effects, and list marker rects. Painters consume those atoms without editor lookups or semantic scans, keeping only local Canvas details such as stroke widths, radii, and control points.
- **Central paint order keeps painters free of z-index policy.** `paintDocumentFrame` owns the content pass table and per-line foreground table, so painters draw one concern at a time while backgrounds, selection, comments, list markers, text, decoration overlays, and transient effects keep a deterministic z-order.
- **Overscanned viewport frames keep large documents and native scroll smooth.** Layout prepares an overscanned paint window around the browser viewport, and `createDocumentFrame` builds frame rows only for that window. The overscan gives native browser scroll a buffer to move through while the component catches up with the next render, and viewport-limited rows keep large-document paint work bounded.
- **Layered frames keep hot repaints narrow.** Document content and overlay carets paint through separate `DocumentFrame` and `OverlayFrame` paths, letting caret and presence blinking repaint the overlay without repainting settled document content.
- **Caller-provided time makes animated paint deterministic.** Renderer groups semantic editor effects into paint-ready flashes, pulses, highlights, and fades for the current `now`, lets host `DocumintEffects` compose with or replace defaults, and keeps ambient loops such as resource shimmer and comment or decoration pulses on `ambientTime` so hosts can pause animation by pausing time.
- **Canvas state changes stay local to the paint boundary.** Layer setup handles device-pixel-ratio scaling, clearing, background fill, and document-space translation. Custom effects and painters save/restore context state around local composition so neighboring paint concerns do not leak state.

## Subsystem Map

- `index.ts` owns the renderer facade, content/overlay paint entry points, layer setup, and document z-order orchestration.
- `frame/` owns paint-ready frame construction from editor/layout snapshots, including overscanned viewport rows, chrome aggregates, selection/comment ranges, text segments, list marker plans, and overlay carets.
- `painters/` owns immediate-mode Canvas 2D drawing for blocks, text, decorations, selections, comments, lists, tables, resources, images, mentions, and carets.
- `effects/` owns paint-time effect policy, active-effect grouping, color blending, ambient pulse helpers, and custom effect composition.
