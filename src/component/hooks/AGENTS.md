# Component Hooks

The hooks folder collects Documint's React/browser lifetimes for input, pointer, scroll, render scheduling, theme, resources, images, search, presence, cursor, and selection. Its hooks are lifetime adapters that translate browser events, refs, observers, and timers into editor commands, store reads, render requests, and overlay candidates for `Documint`.

## Design Notes

- **Browser lifetimes become named subsystem requests.** Hooks turn DOM events, refs, observers, and timers into editor commands, store reads, render requests, and leaf candidates. If a hook starts composing raw layout queries, document-index lookups, comments, and editor mutations, raise that composition into an editor API or store-derived view model.
- **Durable derivations belong in sprigs.** If a hook mostly reads state, derives a value, compares it, and stores it locally, move that derivation into the component store.
- **Viewport layout has one owner.** `useViewport` owns the lazy layout handle and installs its resolver in a layout effect before the host's other layout reads. Other hooks read the exposed handle rather than recomputing layout.
- **One ordered frame path keeps layout commits ahead of paint.** Each `useRender` frame commits layout (full renders only), then paints content, then paints the overlay, so a full render paints both canvases against the layout it just committed. Coalesced intents only choose which steps run: `fullRender` adds the commit, `fullPaint` covers both layers, and content or overlay paints can run alone. Active effects continue content painting, and ambient animations continue only while the editor is idle. That policy lives in the pure `createRenderScheduler`, so tests drive frames without a browser, and a new paint need should adjust the step list rather than add a parallel render function.
- **Leaf UI stays declarative.** Hooks emit leaf candidates for `Documint` to arbitrate instead of directly placing overlay DOM.
- **Read-only gates live at interaction boundaries.** Hooks receive `readOnly` as the content-edit gate: the hidden textarea is read-only, and `useInput` omits native edit listeners and edit-only clipboard handlers, consumes only eligible keyboard commands, and maps movement to editor block navigation while keeping navigation semantics in `src/editor/navigation`. `usePointer` suppresses task and metadata boolean mutation before caret placement, while metadata expansion remains pointer/touch active in read-only mode. Cursor, pointer, and image hooks hide edit-only affordances before they emit leaves, handles, or commands rather than adding guards to unreachable callbacks.
- **Async resources drop stale work and fail visibly.** `useImages` reconciles loading placeholders during render, so "loading" shows in the same commit as the URL change, and an effect starts each load once through an in-flight set. Evicted bitmaps are closed if they were evicted before decode finished, failed decodes become error resources, and pasted-image persistence stays behind the host callback boundary before markdown is inserted. Images whose bytes can't be fetched or decoded directly, such as SVG or remote images from hosts without CORS, load through an `<img>`. That fallback taints the canvas, so nothing may read canvas pixels back.
- **Activity clocks stay scoped to the behavior they represent.** `useIdle` owns typing and pointer activity for caret and ambient animation timing. `useScrollbar` separately maps native scroll metrics onto a viewport-fixed DOM thumb, translates captured thumb drags back into native scrolling, and owns its scroll-only hold period.
- **A blurred editor hides its caret and stops blinking.** `useInput` counts focus on either the hidden textarea or the content canvas as editor focus, because a mouse press hands focus between them. `useCursor` holds no blink timer while unfocused. Leaves never read focus, so a focused leaf input stays open while the caret hides.
- **`useEffectEvent` identity is not a dependency.** Never put a `useEffectEvent` result in an effect, layout-effect, or memo dependency array; invoke it inside the effect and omit it from deps.

## Subsystem Map

- `useViewport.ts` owns scroll state, viewport dimensions, metadata expansion input, the layout handle and its per-frame commit, coordinate translation, drag-edge autoscroll, and programmatic scrolling.
- `useRender.ts` owns the rAF render scheduler: coalesced intents, frame step order, timed semantic-effect retention, and paint continuation.
- `useScrollbar.ts` owns virtual scrollbar geometry, pointer-captured native-scroll dragging, and its show-on-scroll/hide-on-idle DOM lifetime.
- `useInput.ts` owns the hidden textarea bridge: native text/IME input, keyboard shortcuts, clipboard, focus, textarea positioning, and iOS undo priming.
- `usePointer.ts`, `useSelection.ts`, and `useCursor.ts` own pointer targeting, selection handles, cursor reveal, cursor-anchored leaves, and caret blink state.
- `useTheme.ts` resolves concrete host themes, projects CSS variables, and follows the system color scheme only when the host omits `theme`.
- `useMediaQuery.ts` owns CSS media-query subscriptions, such as the system color scheme and the touch-primary check that gates keydown listeners.
- `useResources.ts` owns resource protocol normalization, active-resource registry construction, and discovered-resource requests.
- `useImages.ts` owns referenced image loading/eviction, pasted-image persistence, decode failure state, selected-image resize handles, and the render resources that pair loaded images with the resource registry.
- `usePresence.ts` owns host user/presence joining and presence view-model subscriptions.
- `useSearch.ts` owns find UI state, match resolution/navigation, and selection synchronization.
- `useIdle.ts` owns activity/idle transitions and the paused animation clock.
