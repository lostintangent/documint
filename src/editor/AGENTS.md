# Editor

The editor subsystem owns Documint's framework-agnostic editing engine. It projects semantic `Document` snapshots into runtime `EditorState`, mutates that state through commands and selection changes, prepares `EditorLayoutState` geometry, and answers navigation/hit-test/anchor queries.

This is the capability layer. It owns editing semantics and geometry algorithms. `src/renderer` owns paint policy, and `src/component` owns when those capabilities run and how browser/React lifetimes are wired around them.

## Design Principles

- **Editor is not the host.** React lifecycle, DOM event wiring, canvas mounting, image loading, and scheduling belong in `src/component`; expose named editor APIs when host code needs engine behavior.
- **State changes are immutable.** Commands and navigation return new `EditorState` values or the original state for no-op transitions. Selection-only changes preserve `documentIndex`.
- **Layout is explicit and cache-aware.** Layout receives state, options, resources, viewport, and a host-owned cache. The returned `EditorLayoutState` is the immutable geometry snapshot renderer and queries consume.
- **Layout owns shared geometry.** Geometry needed by paint plus navigation, hit testing, anchors, or virtualization belongs in layout. Paint-only visible-slice drawables belong in renderer frames; per-line, document-stable values that multiple consumers need should be promoted into `LayoutLine`.
- **Public APIs should raise altitude.** Prefer adding one semantic editor capability over making component code pass hidden dependency bundles through raw subsystem internals.
- **Shared policy has one owner.** Text movement, anchor projection, geometry, and paint policy should live in the subsystem that can make all consumers agree.

## Subsystem Map

- `index.ts` is the public editor surface and cross-subsystem adapter layer.
- [`state/`](state/AGENTS.md) owns `Document → EditorState`, indexes, commands, selection, history, fragments, and semantic effect emission.
- [`navigation/`](navigation/AGENTS.md) owns caret motion, range extension, document flow, point-to-selection hit testing, layout-aware movement, and plain-text document search.
- [`layout/`](layout/AGENTS.md) owns `EditorState → EditorLayoutState`, measurement, virtualization, core geometry hit testing, and layout queries.
- [`anchors/`](anchors/AGENTS.md) owns editor-side projection and repair of document anchors.
- [`text/`](text/AGENTS.md) owns shared text semantics needed by multiple editor subsystems.
- `resources/` owns editor-facing resource registry resolution, discovered-resource references, resource viewport queries, and resource icon cache signatures.
