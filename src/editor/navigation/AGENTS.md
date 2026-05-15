# Navigation

This subsystem owns document-flow and layout-aware caret/selection navigation. It bridges semantic movement intent ("arrow up", "page down", "Home", click this point, drag from this anchor") to concrete `EditorState` selection updates.

Navigation sits above pure state selection semantics and below React/browser interaction handling. It may measure or hit-test prepared layout, then applies selection updates through state primitives. It does not own text mutation, DOM events, canvas paint, or browser gesture policy.

Keyboard-style movement functions take an `extendSelection` parameter so move-vs-extend share one code path. Vertical motion uses a table-first, flow-fallback chain; horizontal motion crosses region boundaries naturally through document flow. The flow helpers are also shared by deletion, layout planning, and hit testing so every subsystem agrees on which regions and leaf blocks participate in editable/visual flow.

### Key Areas

- `index.ts` - Owns the public navigation API: keyboard movement, point placement, point extension, and drag selection. Each entry point measures or hit-tests against layout, then applies a semantic selection update.

- `flow.ts` - Owns document-flow primitives: previous/next editable regions, previous/next leaf blocks, first editable region in a root, and inert/container block classification. These helpers are pure lookups over `DocumentIndex`; they do not mutate state or inspect layout.

- `line.ts` - Owns line-based motion semantics for ordinary document flow: horizontal step within a region or across region boundaries, vertical motion to the line above/below at the same visual X, viewport-page motion, and Home/End within a wrapped line.

- `table.ts` - Owns table-specific vertical overrides: up/down moves between table cells in the same column, with a fallback to the surrounding document flow when the caret exits the table top or bottom.
