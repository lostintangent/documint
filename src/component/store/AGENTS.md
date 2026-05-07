# Component Store

This subsystem owns Documint's internal runtime store. It is a component-layer
orchestration primitive, not part of the public React API and not part of the
framework-agnostic editor engine.

The store has a small public entrypoint and three internal areas:

- `index.ts` creates the full `DocumintStore` and exports the public component
  store surface.
- `react.tsx` owns the React bridge: `useStoreValue` for reactive reads and
  `useEditorCommand` for editor mutations.
- `core/` owns reusable store mechanics: value descriptors and equality
  helpers.
- `editor/` owns the current immutable `EditorState`, applies command results,
  emits transition metadata, and provides fine-grained value/computed
  subscriptions for React consumers through store values.
- `viewport/` owns the lazy, invalidatable `EditorLayoutState` viewport
  projection and publishes completed viewport renders to reactive consumers.

The two coordinated domains are:

- `editor` owns the current immutable `EditorState`, applies command results,
  emits transition metadata, and provides fine-grained value/computed
  subscriptions for React consumers through store values.
- `viewport` owns the lazy, invalidatable viewport projection, exposed as
  `store.viewport.get()` / `peek()` / `invalidate()`, plus the latest published
  viewport snapshot for reactive values.

Keep the boundary strict:

- Editor mutations enter through `EditorStore.apply`, `command`, or `replace`.
- Store transition metadata describes what changed; React hooks should not
  independently rediscover broad transition facts.
- Reactive reads go through store values. Use editor-backed values for source
  facts (`documentIndex`, `selection`, `imageUrls`) and editor computed values
  for derived view-model facts.
- The store may call pure editor APIs, but browser side effects, DOM refs,
  canvas painting, and rAF scheduling stay in `src/component`.
- Hook-local state is for interaction lifetime (drag handles, hover timers,
  caret blink), not durable derived editor facts. Derived editor/viewport facts
  should become named store values.
