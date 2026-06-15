# Component Store

The component store lets React components read Documint state through sprigs:
read-only reactive slices such as selection, rendered layout, completion
context, and presence projections. A selection sprig can notify selection UI
without rerendering unrelated consumers. `EditorState` stays durable, immutable,
and independent of React while components and hooks subscribe to the exact state
slices and derived values they need.

The store consumes framework-agnostic `EditorState`, the layout cache, and
stable host-provided props. Mutations enter through semantic editor commands or
external replacements; React consumers observe through sprigs. Sprigs are
component-internal reactivity, not embedder API. The store owns the current
editor snapshot, separates live layout from painted layout, and keeps renders
granular without threading editor props through every layer.

## Design Notes

- **Read-only sprigs pair with semantic mutation commands.** Components observe
  focused state slices through sprigs, while edits enter through
  `store.editor.command` for local commands or `store.editor.replace` for
  external snapshots. Both mutation paths publish an `EditorStateTransition`
  that tells subscribers what changed, where it came from, and which semantic
  effects were emitted.
- **Source sprigs turn editor and layout snapshots into exact reactive slices.**
  The raw editor and layout stores expose only snapshots plus subscribe
  callbacks. Source sprigs wrap those callbacks once, so React consumers can
  subscribe to named slices like selection, document index, or rendered layout.
- **Computed sprigs make derived state efficient and quiet.** Derived values
  build from upstream sprigs instead of re-reading mutable containers directly.
  Equality lives at the sprig boundary, so structural sharing can preserve
  references and avoid notifying `useSyncExternalStore` consumers whose selected
  value did not actually change.
- **Parameterized sprigs merge editor state with stable host-provided props.**
  Completion context, image handles, and presence projections depend on both
  store state and host-provided values. Parameterized sprigs keep those
  computations in the reactive graph as long as callers pass stable params.
- **Layout reads split live geometry from painted geometry.** `store.layout.get()`
  returns or computes the latest layout for hit tests and pointer paths,
  `peekLatest()` lets paint reuse a fresh cache when one exists, and
  `peekRendered()` plus `subscribe()` gives React overlays only the layout that
  has actually been committed to the canvas.
- **Imperative reads keep interaction hot paths out of React.** Pointer
  handling, hit testing, and render preparation read live editor/layout state
  directly when they need immediate answers. React subscriptions are reserved
  for UI that benefits from being notified when a semantic slice changes.

## Subsystem Map

- `core/` owns sprig constructors and equality helpers: the reusable reactive
  machinery underneath editor, layout, and presence projections.
- `editor/` owns the editor event source, transition metadata, source sprigs,
  and editor-derived view models.
- `layout/` owns the lazy latest layout cache, the rendered layout frame, and
  the layout source sprig.
- `presence.ts` owns sprigs that join host presence data with editor state and
  rendered layout.
- `react.tsx` owns the React provider, store access hooks, `useSprig`, and
  command dispatch helpers.
- `index.ts` owns store construction plus the public component-store export
  surface for neighboring component code.

## Known Limitations

The following limitations are explicit omissions because at today's scale, they
do not actually matter. They are documented here so future contributors know
what is intentionally simple and when the design should change.

- **Source sprigs do not share one listener per source.** Each source sprig
  consumer attaches its own listener to the underlying store. That keeps
  `createSourceSprig` simple and is cheap at today's consumer count; switch to
  shared fan-out if listener overhead becomes measurable or consumer count grows
  substantially.
- **Parameterized sprigs cache one parameter set.** Every parameterized sprig
  currently has one React consumer, so a single-entry cache avoids unnecessary
  cache machinery. If multiple consumers begin reading the same sprig with
  different params, replace it with a small LRU.
