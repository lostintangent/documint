# Navigation

This sub-system owns caret motion and range extension over a prepared `DocumentLayout`. It's the bridge between keyboard intent ("arrow up", "page down", "Home") and a concrete `EditorState` selection update. All movement functions take an `extendSelection` parameter so move-vs-extend share one code path.

Vertical motion uses a table-first, flow-fallback chain: the table handler returns `null` when the caret isn't in a table cell, and the flow handler takes over. Horizontal motion crosses region boundaries naturally — when the caret runs off the edge of a region, it advances into the previous or next region in flow.

### Key Areas

- `index.ts` - Owns the public navigation API (`moveCaretHorizontally`, `moveCaretVertically`, `moveCaretByViewport`, `moveCaretToLineBoundary`, `moveCaretToDocumentBoundary`). Each entry point measures the current caret against the layout and dispatches through the appropriate motion handler.

- `line.ts` - Owns line-based motion semantics for ordinary document flow: horizontal step within a region or across region boundaries, vertical motion to the line above/below at the same visual X, viewport-page motion, and Home/End within a wrapped line.

- `table.ts` - Owns table-specific vertical overrides: up/down moves between table cells in the same column, with a fallback to the surrounding document flow when the caret exits the table top or bottom.
