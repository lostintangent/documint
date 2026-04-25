# Eliminate the Editor Facade Object

## Context

The `Editor` facade in `src/editor/api.ts` wraps 57 methods in a factory object. 37 are pure pass-throughs (`insertText,` with zero transformation). The factory only exists because `prepareViewport` captures a `CanvasRenderCache` closure — everything else pays the tax for that one method. The barrel and the facade duplicate the public API surface.

The goal: the barrel (`src/editor/index.ts`) becomes the sole public API. Cross-subsystem composition lives as standalone functions in `api.ts`. Commands, types, and simple functions export directly from their subsystem modules through the barrel. The `Editor` type, `createEditor()` factory, and `useEditor()` hook are eliminated. Consumers import named functions directly instead of threading an `editor` object through every hook.

## Step 1: Rewrite `src/editor/api.ts`

Delete the `Editor` type (lines 155-365) and `createEditor()` factory (lines 369-567). Keep the types (`EditorViewportState`, `EditorCommand`, `EditorPoint`, `SelectionHit`, `ContainerLineBounds`, `EditorViewport`) and private helpers (`createBlockMap`, `createContainerBounds`).

Replace with ~20 standalone exported composition functions organized in four groups:

**Query adapters** (5) — destructure `EditorState` before calling subsystem functions. Import subsystem functions with aliases to avoid name collisions (e.g., `getCommentState as getCommentStateFromIndex`):
- `getCommentState(state)` → `getCommentStateFromIndex(state.documentIndex)`
- `getSelectionContext(state)` → `getSelectionContextFromIndex(state.documentIndex, state.selection.anchor)`
- `normalizeSelection(state)` → `normalizeSelectionFromIndex(state.documentIndex, state.selection)`
- `getSelectionMarks(state)` → `getSelectionMarksFromIndex(state.documentIndex, state.selection)`
- `resolvePresenceViewport(state, viewport, presence)` → `resolvePresenceViewportFromIndex(state.documentIndex, viewport, presence)`

**Navigation routing** (5) — branch between move and extend. Import raw navigation functions with aliases (already done in current api.ts):
- `moveCaretHorizontally(state, direction, extendSelection?)`
- `moveCaretVertically(state, layout, direction, extendSelection?)`
- `moveCaretByViewport(state, layout, direction, extendSelection?)`
- `moveCaretToLineBoundary(state, layout, boundary, extendSelection?)`
- `moveCaretToDocumentBoundary(state, boundary, extendSelection?)`

**Layout/hit-testing** (8) — extract `viewport.layout` and compose:
- `prepareViewport(state, options, renderCache, resources?)` — explicit `CanvasRenderCache` param instead of closure
- `resolveSelectionHit(state, viewport, point)` — chains `resolveEditorHitAtPoint ?? resolveHitBelowLayout`
- `measureVisualCaretTarget(state, viewport, point)` — composes `measureCaretTarget + resolveCaretVisualLeft`
- `resolveDragFocus`, `resolveWordSelection`, `resolveHoverTarget`, `resolveTargetAtSelection`, `measureCaretTarget` — extract `viewport.layout` before delegating

Import layout's `measureCaretTarget` as `measureLayoutCaretTarget` to avoid collision.

**Paint** (2) — restructure args for canvas paint functions:
- `paintContent(state, viewport, context, options)`
- `paintOverlay(state, viewport, context, options)`

## Step 2: Rewrite `src/editor/index.ts`

The barrel becomes the full public API surface. Re-export everything consumers need:

**From `./api`**: all 20 composition functions + types

**From `./state`**: direct command exports with consumer-friendly aliases where needed:
- State lifecycle: `createEditorState`, `createDocumentFromEditorState` (alias as `getDocument`), `setSelection`
- All commands: `insertText`, `insertLineBreak`, `deleteBackward`, `deleteForward`, `deleteSelectionText` (alias as `deleteSelection`), `insertSelectionText` (alias as `replaceSelection`), `toggleBold`, `toggleItalic`, `toggleStrikethrough`, `toggleUnderline`, `toggleInlineCode`, `indent`, `dedent`, `moveListItemUp`, `moveListItemDown`, `toggleTaskItem`, `undo`, `redo`, `selectAll`, `insertTable`, `insertTableColumn`, `deleteTableColumn`, `insertTableRow`, `deleteTableRow`, `deleteTable`, `updateInlineLink` (alias as `updateLink`), `removeInlineLink` (alias as `removeLink`), `createCommentThread`, `replyToCommentThread`, `editComment`, `deleteComment`, `deleteCommentThread`, `resolveCommentThread`
- `hasNewAnimation`
- Types: `EditorState`, `EditorSelection`, `EditorSelectionPoint`, `NormalizedEditorSelection`, `SelectionContext`

