# Canvas

This sub-system owns immediate-mode painting from a prepared `EditorLayoutState` plus editor/runtime inputs (selection, comments, presence, animations, theme). Paint is a pure function of those inputs at a given `now` — no DOM, no React, no per-frame state mutation.

The two public entry points map to the two stacked canvases:

- `paintContent(state, layoutState, ctx, options)` - The content canvas. Backgrounds, text, list markers, selection highlights, comment highlights, animations, heading and blockquote rules.
- `paintOverlay(state, layoutState, ctx, options)` - The overlay canvas. Carets only — selection and comment highlights live on the content canvas so they don't repaint every blink tick.

Both entry points are thin wrappers that destructure the `EditorLayoutState` (`layout`, `regionBounds`, `paintTop`, `blockMap`) and forward into the shared per-frame orchestrator. The painters underneath take granular params (`DocumentLayout`, region bounds, `now`) and don't know `EditorLayoutState` exists.

### Paint pipeline

`paintContent` runs in fixed z-order stages so backgrounds, foregrounds, and rules paint deterministically regardless of what runs inside each line:

1. Clear + base background.
2. Per-visible-line block backgrounds (code fences, table cell chrome).
3. Inert block chrome (divider rules; future image-as-block, embed, display-math).
4. Active table cell highlight band.
5. Per-line foreground sub-pipeline: active-block background → selection → comments → list marker → text runs → deleted-text fades → punctuation pulses.
6. Heading rules + blockquote rules.

Visible-range scoping uses `findVisibleBlockRange` and `findVisibleLineRange` from layout's `query/lookup` so each frame only walks the lines actually on screen. The orchestrator resolves all per-frame constants once (active animations, visible blockquote regions, heading rules), then iterates the visible slice.

`paintOverlay` is a single pass — `paintCanvasCaretOverlay` — that draws the caret and presence cursors. It's the only thing that runs on a caret-blink tick, which is why it's its own entry point.

### Key Areas

- `index.ts` - Owns `paintContent`, `paintOverlay`, and the per-frame orchestrator (`paintCanvasEditorSurface`) that runs the staged pipeline.

- `painters/` - Per-stage pixel-drawing modules. Each owns one visual concern: text runs and inline marks, list markers, selection highlights, table chrome, block backgrounds and rules, image rendering, caret and presence cursors. No painter knows about the schedule order — that's the orchestrator's job.

- `lib/` - Cross-cutting building blocks: animation interpolation and active-animation resolution, the per-editor render cache (measured lines, line boundaries, viewport plans) shared with layout, color blending helpers, and font metric helpers shared with both layout and paint.

### Design notes

- Painters are read-only over their inputs. Any per-frame computation that depends on inputs the painter doesn't already have (e.g. resolving which animations are active for a given block) happens in the orchestrator and is passed down. This keeps painters easy to test and swap.

- The render cache is owned by the host (one per editor instance) and threaded through to paint via `EditorLayoutState`. Cache lifetime matches the editor instance, not the paint frame.

- Paint never reads from React or the DOM. The host translates DOM events and React state into the call args; the canvas subsystem only consumes them.
