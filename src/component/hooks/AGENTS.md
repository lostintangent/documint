# Component Hooks

The hooks folder collects Documint's React/browser lifetimes for input, pointer, scroll, render scheduling, theme, resources, images, search, presence, cursor, and selection. Its hooks are lifetime adapters that translate browser events, refs, observers, and timers into editor commands, store reads, render requests, and overlay candidates for `Documint`.

## Design Notes

- **Browser lifetimes become named subsystem requests.** Hooks turn DOM events, refs, observers, and timers into editor commands, store reads, render requests, and leaf candidates. If a hook starts composing raw layout queries, document-index lookups, comments, and editor mutations, raise that composition into an editor API or store-derived view model.
- **Durable derivations belong in sprigs.** If a hook mostly reads state, derives a value, compares it, and stores it locally, move that derivation into the component store.
- **Viewport layout has one owner.** `useViewport` owns the lazy layout handle. Other hooks read the exposed handle rather than recomputing layout.
- **Render intents have one priority ladder.** `useRender` coalesces render requests so `fullRender` wins over `fullPaint`, content and overlay paints can run independently, active effects continue content painting, and ambient animations continue only while the editor is idle.
- **Leaf UI stays declarative.** Hooks emit leaf candidates for `Documint` to arbitrate instead of directly placing overlay DOM.
- **Read-only gates live at interaction boundaries.** Hooks receive `readOnly` as the content-edit gate: `useInput` makes the hidden textarea read-only, omits native edit listeners and edit-only clipboard handlers, consumes only eligible keyboard commands, and maps movement to editor block navigation while keeping navigation semantics in `src/editor/navigation`. Cursor, pointer, and image hooks hide edit-only affordances before they emit leaves, handles, or commands rather than adding guards to unreachable callbacks.
- **Async resources drop stale work and fail visibly.** Resource/image hooks use post-commit loading placeholders to dedupe in-flight work, close decoded bitmaps that were evicted before decode finished, convert failed decodes to error resources, and keep pasted-image persistence behind the host callback boundary before inserting markdown.
- **Activity timing is a shared contract.** `useIdle` owns activity/idle transitions, and interaction hooks mark activity so caret blink, ambient animation time, and optional paint continuation respond consistently.
- **`useEffectEvent` identity is not a dependency.** Never put a `useEffectEvent` result in an effect, layout-effect, or memo dependency array; invoke it inside the effect and omit it from deps.

## Subsystem Map

- `useViewport.ts` owns scroll state, viewport dimensions, the layout handle, coordinate translation, drag-edge autoscroll, and programmatic scrolling.
- `useRender.ts` owns coalesced rAF render intents, paint dispatch, timed semantic-effect retention, and active-effect continuation.
- `useInput.ts` owns the hidden textarea bridge: native text/IME input, keyboard shortcuts, clipboard, focus, textarea positioning, and iOS undo priming.
- `usePointer.ts`, `useSelection.ts`, and `useCursor.ts` own pointer targeting, selection handles, cursor reveal, cursor-anchored leaves, and caret blink state.
- `useTheme.ts` resolves concrete host themes, projects CSS variables, and follows the system color scheme only when the host omits `theme`.
- `useResources.ts` owns resource protocol normalization, active-resource registry construction, and discovered-resource requests.
- `useImages.ts` owns referenced image loading/eviction, pasted-image persistence, decode failure state, and selected-image resize handles.
- `usePresence.ts` owns host user/presence joining and presence view-model subscriptions.
- `useSearch.ts` owns find UI state, match resolution/navigation, and selection synchronization.
- `useIdle.ts` owns activity/idle transitions and the paused animation clock.
