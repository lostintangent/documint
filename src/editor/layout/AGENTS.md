# Layout

This sub-system owns editor geometry. It turns `DocumentIndex` into pixel-positioned line, region, and block geometry for what's on screen, while using cheap whole-document estimation for scrolling and viewport planning.

The core invariant is that visible content always uses exact layout — estimation exists to avoid full-document layout cost, not to weaken on-screen correctness. The estimate path and the exact path walk blocks the same way and apply the same gap policy; they must stay in sync. Measurement results are cached at multiple layers with cache keys that include text hashes, image resource signatures, and layout options, so any change to measurement inputs must also update the relevant cache key.

The pipeline is: `DocumentIndex` → `plan/` decides what to build → `measure/` builds it → `query/` answers questions about the result.

The three main types layer in the same direction. `measure/` produces `DocumentLayout` — bare positioned geometry. `plan/` wraps it as `ViewportLayout` — geometry plus viewport-aware metadata (total height, off-screen region estimation). `index.ts` packages that as `EditorLayoutState` — the type the editor consumes, carrying paint-ready metadata on top.

### Caching

Layout is the most expensive thing the editor does per keystroke, so the work is heavily cached in a per-editor `CanvasRenderCache` (defined in `canvas/lib/cache.ts`). The cache holds prepared text segments, measured lines, line boundaries, container heights, and viewport plans — keyed so that unchanged regions skip rehashing on edits. Region identity is reference-stable through the `{...region, start, end}` shifts the indexer makes, which is what keeps cache hit rates high during typing. Any change to measurement inputs must update the relevant cache key, or stale geometry will leak across frames.

Above the cache, the `EditorLayoutState` itself is reused across cheap paint frames. The layout pipeline runs only when invalidated — document edits, scroll, or surface resize. Selection moves, animation ticks, and caret blinks skip it entirely. See [`src/component`](../../component/AGENTS.md) for the scheduler.

### Key Areas

- `index.ts` - Owns the public layout API and `prepareLayout`, the top-level orchestrator that packages a planner result into the `EditorLayoutState` the rest of the editor consumes.

- `lib/` - Owns cross-cutting building blocks: layout options and defaults, the spacing/gap policy that both build paths share, and the small set of rect/extent types every folder reuses. No subsystem logic — just shapes and constants.

- `measure/` - Owns the exact-layout pass: given a `DocumentIndex` slice, walks blocks in document order and produces a positioned `DocumentLayout` with line, region, and block geometry. Per-block-type measurement primitives (text typography and wrapping, image sizing, table cell measurement) sit alongside the composer that orchestrates them.

- `plan/` - Owns viewport-aware orchestration: cheap whole-document height estimation, visible slice selection with overscan and pinned regions, exact composition for that slice, and coordinate shifting into document space. This is the planner the editor drives each frame.

- `query/` - Owns read operations against a prepared `DocumentLayout`: pointer hit-testing, caret target measurement, visible-range lookups, link/hover/checkbox targeting, and the visual geometry helpers shared with paint and navigation.
