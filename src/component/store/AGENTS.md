# Component Store

The component store keeps selection UI, overlay chrome, completions, presence, and other React surfaces updating only when the editor state they care about changes. It lets Documint keep interactive UI responsive without prop-drilling editor snapshots or making framework-agnostic `EditorState` React-based. Its central model is the sprig: a read-only component-internal slice over editor, layout, or host-provided state.

## Design Notes

- **Read-only sprigs pair with semantic mutation commands.** Components observe focused state slices through sprigs, while edits enter through `store.editor.command` for local commands or `store.editor.replace` for external snapshots. Both mutation paths publish an `EditorStateTransition` that tells subscribers what changed, where it came from, and which semantic effects were emitted.
- **Computed sprigs make derived state efficient and quiet.** Derived values build from upstream sprigs instead of re-reading mutable containers directly. Equality lives at the sprig boundary, so structural sharing can preserve references and avoid notifying `useSyncExternalStore` consumers whose selected value did not actually change. Prefer the narrowest upstream sprig that contains the needed state instead of depending on a broader source snapshot.
- **Parameterized sprigs merge editor state with stable host props.** Completion context, image handles, and presence projections depend on both store state and host-provided values. Parameterized sprigs keep those computations in the reactive graph as long as callers pass stable params. Memoize params or derive them from stable values before subscribing.
- **Layout reads split live geometry from painted geometry.** `store.layout.get()` returns or computes the latest layout for hit tests and pointer paths, `peekLatest()` lets paint reuse a fresh cache when one exists, and `peekRendered()` plus `subscribe()` gives React overlays only the layout that has actually been committed to the canvas. `commit()` is the only bridge from latest layout to rendered layout.
- **Imperative reads keep interaction hot paths out of React.** Pointer handling, hit testing, and render preparation read live editor/layout state directly when they need immediate answers. React subscriptions are reserved for UI that benefits from being notified when a semantic slice changes.

## Subsystem Map

- `core/` owns sprig constructors and equality helpers: the reusable reactive machinery underneath editor, layout, and presence projections.
- `editor/` owns the editor event source, transition metadata, source sprigs, and editor-derived view models.
- `layout/` owns the lazy latest layout cache, the rendered layout frame, and the layout source sprig.
- `presence.ts` owns sprigs that join host presence data with editor state and rendered layout.
- `react.tsx` owns the React provider, store access hooks, `useSprig`, and command dispatch helpers.
- `index.ts` owns store construction plus the public component-store export surface for neighboring component code.

## Known Limitations

- **Sprig subscriptions do not share fan-out across consumers.** Each consumer subscribes through its own source, computed, or parameterized sprig path. That keeps the graph simple and is cheap at today's consumer count. Add shared fan-out only if profiling shows subscription overhead on selection, pointer, or overlay update paths.
- **Parameterized sprigs cache one parameter set.** Every parameterized sprig currently has one React consumer, so a single-entry cache avoids unnecessary cache machinery. If multiple consumers begin reading the same sprig with different params, replace it with a small LRU.
