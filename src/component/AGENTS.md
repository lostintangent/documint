# Component

The component subsystem provides Documint's public React editor surface. The embeddable `Documint` component turns markdown, host configuration, browser input, and runtime resources into an interactive canvas editor. It lets host applications integrate editing, theming, resources, callbacks, and contextual UI while keeping React lifetimes at the browser edge.

## Design Notes

- **Browser lifetimes stay at the host edge.** DOM refs, observers, timers, pointer capture, IME/composition, clipboard, focus, scroll, resize, async resources, theming, and gesture state belong in component hooks and helpers so editor and renderer code stay deterministic over their inputs.
- **Host events become named engine requests.** Browser and embedder events should become editor commands, store reads, sync updates, or render requests. Do not recreate document-index, layout, anchor, hit-testing, mutation, or paint semantics in component code when lower layers own that behavior.
- **Platform gestures become semantic editor policy at the input edge.** Component keybindings map the host platform to shortcut families and translate word-forward gestures into semantic editor movement before calling the editor. Lower layers receive commands and word movement, never browser platform names.
- **Editor transitions fan out from the component store once.** External markdown and local browser input both become store transitions. Sync emits local transitions back to host markdown, while component-store sprigs (read-only reactive slices), decorations, overlays, and render scheduling observe the same state change instead of inventing parallel coordination paths.
- **One render scheduler owns paint cadence.** `useRender` coalesces paint requests, `useViewport` owns the lazy layout handle, and `Documint` prepares frame inputs before passing them to renderer paint calls. Child hooks request work instead of inventing render loops. Editor effects stay semantic. Component attaches runtime starts and tracks active effect lifetimes before renderer paint resolves the current frame.
- **Durable React projections flow through the component store.** Component code that needs shared editor/layout projections should use sprigs defined in [`store/`](store/AGENTS.md). Feature-local leaf view models can stay with the feature that renders them, so the core store does not learn overlay-specific vocabulary. Hooks own browser lifetimes. The store owns durable reactive projections.
- **Leaf UI is declarative and arbitrated once.** Hooks and feature subsystems emit candidates for insertion menus, links, comments, completions, table UI, and selection affordances. `Documint` resolves priority and geometry so DOM overlays share one placement contract around the canvas.

## Subsystem Map

- `Documint.tsx` owns the public React component, prop/callback boundary, canvas layers, DOM entry points, frame construction inputs, and leaf arbitration.
- `index.ts` owns the public component export surface.
- `styles.css` owns the editor-host CSS injected by `Documint`.
- [`hooks/`](hooks/AGENTS.md) owns browser lifetimes and interaction translation.
- [`store/`](store/AGENTS.md) owns component-internal reactive state, sprigs, layout publication, and derived view models.
- [`sync/`](sync/AGENTS.md) owns embedder synchronization helpers: local markdown snapshot emission, external snapshot reconciliation, and mention-event payloads.
- [`decorations/`](decorations/AGENTS.md) owns host-driven prose decorations, code grammar classification, worker communication, and the cached `TextDecoration` index passed toward rendering.
- [`completions/`](completions/AGENTS.md) owns completion source construction and document-aware completion hooks.
- [`overlays/`](overlays/AGENTS.md) owns portaled DOM UI, anchors, leaves, placement, and overlay styling around the canvas.
- `lib/` owns stateless browser-facing helpers shared by component hooks and entrypoints.
