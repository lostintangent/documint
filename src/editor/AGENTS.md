# Editor

This sub-system owns the framework-agnostic editing engine. Its internal pipeline is:

`Document -> EditorState -> EditorLayoutState -> canvas 2D drawing calls`

Five subsystems sit on that pipeline. **State** owns the projection from `Document` to `EditorState` and all editing mutations. **Navigation** translates keyboard intent into selection updates. **Layout** turns `EditorState` into positioned geometry packaged as `EditorLayoutState`. **Canvas** paints from that geometry. **Anchors** keeps content-addressable positions (comment threads, presence cursors) live across edits, sitting alongside the pipeline rather than inside it.

The important boundary is that `src/editor` owns the capabilities in that pipeline, while [`src/component`](../component/AGENTS.md) owns orchestration of when they run. In other words:

- `src/editor` does not own React lifecycle, DOM measurement, or canvas mounting.
- `src/component` does not own editing semantics, geometry algorithms, or paint logic.

### Key Areas

- **Barrel** (`index.ts`) - The public API surface. Re-exports from all subsystems and defines cross-subsystem query adapters (`getCommentState`, `getSelectionContext`, `normalizeSelection`, `getSelectionMarks`, `resolvePresenceViewport`) that destructure `EditorState` before delegating.

- **State** ([`state/`](state/AGENTS.md)) - Owns the `Document` -> `EditorState` projection, editor state with undo/redo, and all semantic editing operations: text replacement, inline formatting, block-level edits, list operations, table mutations, input rules, and structural rewrites. Commands are in `state/commands.ts`. Internally, `EditorState` wraps a `DocumentIndex` that denormalizes the document for efficient lookup, but consumers interact with `EditorState` directly.

- **Navigation** ([`navigation/`](navigation/AGENTS.md)) - Owns caret motion and range extension over a prepared `DocumentLayout`. Translates keyboard intent ("arrow up", "page down", "Home") into selection updates. Vertical motion uses a table-first, flow-fallback chain so table cells move by row before falling through to ordinary line-based motion.

- **Layout** ([`layout/`](layout/AGENTS.md)) - Owns the `EditorState` -> `EditorLayoutState` projection and all editor geometry: viewport planning, line layout, hit testing, caret measurement, and measurement caching. The composition entry point is `prepareLayout`, with `resolveLayout*` and `measureLayout*` adapters for callers that want to interrogate or measure against the prepared layout state.

- **Canvas** ([`canvas/`](canvas/AGENTS.md)) - Owns canvas-specific code: immediate-mode painting from prepared layout plus editor/runtime inputs (selection, comments, presence, animations, theme), and shared canvas-measurement primitives (font metrics, prepared-text cache) that both paint and layout consume. Includes `paintContent` and `paintOverlay` wrappers that translate `EditorLayoutState` into raw paint params.

- **Anchors** ([`anchors/`](anchors/AGENTS.md)) - Owns editor-side runtime support for the document layer's anchor algebra: projecting persisted comment threads against the current snapshot, resolving host-provided presence cursors, and edit-time offset remap that keeps anchored state sticky during inline edits.
