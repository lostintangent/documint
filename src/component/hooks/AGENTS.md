# Component Hooks

Each hook in this folder owns one orchestration concern between `Documint.tsx` and the framework-agnostic editor engine. There's no editing logic here — only the wiring between user actions, browser APIs, editor state, and paint. Pure logic stays in [`src/editor`](../../editor/AGENTS.md); side effects (scroll observers, resize observers, focus, pointer capture, intervals) live here.

Cross-cutting conventions:

- Host callbacks consumed by other hooks or wired into JSX use `useEffectEvent` so the call sites read the latest closure without re-binding.
- **Never put a `useEffectEvent` result in a `useEffect`/`useLayoutEffect`/`useMemo` dep array.** Its returned-function identity isn't reliably stable across renders, so including it would re-fire the effect or bust the memo every render. The contract is that the body always reads the latest closure when *invoked* — call it inside the effect and omit it from deps.
- `useViewport` owns the lazily-prepared `EditorLayoutState` cache; other hooks read it via the `LazyRefHandle` rather than recomputing layout themselves.
- `useCursor`, `useSelection`, and `usePointer` each surface a leaf candidate independently; `Documint.resolveVisibleLeafPresentation` arbitrates between them. See [Leaf overlay coordination](../AGENTS.md#leaf-overlay-coordination) in the parent.

### State and lifetime

- **`useViewport`** — Owns scroll state (top, height, content height), the scroll container ref, the lazily-prepared `EditorLayoutState` cache, coordinate translation (pointer event → editor point), and drag-edge autoscroll. Exposes `observeScrollContainer` and `scrollTo` for the host to call after each scroll position change. The `onScroll` event handler itself lives in `Documint.tsx` (`handleViewportScroll`) — it bridges this hook with `useRenderScheduler`, so it sits at the orchestration altitude that has access to both. Every scroll (native or programmatic) funnels through that single worker. Read by almost every other hook.
- **`useTheme`** — System theme detection (`prefers-color-scheme`) and merging of host theme overrides. Exposes `preferredTheme` plus the inline custom-property bag carried through portaled overlays.
- **`useImages`** — Async image-resource pipeline: decodes referenced URLs into `ImageBitmap`s for the canvas painter and handles paste-write back through host storage. Tracks loading state for the render-while-loading rAF loop.
- **`useLazyRef`** — Small primitive: a ref that initializes on first read and can be invalidated by its owner. Used by `useViewport` for the layout cache.

### Render scheduling

- **`useRenderScheduler`** — Coalesced `requestAnimationFrame` scheduler. Exposes four intents whose names encode cost and scope (`scheduleFullRender`, `scheduleFullPaint`, `scheduleContentPaint`, `scheduleOverlayPaint`). See [Render loop](../AGENTS.md#render-loop) in the parent for full semantics.

### User interaction

- **`useInput`** — Bridges the hidden textarea: keystrokes, IME composition, clipboard, paste, keybinding dispatch, and the textarea positioning that lets iOS auto-scroll the focused caret above the virtual keyboard.
- **`usePointer`** — Pointer events on the canvas: hit testing via `useViewport`'s coord translator, hover target debouncing, cursor styling, drag-to-select, click-to-toggle-task. Produces a hover leaf candidate.
- **`useSelection`** — Selection drag, selection range handles, and the selection-mode leaf candidate (comment-create over a range, expanded thread). Keeps the input textarea positioned at the focus.
- **`useCursor`** — Caret blink, cursor-leaf candidate (insertion menu, table menu, contextual link/comment under the caret), focus visibility (auto-scroll to keep the caret on-screen), the `markActivity` signal other hooks call to keep the caret solid through interaction, and `caretInViewport` / `refreshCaretViewportStatus` — projected against the freshly-prepared layout in the render-viewport pass alongside `usePresence.refreshPresence`, then used to suspend the blink interval when the caret scrolls off-screen.

### Specialized

- **`usePresence`** — Remote presence orchestration in two stages: semantic resolution against the document (anchor algebra, stable across scrolls) and geometric projection against the viewport (visible / above / below + scroll target). Output drives both the canvas painter (carets) and the DOM overlay (off-viewport arrows).
- **`useImageHandles`** — Resize handles for the inline image at the cursor. Built on `useCursor`'s `imageAtCursor` and `useSelection`'s `ResizeHandle` shape.
