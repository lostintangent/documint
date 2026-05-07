# Component Hooks

Each hook in this folder owns one orchestration concern between `Documint.tsx` and the framework-agnostic editor engine. There's no editing logic here — only the wiring between user actions, browser APIs, editor state, and paint. Pure logic stays in [`src/editor`](../../editor/AGENTS.md); side effects (scroll observers, resize observers, focus, pointer capture, intervals) live here.

Cross-cutting conventions:

- Host callbacks consumed by other hooks or wired into JSX use `useEffectEvent` so the call sites read the latest closure without re-binding.
- **Never put a `useEffectEvent` result in a `useEffect`/`useLayoutEffect`/`useMemo` dep array.** Its returned-function identity isn't reliably stable across renders, so including it would re-fire the effect or bust the memo every render. The contract is that the body always reads the latest closure when _invoked_ — call it inside the effect and omit it from deps.
- `useViewport` owns the lazy `EditorLayoutState` cache through the viewport store; other hooks read the exposed `viewportLayout` handle rather than recomputing layout themselves.
- `useCursor`, `useSelection`, and `usePointer` each surface a leaf candidate independently; `Documint.resolveVisibleLeafPresentation` arbitrates between them. See [Leaf overlay coordination](../AGENTS.md#leaf-overlay-coordination) in the parent.
- Hooks coordinate browser events and lifetimes on top of semantic `@/editor`
  APIs. If a hook starts combining raw layout queries, document-index lookups,
  comment live ranges, and editor mutations into one interaction, move that
  composition into a named editor API or a store-derived view model.

### State and lifetime

- **`useViewport`** — Owns scroll state (top, height, content height), the scroll container ref, the lazy `EditorLayoutState` cache resolver, coordinate translation (pointer event → editor point), and drag-edge autoscroll. Exposes `viewportLayout`, `observeScrollContainer`, and `scrollTo` for the host. The `onScroll` event handler itself lives in `Documint.tsx` (`handleViewportScroll`) — it bridges this hook with `useRenderScheduler`, so it sits at the orchestration altitude that has access to both. Every scroll (native or programmatic) funnels through that single worker. Read by almost every other hook.
- **`useTheme`** — System theme detection (`prefers-color-scheme`) and merging of host theme overrides. Exposes `preferredTheme` plus the inline custom-property bag carried through portaled overlays.
- **`useImages`** — Async image-resource pipeline: decodes referenced URLs into `ImageBitmap`s for the canvas painter and handles paste-write back through host storage. Tracks loading state for the render-while-loading rAF loop.

### Render scheduling

- **`useRenderScheduler`** — Coalesced `requestAnimationFrame` scheduler. Exposes four intents whose names encode cost and scope (`scheduleFullRender`, `scheduleFullPaint`, `scheduleContentPaint`, `scheduleOverlayPaint`). See [Render loop](../AGENTS.md#render-loop) in the parent for full semantics.

### User interaction

- **`useInput`** — Bridges the hidden textarea: keystrokes, IME composition, clipboard, paste, keybinding dispatch, and the textarea positioning that lets iOS auto-scroll the focused caret above the virtual keyboard.
- **`usePointer`** — Pointer events on the canvas: hit testing via `useViewport`'s coord translator, hover target debouncing, cursor styling, drag-to-select, click-to-toggle-task. Produces a hover leaf candidate.
- **`useSelection`** — Selection drag, selection range handles, and the selection-mode leaf candidate (comment-create over a range, expanded thread). Keeps the input textarea positioned at the focus.
- **`useCursor`** — Caret blink, store-derived cursor-leaf candidate (insertion menu, table menu, contextual link/comment under the caret), focus visibility (auto-scroll to keep the caret on-screen), the `markActivity` signal other hooks call to keep the caret solid through interaction, and store-derived `caretInViewport` used to suspend the blink interval when the caret scrolls off-screen.

### Specialized

- **`useImageHandles`** — Resize-handle gesture lifecycle for the inline image at the cursor. Reads the store-derived `imageAtCursorValue`; owns pointer capture and resize commands.
