# Navigation

The navigation subsystem owns document-flow and layout-aware caret/selection movement. It translates semantic movement intent such as arrow keys, page movement, Home/End, click placement, and drag extension into concrete `EditorState` selection updates.

Navigation sits above state selection primitives and below browser interaction handling. It may measure or hit-test prepared layout, then applies selection updates through state APIs. It does not own text mutation, DOM events, canvas paint, or gesture policy.

## Design Principles

- **Movement updates selection only.** Navigation should return `EditorState` selection changes or no-ops; text edits belong in state commands.
- **Flow is shared semantics.** `flow.ts` defines which regions and leaf blocks participate in editable/visual flow so navigation, deletion, layout, and hit testing agree.
- **Layout is an input.** Vertical movement, point placement, and drag selection may use prepared layout and hit testing, but navigation does not create layout.
- **Table movement overrides ordinary flow first.** Vertical table moves should prefer same-column cell targets before falling back to line/document flow.

## Subsystem Map

- `index.ts` owns the public navigation API.
- `flow.ts` owns editable/visual document-flow primitives.
- `line.ts` owns line-based horizontal, vertical, page, and Home/End movement.
- `table.ts` owns table-specific vertical movement and exit fallback.
