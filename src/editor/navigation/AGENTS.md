# Navigation

The navigation subsystem owns document-flow and layout-aware caret/selection movement, plus plain-text search, the set of editor capabilities whose job is "find positions in the document to navigate to." Keyboard motion can target text positions or whole blocks depending on navigation mode, while search picks positions from a query. Hit testing, click placement, and drag extension round out the point-of-action affordances.

Navigation sits above state selection primitives and below browser interaction handling. It may measure or hit-test prepared layout, then applies selection updates through state APIs or returns editor targets (positions or matches) for the host to act on. It does not own text mutation, DOM events, renderer paint, or gesture policy.

## Design Principles

- **Movement updates selection only.** Navigation should return `EditorState` selection changes or no-ops; text edits belong in state commands.
- **Navigation modes choose granularity without changing selection shape.** Text mode moves through graphemes, lines, and layout hits. Block mode moves through indexed block flow so hosts can offer document-unit focus without teaching the editor about host states such as review mode. Both modes still emit ordinary path-and-offset selections.
- **Targets are positions.** Whether produced by motion, hit testing, or search, the navigation surface emits path-and-offset addresses (or `EditorState` updates) the host can pass to `setSelection`. Higher-level UX (search leaf, jump-to commands) stays at the component layer.
- **Flow is shared semantics.** State index query helpers define which text paths and leaf blocks participate in editable/visual flow so navigation, deletion, layout, and hit testing agree.
- **Layout is an input.** Vertical movement, point placement, and drag selection may use prepared layout and hit testing, but navigation does not create layout. Search is index-only and does not touch layout.
- **Hit testing resolves editor intent.** `hit.ts` composes layout geometry with editor semantics such as inert-leaf redirects, below-document fallback, drag focus clamping, word selection, link hits, and task-toggle hits.
- **Table movement overrides ordinary flow first.** Vertical table moves should prefer same-column cell targets before falling back to line/document flow.

## Subsystem Map

- `index.ts` owns the public navigation API.
- `hit.ts` owns point-to-selection and point-to-target resolution over prepared layout.
- `line.ts` owns line-based horizontal, vertical, page, and Home/End movement.
- `table.ts` owns table-specific vertical movement and exit fallback.
- `search.ts` owns plain-text substring search over the document index.
