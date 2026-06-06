# Component

The component subsystem owns the React/browser host for Documint. It sits between the embedding app, the browser, and the framework-agnostic editor engine: props and callbacks come in, browser events and async resources are observed, editor APIs are invoked, and canvas/DOM UI is rendered.

This is the orchestration layer. Editing behavior, geometry, hit testing, and anchor semantics belong in [`src/editor`](../editor/AGENTS.md); paint policy belongs in [`src/renderer`](../renderer/AGENTS.md). Component owns when those capabilities run and how their results are exposed to React, DOM, and embedder code.

![](AGENTS.assets/e0557a80-93df-4f9a-92a5-56b35fe4c9d4-image.png){width=792}

## Design Principles

- **Orchestrate through editor APIs.** Component code should translate browser/app events into named `@/editor` capabilities, not recreate document-index, layout, anchor, or mutation logic locally.
- **The host owns render cadence.** `useRender` chooses the cheapest valid paint mode, `useViewport` owns the cached `EditorLayoutHandle` those paint paths consume, and `Documint` prepares renderer frame values before passing them to canvas paint calls.
- **Derived view models belong in the store.** If code mostly reads store state, derives a view model, compares it, and mirrors it into local state, make it a sprig instead.
- **Browser effects stay at the edge.** DOM refs, observers, timers, pointer capture, IME/composition, clipboard, focus, scroll, resize, async resources, and gesture state belong in hooks.
- **Leaf UI is declarative and arbitrated once.** Hooks emit candidates; `Documint` resolves priority and geometry so insertion menus, links, comments, completions, and table UI share one placement contract.

## Subsystem Map

- `Documint.tsx` and `index.ts` own the public React component, controlled markdown bridge, host lifecycle, canvas layers, DOM entry points, and leaf arbitration.
- [`hooks/`](hooks/AGENTS.md) owns browser lifetimes and interaction translation.
- [`sync/`](sync/AGENTS.md) owns component-local embedder synchronization helpers: external snapshot selection reconciliation and mention-event payloads.
- [`store/`](store/AGENTS.md) owns component-local reactive state, viewport cache publication, and derived view models.
- `overlays/` owns portaled DOM UI around the canvas.
- `completions/`, `decorations/`, and `worker/` own higher-level host features that feed declarative inputs into paint or overlays.
- `lib/` owns stateless host helpers for keybindings, canvas DPI, pointers, mentions, storage, diagnostics, and themes.
