# Canvas

The canvas subsystem owns immediate-mode painting from prepared editor inputs. It consumes `EditorState`, `EditorLayoutState`, selection/comment/presence projections, resources, theme, and time, then issues canvas 2D drawing calls.

Canvas owns paint policy and z-order. It does not own scheduling, DOM/React state, layout construction, image loading, or editor mutations.

## Design Principles

- **Pixels are a function of inputs.** Canvas is side-effectful because it draws, but it should not depend on hidden state. Given the same state, layout, theme, resources, projections, and time, it should produce the same pixels.
- **Two clocks serve different animation classes.** Finite/interactive animations resolve from `now`; ambient looping effects resolve from `ambientAnimationTime`. The shared ambient clock keeps independent effects in phase and lets the host freeze/resume them around activity without phase jumps.
- **Layering is a performance contract.** Content and overlay are separate so caret/presence blink work can repaint without touching text, selection, comments, or block chrome. Future visual layers should preserve that same independent invalidation idea.
- **The orchestrator owns visual order.** Painters draw one concern; the private content orchestrator behind `paintContent` decides z-order, visible-range iteration, and shared per-frame derivations.
- **Block snapshots and runtime metadata are different inputs.** Document `Block` snapshots drive semantic chrome decisions; `documentIndex.blockIndex` drives runtime path/depth/ancestor metadata.

## Subsystem Map

- `index.ts` owns the two public entry points (`paintContent`, `paintOverlay`) and the private content-layer orchestrator they call into.
- `painters/` owns per-concern drawing modules; `painters/text/` splits text runs, glyph primitives, decorations, and effects.
- `lib/` owns paint-time helpers for animation math, ambient effects, colors, and blending.

## Paint Order

`paintContent` runs in fixed stages: clear/background, per-line block backgrounds, inert block chrome, active table-cell highlight, per-line foreground, then heading and blockquote rules. The per-line foreground paints active-block background, text-decoration backgrounds, selection, comments, list/task markers, inline content, text-decoration overlays, and animation effects.

`paintOverlay` is intentionally small: caret and presence cursor drawing only.