**From `./annotations`**: `resolvePresenceCursors`; types: `EditorPresence`, `EditorPresenceViewport`, `EditorPresenceViewportStatus`, `Presence`, `EditorCommentState`

**From `./canvas`**: `createCanvasRenderCache`, type `CanvasRenderCache`, `hasRunningEditorAnimations` (alias as `hasRunningAnimations`), type `EditorTheme`

**From `./resources`**: `emptyDocumentResources`, types `DocumentImageResource`, `DocumentResources`

**From `./layout`**: type `EditorHoverTarget`, type `ViewportLayout`

## Step 3: Delete `src/component/hooks/useEditor.ts`

No longer needed — there's no factory to call.

## Step 4: Migrate consumer hooks

For each hook: remove the `editor: Editor` prop, import functions directly from `@/editor`, replace `editor.method(...)` with `method(...)`. Replace `ReturnType<Editor["createState"]>` with `EditorState` and `ReturnType<Editor["setSelection"]>` with `EditorState`.

**`useViewport.ts`** — critical: owns the render cache now
- Drop `editor` prop
- Import `createCanvasRenderCache`, `prepareViewport` from `@/editor`
- Add `const renderCacheRef = useRef(createCanvasRenderCache())`
- `editor.prepareViewport(state, opts, resources)` → `prepareViewport(state, opts, renderCacheRef.current, resources)`

**`useInput.ts`** — largest migration (~20 call sites)
- Drop `editor` prop, import all commands + navigation + `setSelection` + `measureVisualCaretTarget`
- Standalone `applyKeyboardEvent` function also drops its `editor` param
- `editor.deleteSelection()` → `deleteSelection()`, `editor.replaceSelection()` → `replaceSelection()`

**`useSelection.ts`**
- Drop `editor` prop, import: `normalizeSelection`, `getSelectionMarks`, `setSelection`, `measureVisualCaretTarget`, `resolveDragFocus`
- Standalone helpers also drop `editor` param

**`useHover.ts`**, **`useCursor.ts`**, **`usePresence.ts`** — same pattern, smaller scope

## Step 5: Migrate `Documint.tsx`

- Remove `useEditor` import and `const editor = useEditor()`
- Remove `editor` from all hook option objects
- Import ~30 functions directly from `@/editor`
- Key renames: `editor.createState(doc)` → `createEditorState(doc)`, `editor.getDocument(state)` → `getDocument(state)`, `editor.hasRunningAnimations(state, now)` → `hasRunningAnimations(state, now)`
- Remove `editor` from `useMemo`/`useEffect` dependency arrays (it was referentially stable from `useRef`, so removing is safe)

## Step 6: Migrate test files

4 test files use `createEditor()`:
- `test/editor/editor.test.ts`
- `test/editor/layout/viewport.test.ts`
- `test/editor/annotations/comments.test.ts`
- `test/editor/annotations/presence.test.ts`

Replace `const editor = createEditor()` + `editor.method(...)` with direct function imports. Tests calling `prepareViewport` add `const renderCache = createCanvasRenderCache()`.

## Step 7: Verify

- `npx tsc --noEmit` — clean type check
- `bun test` — all tests pass
- Review for any missed `editor.` references or stale imports

## Files changed

| File | Change |
|------|--------|
| `src/editor/api.ts` | Rewrite: delete facade, keep standalone compositions + types |
| `src/editor/index.ts` | Rewrite: expanded barrel exports |
| `src/component/hooks/useEditor.ts` | **Delete** |
| `src/component/hooks/useViewport.ts` | Drop editor prop, own renderCache |
| `src/component/hooks/useInput.ts` | Drop editor prop, direct function calls |
| `src/component/hooks/useSelection.ts` | Drop editor prop, direct function calls |
| `src/component/hooks/useHover.ts` | Drop editor prop, direct function calls |
| `src/component/hooks/useCursor.ts` | Drop editor prop, direct function calls |
| `src/component/hooks/usePresence.ts` | Drop editor prop, direct function calls |
| `src/component/Documint.tsx` | Remove useEditor, direct function calls |
| `test/editor/editor.test.ts` | Direct function imports |
| `test/editor/layout/viewport.test.ts` | Direct function imports |
| `test/editor/annotations/comments.test.ts` | Direct function imports |
| `test/editor/annotations/presence.test.ts` | Direct function imports |
