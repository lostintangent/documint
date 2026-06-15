# Component

The component subsystem is Documint's React and browser host. It exists to
manage the browser environment, expose the embedder interface, and orchestrate
the framework-agnostic editor and renderer without making either layer know
about React lifetimes.

Component consumes markdown, host configuration, browser APIs, editor commands,
layout handles, renderer frame builders, and runtime resources. It exposes the
public `Documint` React component, host callbacks, DOM overlays, and canvas
layers. Editing semantics, document indexing, geometry, hit testing, and anchor
truth belong in [`src/editor`](../editor/AGENTS.md); paint policy belongs in
[`src/renderer`](../renderer/AGENTS.md).

## Design Notes

- **Browser environment management stays at the host edge.** DOM refs,
  observers, timers, pointer capture, IME/composition, clipboard, focus, scroll,
  resize, async resources, theming, and gesture state belong in component hooks
  and helpers so editor and renderer code stay deterministic over their inputs.
- **Editor and renderer orchestration happens through named capabilities.**
  Browser and embedder events should become editor commands, store reads, sync
  updates, or render requests. Do not recreate document-index, layout, anchor,
  hit-testing, mutation, or paint semantics in component code when lower layers
  own that behavior.
- **Render cadence is centralized at the host edge.** `useRender` coalesces
  paint requests, `useViewport` owns the lazy layout handle, and `Documint`
  prepares frame inputs before passing them to renderer paint calls. Child
  hooks request work; they do not each invent their own render loop.
- **Durable React state flows through the component store.** Component code that
  mostly reads editor/layout state, derives a view model, compares it, and
  mirrors it locally should become a store sprig. Hooks own browser lifetimes;
  the store owns durable reactive projections.
- **Semantic effects gain runtime lifetime in component.** The editor emits
  semantic effects, `Documint` attaches runtime starts, `useRender` retains
  timed effects between frames, and renderer frame construction returns the
  effects that remain active.
- **Leaf UI is declarative and arbitrated once.** Hooks and feature subsystems
  emit candidates for insertion menus, links, comments, completions, table UI,
  and selection affordances. `Documint` resolves priority and geometry so DOM
  overlays share one placement contract around the canvas.

## Subsystem Map

- `Documint.tsx` owns the public React component, prop/callback boundary,
  canvas layers, DOM entry points, frame construction inputs, and leaf
  arbitration.
- `index.ts` owns the public component export surface.
- [`hooks/`](hooks/AGENTS.md) owns browser lifetimes and interaction
  translation.
- [`store/`](store/AGENTS.md) owns component-internal reactive state, sprigs,
  layout publication, and derived view models.
- [`sync/`](sync/AGENTS.md) owns embedder synchronization helpers: local
  markdown snapshot emission, external snapshot reconciliation, and
  mention-event payloads.
- [`decorations/`](decorations/AGENTS.md) owns host-driven prose decorations,
  code grammar classification, worker communication, and the cached
  `TextDecoration` index passed toward rendering.
- `completions/` owns completion source construction and document-aware
  completion hooks.
- `overlays/` owns portaled DOM UI, anchors, leaves, placement, and overlay
  styling around the canvas.
- `lib/` owns stateless browser-facing helpers shared by component hooks and
  entrypoints.
