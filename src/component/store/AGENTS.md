# Component Store

The component store subsystem owns Documint's internal runtime store: the reactive bridge between the framework-agnostic editor engine and the React host. It is internal to `src/component`, not part of the public React API and not part of `src/editor`.

The store owns the current immutable `EditorState`, caches the lazy `EditorLayoutState` projection, commits painted layout frames as the rendered layout, and exposes derived values as sprigs for React consumers.

## Design Principles

- **Editor mutations have one entry point.** State changes enter through `store.editor.command` or `store.editor.replace`; everything else observes.
- **Source sprigs are the translation layer.** All store-subscribe wiring lives inside source sprigs — they translate raw store events into "the selected value changed (or didn't)" notifications. Computed sprigs are pure functions of other sprigs and build safely on top without ever touching the underlying state containers.
- **Sprigs are semantic propagation control.** Reactive reads go through named sprigs, and equality belongs in the sprig layer so unchanged derived values preserve references and avoid unnecessary React work.
- **Latest layout and rendered layout are different.** Scroll invalidates the latest layout immediately, but reactive consumers see the rendered layout only after a committed paint frame. `commit()` is the moment latest becomes rendered.
- **Imperative reads are escape hatches.** Hot pointer paths and hit testing may use `store.editor.getState()` or `store.layout.get()`, but reactive UI should prefer sprigs.
- **Browser effects stay outside the store.** DOM, canvas painting, rAF scheduling, async loads, timers, and `now()` belong in component hooks.

## Subsystem Map

- `index.ts` exposes create-store APIs, sprig exports, and shared store types.
- `react.tsx` owns provider, store access, `useSprig`, and command dispatch helpers.
- `core/` owns the source/computed/parameterized/record sprig constructors and equality helpers.
- `editor/` owns the editor event source, transitions, source sprigs, and editor-derived view models.
- `layout/` owns the lazy latest layout, the rendered layout frame, and the layout source sprig.
- `presence.ts` owns sprigs that join editor state with the rendered layout.

## Sprigs

A sprig is a `{ read, subscribe }` pair for a reactive value. Sprigs are the only reactive read primitive; hooks subscribe through `useSprig`, and equality/deduplication lives in the sprig layer rather than in hooks.

Use `createSourceSprig` against a `SprigSource` descriptor to expose an external store (today: the editor and layout stores) as a sprig, `createComputedSprig` for derived values, `createParameterizedSprig` when stable host parameters are part of the key, and `createRecordSprig` to bundle several sprigs into one record. Parameterized sprigs have a single-entry cache per store, so callers must pass reference-stable params.

---

> **Known performance limits.** Two deliberate compromises sit below today's noise floor; the thresholds below say when to revisit.
>
> _Per-consumer source listener fan-out_ — each source sprig consumer attaches its own listener to the underlying store, so today's ~19 `useSprig` sites install ~43 editor listeners and ~8 layout listeners. Overhead is ~300 ns per transition. Revisit if measured cost crosses ~30 µs/sec or consumer count crosses ~150 (~5× today). Fix: shared fan-out inside `createSourceSprig`; no public API change.
>
> _Single-entry parameterized cache_ — `createParameterizedSprig` keeps one `{depValues, params, value}` per store. Every parameterized sprig today has exactly one React consumer (audited 2025), so the invariant holds. A second consumer with different params (likely from list-rendering: per-thread overlays, per-block decorations) would ping-pong the cache. Fix: linear-scan LRU (~30 lines); no public API change.
