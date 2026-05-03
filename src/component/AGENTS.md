# Component

This sub-system owns the React host for the editor. It sits at the boundary between the embedding application, the browser, and the framework-agnostic editor engine — translating each into a form the others can consume. All editing behavior, layout, hit-testing, and paint live in [`src/editor`](../editor/AGENTS.md); component owns everything around it.

The boundary has three faces:

1. **Embedder integration** — the React API surface (props, callbacks, controlled markdown bridging), embedder customization (theme overrides, custom keybindings, presence wiring, mention configuration), and the SSR fallback rendered before the canvas mounts.
2. **Browser integration** — DOM event wiring (keyboard, pointer, IME, clipboard, focus, scroll, resize), system theme detection, canvas mounting and DPI scaling, scroll-container observation, hover debouncing, async image loading, and the contextual leaf overlays portaled into the host's DOM.
3. **Render loop** — deciding when the editor's immutable state should become canvas pixels, and which paint mode (full render vs cached paint vs overlay-only) matches the change.

### Render loop

Paint runs inside a coalesced `requestAnimationFrame` scheduler ([`hooks/useRenderScheduler.ts`](hooks/useRenderScheduler.ts)). The scheduler is the single owner of when canvas pixels change. Frames fire only in response to:

1. **User interactions** — typing, selection, drag, scroll, resize, theme change, hover. The host translates these into `EditorState` and `EditorLayoutState` updates, then schedules the paint mode that matches what changed.
2. **In-flight animations** — after any layout-aware or content frame, the scheduler checks `hasRunningAnimations(editorState, now)` against the live `editorStateRef` and self-schedules another content paint if true. The loop ticks frame-by-frame without external pumping until animations expire.
3. **Caret blink** — `useCursor` runs a 530ms interval that toggles caret visibility and calls `scheduleOverlayPaint`. The cheapest path: no layout, no content paint, just the overlay layer.

The scheduler exposes four intents whose names encode cost (`Render` recomputes layout, `Paint` reuses the cached layout) and scope (`Full` / `Content` / `Overlay`):

| Intent | Layout | Paint | Wired from |
| --- | --- | --- | --- |
| `scheduleFullRender` | recomputes | content + overlay | document edits, scroll, surface resize, theme/dimension change |
| `scheduleFullPaint` | reused | content + overlay | selection moves |
| `scheduleContentPaint` | reused | content only | comment highlight changes, animation continuation |
| `scheduleOverlayPaint` | reused | overlay only | caret blink, presence updates |

Multiple schedule calls within a tick produce one rAF. Heavier modes subsume lighter ones (`FullRender` > `FullPaint` > `ContentPaint`). Independent layer paints (`ContentPaint` + `OverlayPaint`) can both fire in the same frame. On the server, paint callbacks are dispatched synchronously.

State tracking that drives the loop:

- **`editorStateRef`** — live ref to the current `EditorState`. The scheduler reads it on each frame to decide whether to continue for animations.
- **`preparedViewport`** — `LazyRefHandle<EditorLayoutState>` owned by `useViewport`. Heavy paths force a fresh layout via `prepareNextPaint()`; cheap paths read the cached value via `peek()`. See [`src/editor/layout`](../editor/layout/AGENTS.md) for what the cache holds and what invalidates it.

### Key Areas

- **Core** (`Documint.tsx`, `Ssr.tsx`, `index.ts`) - Owns the public `Documint` component, host lifecycle, DOM event wiring, controlled-content bridging, canvas layer management, and the SSR fallback rendered before the canvas mounts.

- **Hooks** (`hooks/`) - Each hook owns one orchestration concern: editor lifetime, viewport state cache, render-frame coalescing, text/keyboard/clipboard input bridging, selection handle management, cursor blink and leaf resolution, hover target debouncing, async image loading, presence cursor projection, and pointer coordinate translation.

- **Overlays / Leaves** (`overlays/`) - Owns the contextual leaf UI rendered via portals: comment creation and thread interaction, block insertion menus, table editing menus, link preview and editing, and the shared compound toolbar.

- **Utilities** (`lib/`) - Owns stateless host helpers: keybinding resolution, selection math and clipboard extraction, canvas DPI scaling, pointer coordinate conversion, and built-in theme definitions.
