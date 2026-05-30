# Renderer

The renderer subsystem owns immediate-mode Canvas 2D painting from prepared editor inputs. The host mounts two canvases: a content layer for document pixels that change with edits, selection ranges, comments, decorations, and block chrome; and an overlay layer for carets/presence cursors that can repaint cheaply on blink or presence updates.

Renderer consumes `EditorState`, `EditorLayoutState`, selection/comment/presence projections, resources, theme, and caller-provided time. It owns paint policy and z-order, but not scheduling, canvas sizing, DOM transforms, layout construction, image loading, resource resolution, or editor mutations.

The content layer consumes an already-prepared viewport layout slice. Layout geometry is always in full document-space coordinates, even when virtualized. The component positions the canvas element at `viewport.paintTop`; the renderer scales for device pixel ratio, translates the canvas context by `-viewport.paintTop`, and painters draw using document-space `line.top`, `regionBounds`, and block extents. Avoid viewport-local coordinate conversion inside painters unless the value is truly local to a glyph, pill, icon, or clipped overlay.

Rendering is bounded by the overscanned paint window. The content orchestrator derives visible line and block ranges from `EditorLayoutState.paintTop` plus the prepared canvas height, then iterates only those ranges. Overscan lets the browser reveal already-painted pixels during native scrolling between frames; each content frame catches up by repainting the current visible/overscanned slice, never the full document.

## Design Principles

- **Pixels are a function of inputs.** Canvas drawing is side-effectful, but the renderer should depend only on the state, layout, projections, resources, theme, and clocks it is passed.
- **The orchestrator owns z-order.** `index.ts` decides stage order, visible-range iteration, and shared per-frame derivations. Painters draw one visual concern and should not reorder neighboring concerns locally.
- **Visible ranges are the performance boundary.** Per-line stages iterate visible/overscanned `layout.lines`; block chrome uses the visible block range when line traversal is not the right primitive.
- **Layering is an invalidation contract.** Content and overlay are separate so caret/presence blink work can repaint without touching text, selection, comments, or block chrome.
- **Document geometry stays shared.** Layout, hit testing, selection, comments, caret math, and paint speak document space. The only global paint-space bridge is the canvas context translation.
- **Two clocks serve different animation classes.** Finite editor animations resolve from `now`; ambient loops such as decoration pulses, comment presence pulses, and image shimmer resolve from `ambientAnimationTime`.
- **Block snapshots and runtime metadata are distinct.** Document `Block` snapshots drive semantic chrome decisions; `documentIndex.blockIndex` drives runtime path/depth/ancestor metadata.

## Paint Order

`paintContent` runs these stages:

1. Clear the canvas, fill the editor background, scale for device pixel ratio, and translate from document space into the paint slice.
2. Compute visible/overscanned line and block ranges plus shared frame inputs: active animation maps, selection region order, visible list markers, heading rules, and blockquote regions.
3. Paint per-visible-line container backgrounds: code block fills and table cell backgrounds/borders. These are line-triggered but paint once per container where needed.
4. Paint visible inert block chrome, such as divider rules, from the visible block range.
5. Paint active block/cell highlights above durable backgrounds and below foreground text. Tables use active-cell geometry rather than generic active-line fill.
6. Paint per-visible-line foreground: active-line background, text-decoration backgrounds, selection, comments, list/task markers, inline content, text-decoration overlays, and transient text animations.
7. Paint heading and blockquote rules last so they sit cleanly above nearby foreground/chrome.

`paintOverlay` is intentionally small: it clears the overlay canvas, applies the same document-space translation, then paints the local caret and resolved presence carets only.

## Subsystem Map

- `index.ts` owns the public `paintContent`/`paintOverlay` entry points, content stage order, per-frame derivations, and the per-line foreground sub-pipeline.
- `painters/` owns per-concern drawing modules: block chrome, table cell surfaces, line-clipped ranges, list/task markers, inline text and replacement objects, text effects, shared glyph primitives, and overlay carets.
- `animations/` owns paint-time animation collection, progress resolution, pulse math, and canvas color blending. Animation lifetime policy lives in editor state.
