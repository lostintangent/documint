# Component Store

The component store subsystem owns Documint's internal runtime store: the reactive bridge between the framework-agnostic editor engine and the React host. It is internal to `src/component`, not part of the public React API and not part of `src/editor`.

The store owns the current immutable `EditorState`, caches the lazy viewport projection (`EditorLayoutState`), publishes completed viewport frames, and exposes derived values as sprigs for React consumers.

## Design Principles

- **Editor mutations have one entry point.** State changes enter through `store.editor.command` or `store.editor.replace`; everything else observes.
- **Sprigs are semantic propagation control.** Reactive reads go through named sprigs, and equality belongs in the sprig layer so unchanged derived values preserve references and avoid unnecessary React work.
- **Viewport cache and published viewport are different.** Scroll invalidates the cached viewport immediately, but reactive consumers see the published viewport only after a painted frame.
- **Imperative reads are escape hatches.** Hot pointer paths and viewport hit testing may use `store.editor.getState()` or `store.viewport.get()`, but reactive UI should prefer sprigs.
- **Browser effects stay outside the store.** DOM, canvas painting, rAF scheduling, async loads, timers, and `now()` belong in component hooks.

## Subsystem Map

- `index.ts` exposes create-store APIs, sprig exports, and shared store types.
- `react.tsx` owns provider, store access, `useSprig`, and command dispatch helpers.
- `core/` owns source/computed/parameterized/record sprig constructors and equality helpers.
- `editor/` owns editor event source, transitions, source sprigs, and editor-derived view models.
- `viewport/` owns the lazy viewport cache, published viewport frame, and viewport source sprig.
- `presence.ts` owns sprigs that join editor state with the published viewport.

## Sprigs

A sprig is a `{ read, subscribe }` pair for a reactive value. Sprigs are the only reactive read primitive; hooks subscribe through `useSprig`, and equality/deduplication lives in the sprig layer rather than in hooks.

Use `createEditorStateSprig` for source reads from `EditorState`, `createComputedSprig` for derived values, `createParameterizedSprig` when stable host parameters are part of the key, and `createRecordSprig` to bundle several sprigs into one record. Parameterized sprigs have a single-entry cache per store, so callers must pass reference-stable params and avoid multiple competing parameter sets for the same sprig.

## Known Limits

- Source sprig listeners are currently per consumer; sharing the listener fan-out can be fixed inside `createEditorStateSprig` without public API changes.
- Parameterized sprigs use a single-entry cache per store; multiple consumers with different params can thrash, though current usage has one consumer per parameterized sprig.
