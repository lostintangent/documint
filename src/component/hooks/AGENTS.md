# Component Hooks

The hooks subsystem owns browser lifetimes and interaction translation between `Documint.tsx` and the framework-agnostic editor engine. Hooks observe DOM/browser APIs, translate user activity into editor/store/render calls, and expose declarative candidates back to the host component.

Hooks should not own editing semantics. Pure editor behavior belongs in `src/editor`; durable derived view models belong in the component store; hooks own effects, refs, observers, timers, gestures, and browser integration.

## Design Principles

- **Hooks coordinate effects, not semantics.** If a hook starts composing raw layout queries, document-index lookups, comments, and editor mutations, raise that composition into an editor API or store-derived view model.
- **Use sprigs for durable derivations.** If a hook mostly reads state, derives a value, compares it, and stores it locally, move that derivation into the component store.
- **Do not depend on `useEffectEvent` identity.** Never put a `useEffectEvent` result in an effect, layout-effect, or memo dependency array; invoke it inside the effect and omit it from deps.
- **Viewport layout has one owner.** `useViewport` owns the lazy layout handle. Other hooks read the exposed handle rather than recomputing layout.
- **Leaf UI and idle state are shared contracts.** Hooks emit leaf candidates for `Documint` to arbitrate, and interaction hooks mark `useIdle` so caret blink and optional paint continuation respond consistently. `useIdle` also owns the ambient animation clock that paint can freeze during activity and resume without phase jumps.

## Subsystem Map

- `useViewport` owns scroll state, viewport dimensions, the layout handle, coordinate translation, drag-edge autoscroll, and programmatic scrolling.
- `useRender` owns coalesced rAF render intents, paint dispatch, timed semantic-effect retention, and active-effect continuation.
- `useInput` owns the hidden textarea bridge: native text/IME input, keyboard shortcuts, clipboard, focus, textarea positioning, and iOS undo priming.
- `usePointer` owns hover targeting and pointer-driven editor interactions.
- `useSelection` owns range-selection handles, selection-handle dragging, and selection-anchored leaves.
- `useCursor` owns cursor reveal, cursor-anchored leaves, and caret blink state.
- `useTheme` owns theme resolution, CSS variable projection, and system color-scheme subscription.
- `useSync` owns external content reconciliation and local sync event emission.
- `useSearch` owns find UI state, match resolution/navigation, and selection synchronization.
- `useImages` owns referenced image loading/eviction, pasted-image persistence, and selected-image resize handles.
- `usePresence` owns host user/presence joining and presence view-model subscriptions.
- `useResources` owns resource protocol normalization, active-resource registry construction, and discovered-resource requests.
- `useDecorations` owns decoration rule filtering, worker scheduling, and text-decoration results.
- `useIdle` owns activity/idle transitions and the paused animation clock.
