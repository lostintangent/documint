# Navigation

The navigation subsystem owns document-flow and layout-aware caret/selection movement. It translates semantic movement intent such as arrow keys, page movement, Home/End, click placement, hit testing, and drag extension into concrete editor intents or `EditorState` selection updates.

Navigation sits above state selection primitives and below browser interaction handling. It may measure or hit-test prepared layout, then applies selection updates through state APIs or returns editor targets for the host to act on. It does not own text mutation, DOM events, renderer paint, or gesture policy.

## Design Principles

- **Movement updates selection only.** Navigation should return `EditorState` selection changes or no-ops; text edits belong in state commands.
- **Flow is shared semantics.** State index query helpers define which regions and leaf blocks participate in editable/visual flow so navigation, deletion, layout, and hit testing agree.
- **Layout is an input.** Vertical movement, point placement, and drag selection may use prepared layout and hit testing, but navigation does not create layout.
- **Hit testing resolves editor intent.** `hit.ts` composes layout geometry with editor semantics such as inert-leaf redirects, below-document fallback, drag focus clamping, word selection, link hits, and task-toggle hits.
- **Table movement overrides ordinary flow first.** Vertical table moves should prefer same-column cell targets before falling back to line/document flow.

## Subsystem Map

- `index.ts` owns the public navigation API.
- `hit.ts` owns point-to-selection and point-to-target resolution over prepared layout.
- `line.ts` owns line-based horizontal, vertical, page, and Home/End movement.
- `table.ts` owns table-specific vertical movement and exit fallback.
