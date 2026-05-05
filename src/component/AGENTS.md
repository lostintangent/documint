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
- **`preparedViewport`** — `LazyRefHandle<EditorLayoutState>` owned by `useViewport`. The render-viewport path reads via `get()` (recomputes if invalidated, returns cached otherwise); cheap paint paths read via `peek()`. The cache is invalidated by `observeScrollContainer`, `reconcileEditorState`, and the host's layout-affecting effect (`invalidatePreparedLayout`). See [`src/editor/layout`](../editor/layout/AGENTS.md) for what the cache holds.

### Scroll-driven UI

Every scroll in the editor — native (user scroll) or programmatic (e.g. `usePresence.scrollToPresence`) — funnels through one host worker, `Documint.handleViewportScroll`. It does two things:

1. `useViewport.observeScrollContainer` — sync scroll state (`viewportTop`, content height) and invalidate the layout cache.
2. `scheduleFullRender` — queue the next `renderViewport` rAF pass.

That's the full scroll API: one entry point, two effects.

Three independent UI surfaces derive their visibility from this signal, each with a clear owner:

| Decision | Owner | Where the gate lives |
| --- | --- | --- |
| Show leaf overlay (insertion menu, link preview, comment, etc.) | `Documint` | `isLeafAnchorVisible` in `resolveVisibleLeafPresentation`. Derived during React render from `viewportTop` / `viewportHeight`; rides the existing render with no extra setState. |
| Suspend caret blink | `useCursor` | `caretInViewport`, refreshed by `refreshCaretViewportStatus` in `renderViewport`. The blink `useEffect` reads it. |
| Show off-viewport up/down arrow for remote cursors | `usePresence` (data) + `PresenceOverlay` (DOM) | `presence[i].viewport.status`, refreshed by `refreshPresence` in `renderViewport`. |

The two rAF refreshers (`refreshPresence` and `refreshCaretViewportStatus`) sit next to each other in `renderViewport` and share a single geometric primitive — `resolveCursorViewportStatus` from [`src/editor/anchors`](../editor/anchors/AGENTS.md), returning `"above" | "below" | "visible" | "unresolved"`. Both setState only when a visibility flag actually flips, so steady-state scrolling produces zero React work for either.

### Leaf overlay coordination

Contextual leaf UI (insertion menu, table menu, link preview, comment thread, comment-create toolbar) is orchestrated by `Documint.resolveVisibleLeafPresentation`. Three hooks emit declarative leaf candidates; the host arbitrates priority (`pointer > selection > cursor`), materializes the geometry, and renders through the portaled `LeafAnchor` primitive ([`overlays/leaves/core/LeafAnchor.tsx`](overlays/leaves/core/LeafAnchor.tsx)).

**Sources:**

- `usePointer.leaf` — hover target (link preview, comment thread under pointer).
- `useSelection.leaf` — selection-mode leaves (comment-create over a range, expanded thread).
- `useCursor.leaf` — caret-anchored (insertion menu on empty paragraph, table menu inside a table, contextual link/comment under the caret).

Each candidate extends a `LeafBase` shape — a document anchor point plus optional `leftOverride` (table → cell text-left; selection-annotation → range-start) and `paddingY` (selection-annotation uses 2 to clear the highlight). Documint resolves the candidate against the prepared layout into a `LeafResolution` with document-absolute coordinates:

```
top  = scrollContainerBounds.top  + window.scrollY + anchorBottom        - viewportTop
left = scrollContainerBounds.left + window.scrollX + (leftOverride ?? anchorLeft)
```

`LeafAnchor` is `position: absolute` against the initial containing block, so host-page scrolls are free — the browser moves the leaf with the document, including iOS's auto-scroll above the virtual keyboard. Editor-internal scrolls route through React (`observeScrollContainer` → re-render with new `viewportTop`).

**Visibility gate** (`isLeafAnchorVisible`): the leaf hides when its anchor falls outside `[viewportTop, viewportBottom]` — same scroll visibility the canvas painter enforces for the caret. Implemented once at the orchestration point so all three sources gate uniformly; skipping the host-rect read on hidden frames also avoids a layout-flushing `getBoundingClientRect` on common selection/edit/blink paths.

**Above/below placement** lives in `LeafAnchor` itself — a `useLayoutEffect` measures the shell and flips it above the anchor when below would overflow the visible viewport, using `anchorHeight` from the resolution to clear the anchor row.

### Key Areas

- **Core** (`Documint.tsx`, `Ssr.tsx`, `index.ts`) - Owns the public `Documint` component, host lifecycle, DOM event wiring, controlled-content bridging, canvas layer management, and the SSR fallback rendered before the canvas mounts.

- **Hooks** ([`hooks/`](hooks/AGENTS.md)) - Each hook owns one orchestration concern between the host component and the editor engine: viewport state, render scheduling, user-interaction translation, and specialized concerns like presence and images. See [`hooks/AGENTS.md`](hooks/AGENTS.md) for the role of each.

- **Overlays / Leaves** (`overlays/`) - Owns the contextual leaf UI rendered via portals: comment creation and thread interaction, block insertion menus, table editing menus, link preview and editing, and the shared compound toolbar.

- **Utilities** (`lib/`) - Owns stateless host helpers: keybinding resolution, selection math and clipboard extraction, canvas DPI scaling, pointer coordinate conversion, and built-in theme definitions.
