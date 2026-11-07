# Renderer

The renderer subsystem is Documint's Canvas 2D paint backend. It turns prepared editor/layout inputs, resources, theme, and caller-provided time into the pixels users see while typing, selecting, scrolling, and editing. Its central model is the paint-ready `DocumentFrame`, with a smaller `OverlayFrame` for carets and presence, so drawing stays deterministic without owning measurement, loading, scheduling, or browser effects.

## Design Notes

- **Frames resolve meaning without copying paint-ready layout.** `createDocumentFrame` and `createOverlayFrame` turn editor-dependent selections, effects, text segments, and carets into inspectable frame atoms. Geometry that layout already prepared for direct painting, such as the metadata grid, passes through unchanged instead of gaining a parallel frame model.
- **Central paint order keeps painters free of z-index policy.** `paintDocumentFrame` owns the content pass table and per-line foreground table. Metadata and container chrome paint before selection, comments, shared checkboxes, text, decoration overlays, and transient effects. Active-block and change tints sit beneath container surfaces, so a code block keeps its dark surface and readable syntax colors.
- **Overscanned viewport frames keep large documents and native scroll smooth.** Layout prepares an overscanned paint window around the browser viewport, and `createDocumentFrame` builds body frame rows only for that window. The overscan gives native browser scroll a buffer to move through while the component catches up with the next render, and viewport-limited body rows keep large-document paint work bounded.
- **Container chrome follows block extents, so tall code blocks and table cells keep their surfaces while scrolling.** Code surfaces and cell chrome, with their tints, resolve from block and cell bounds the way divider rules do, so they paint while any part overlaps the paint window, even when none of their lines do. Only text blocks tint per line, because their lines are their tint bands.
- **Document changes retain their source semantics through frame construction.** Snapshot comparisons enter as document-owned changes, while live changes augment that same semantic shape with only a stable fade identity. Deleted nodes already exist in the comparison document, so added, modified, and deleted content all use the existing background path; only the theme color differs.
- **Layered frames keep hot repaints narrow.** Document content and overlay carets paint through separate `DocumentFrame` and `OverlayFrame` paths, so caret and presence blinking do not repaint settled document content. Viewport-fixed browser chrome stays in `src/component` rather than entering the document-space canvas.
- **Caller-provided time makes animated paint deterministic.** Renderer groups semantic editor effects into paint-ready flashes, pulses, highlights, and fades for the current `now`, lets host `DocumintEffects` compose with or replace defaults, and keeps ambient loops such as resource shimmer and comment or decoration pulses on `ambientTime` so hosts can pause animation by pausing time.
- **Canvas state changes stay local to the paint boundary.** Layer setup handles device-pixel-ratio scaling, clearing, background fill, and document-space translation. Custom effects and painters save/restore context state around local composition so neighboring paint concerns do not leak state.

## Subsystem Map

- `index.ts` owns the renderer facade, content/overlay paint entry points, layer setup, and document z-order orchestration.
- `frame/` owns paint-ready frame construction from editor/layout snapshots, including overscanned viewport rows, block and table chrome, selection/comment ranges, text segments, list markers, and overlay carets.
- `painters/` owns immediate-mode Canvas 2D drawing for metadata, blocks, text, decorations, selections, comments, shared checkboxes, lists, tables, resources, images, mentions, and carets.
- `effects/` owns paint-time effect policy, active-effect grouping, color blending, ambient pulse helpers, and the host `DocumintEffects` handlers it composes with the defaults.
- `theme.ts` owns the host theme contract: the `EditorTheme` hosts pass and the `ResolvedEditorTheme` that paint, CSS variables, and layout metrics read.
