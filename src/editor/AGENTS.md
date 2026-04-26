# Editor

This sub-system owns the framework-agnostic editing engine. Its internal pipeline is:

`Document -> EditorState -> ViewportLayout -> canvas 2D drawing calls`

The important boundary is that `src/editor` owns the capabilities in that pipeline, while `src/component` owns orchestration of when they run. In other words:

- `src/editor` does not own React lifecycle, DOM measurement, or canvas mounting.
- `src/component` does not own editing semantics, geometry algorithms, or paint logic.

### Key Areas

- **Barrel** (`index.ts`) - The public API surface. Re-exports from all subsystems and defines cross-subsystem query adapters (`getCommentState`, `getSelectionContext`, `normalizeSelection`, `getSelectionMarks`, `resolvePresenceViewport`) that destructure `EditorState` before delegating.

- **State** (`state/`) - Owns the `Document` -> `EditorState` projection, editor state with undo/redo, and all semantic editing operations: text replacement, inline formatting, block-level edits, list operations, table mutations, input rules, and structural rewrites. Commands are in `state/commands.ts`. Internally, `EditorState` wraps a `DocumentIndex` that denormalizes the document for efficient lookup, but consumers interact with `EditorState` directly.

- **Navigation** (`navigation/`) - Owns caret and range movement. Each function takes an `extendSelection` parameter to unify move and extend behavior. Vertical movement dispatches through a table-first, flow-fallback chain — the table handler returns null when the caret isn't in a table, and the flow handler takes over. Horizontal movement crosses region boundaries naturally.

- **Layout** ([`layout/`](layout/AGENTS.md)) - Owns the `EditorState` -> `ViewportLayout` projection and all editor geometry: viewport planning, line layout, hit testing, caret measurement, and measurement caching. Also owns viewport composition functions (`prepareViewport`, `resolveViewport*`, `measureViewport*`) that adapt `EditorViewportState` for consumers.

- **Canvas** (`canvas/`) - Owns canvas-specific code: immediate-mode painting from prepared layout plus editor/runtime inputs (selection, comments, presence, animations, theme), and shared canvas-measurement primitives (font metrics, prepared-text cache) that both paint and layout consume. Includes `paintContent` and `paintOverlay` wrappers that translate `EditorViewportState` into raw paint params.

- **Anchors** (`anchors/`) - Owns editor-side runtime support for content-addressable anchors: projection of comment threads to live ranges, resolution of presence cursors, and edit-time offset remap shared across anchored consumers.
