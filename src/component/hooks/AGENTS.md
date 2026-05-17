# Component Hooks

The hooks subsystem owns browser lifetimes and interaction translation between `Documint.tsx` and the framework-agnostic editor engine. Hooks observe DOM/browser APIs, translate user activity into editor/store/render calls, and expose declarative candidates back to the host component.

Hooks should not own editing semantics. Pure editor behavior belongs in `src/editor`; durable derived view models belong in the component store; hooks own effects, refs, observers, timers, gestures, and browser integration.

## Design Principles

- **Hooks coordinate effects, not semantics.** If a hook starts composing raw layout queries, document-index lookups, comments, and editor mutations, raise that composition into an editor API or store-derived view model.
- **Use sprigs for durable derivations.** If a hook mostly reads state, derives a value, compares it, and stores it locally, move that derivation into the component store.
- **Do not depend on `useEffectEvent` identity.** Never put a `useEffectEvent` result in an effect, layout-effect, or memo dependency array; invoke it inside the effect and omit it from deps.
- **Viewport layout has one owner.** `useViewport` owns the lazy layout handle. Other hooks read the exposed handle rather than recomputing layout.
- **Leaf UI and idle state are shared contracts.** Hooks emit leaf candidates for `Documint` to arbitrate, and interaction hooks mark `useIdle` so caret blink and optional animation continuation respond consistently. `useIdle` also owns the ambient animation clock that paint can freeze during activity and resume without phase jumps.

## Subsystem Map

- `useViewport` owns scroll state, viewport dimensions, lazy layout resolution, pointer coordinates, drag-edge autoscroll, and programmatic scrolling.
- `useRenderScheduler` owns coalesced rAF paint scheduling and render/paint intents.
- `useInput` owns the hidden textarea bridge: keyboard, IME, clipboard, paste, keybindings, focus, and textarea positioning.
- `usePointer`, `useSelection`, and `useCursor` own pointer, range, caret, blink, and leaf-candidate interaction lifetimes.
- `useImages`, `useImageHandles`, `useDecorations`, `usePresence`, `useTheme`, and `useIdle` own their named host/browser concerns.
