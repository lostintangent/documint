# Editor State

This sub-system owns semantic editing state and mutations. It projects the
immutable `Document` into an `EditorState` built around a `DocumentIndex`,
then applies edits against that projection while preserving undo/redo,
selection, animations, and anchored data integrity.

The key boundary is:

- `src/document` owns semantic document truth and block/inline shape.
- `src/editor/state` owns how that truth is indexed, queried during editing,
  and mutated in response to commands.

`Fragment` is part of the document vocabulary, but fragment policy is not.
The document layer defines the clipboard payload shape (`text`, `inlines`,
`blocks`). The state layer decides how a selection extracts a fragment and
how a destination applies one.

### Mental Model

The state layer is a pure state machine. Browser events, DOM geometry, and
canvas painting stay outside it; callers enter through commands and receive a
new immutable `EditorState` or `null` for no-op.

Most edits flow through this sequence:

`command(state, payload) -> context(state, payload) -> action(context, payload) -> reducer(state, action)`

Context is optional, but the ownership stays consistent:

- Commands are the public API and compose the pipeline.
- Context resolvers project command-relevant facts from `EditorState`.
- Actions turn resolved context plus intent payload into `EditorStateAction`s.
  When an edit should start an animation, the action declares a semantic
  `AnimationIntent` on the action.
- The reducer is the only place that applies actions to produce a new state.
- Selection targets describe post-mutation landing positions that must survive
  document rebuilding; concrete `set-selection` actions use `EditorSelection`.
- The reducer materializes action animation intent into transient descriptors
  stored on `EditorState`; paint interprets those descriptors later.

### Key Areas

- **Commands** (`commands.ts`) - Owns the public editing API over `EditorState`: typing, deletion, formatting, structural edits, clipboard, undo/redo, and table/list operations. Commands should read semantically: resolve context, call an action resolver, then dispatch.

- **Index** (`index/`) - Owns the hot-path editing projection from `Document` to `DocumentIndex`: roots, regions, paths, block metadata, and the helpers needed to rebuild that projection incrementally after edits.

- **Selection** (`selection.ts`) - Owns selection primitives, normalization, selection targets, target resolution, and selection-derived read queries such as active marks. Use selection targets for post-edit destinations that need to resolve against the rebuilt document.

- **Context** (`context.ts`) - Owns semantic command context resolution from `EditorState`: block, inline, range, deletion, list item, table cell, and related editing views. It may also expose shared structural lookup helpers used by actions, kept under a separate section.

- **Fragments** (`fragments/`) - Owns editor-state policy for document `Fragment` values. `extract.ts` turns a selection into a `Fragment`, `paste.ts` resolves a `Fragment` into an editor action, `context.ts` resolves fragment-specific context, and `blocks.ts` owns shared structural fragment slicing.

- **Actions** (`actions/`) - Owns focused action factories for edit families such as text insertion, inline mutation, lists, tables, block transforms, deletion, and input rules. Actions return `EditorStateAction | null`; they do not dispatch and should not inspect `EditorState` directly.

- **Reducer** (`reducer/`) - Owns the concrete state transition machinery. It applies actions, rewrites document structure, updates undo/redo state, and preserves anchor/selection consistency through edits. Low-level mutation primitives for document/index substructures live here; fragment extraction may reuse the inline primitives so copied slices preserve the same inline semantics as text edits.

- **Animations** (`animations.ts`) - Owns transient animation descriptor types,
  action-intent materialization, lifecycle pruning, and selection-driven
  animation helpers such as active-block flash.

### Design Notes

- Context resolvers are command-facing APIs. They take `EditorState` as their
  first argument, optionally receive command payload needed for lookup, and
  return semantic facts such as `BlockContext`, `InlineContext`, or
  `TableCellContext`. Keep context resolvers general-purpose and named in
  editor/document-index terms; do not round-trip command payloads like names,
  URLs, or widths through context.

- Actions are action factories, not state resolvers. They should usually take
  resolved context plus the mutation payload and return an `EditorStateAction`
  (or `null`). If an action wants to inspect `EditorState` or repeatedly resolve
  selection/index facts, the command context is probably too thin.

- Context-backed commands pass only the resolved context and explicit command
  payload to their action resolver. Plain state-backed commands may still read
  `EditorState` directly when the command itself is the resolver.

- Command payload should represent intent that cannot be inferred from current
  editor state: typed text, movement direction, external targets from hover UI,
  selected URLs, image widths, or explicit replacement ranges. Do not pass
  current-region facts redundantly when selection/context can derive them.

- `context.ts` may also export shared structural lookup/build helpers used by
  actions, but those helpers should be clearly separated from command context
  resolvers. If a function answers "can this command run here?", it is a
  command context resolver. If it answers "where is this structural object in
  the document index?", it is a shared structural helper.

- Prefer resolving context once, then routing semantically, instead of re-deriving selection facts ad hoc in every command.

- Prefer reusing existing mutation primitives (`splice-text`, inline insertion,
  structural fragment splice) over adding clipboard- or command-specific write
  paths. New behavior should usually add a command/action/context shape before
  adding a reducer action.

- Keep reducer actions small and declarative. The reducer applies the action,
  rebuilds the document index, resolves selection targets against the new
  document, materializes declared animation intent, and updates history. It
  should not know about UI gestures, completions, clipboard flavors, or why an
  animation was chosen.

- Keep fragment policy in editor state, not in `src/document` or `src/component`. Fragment extraction and paste action resolution belong in `fragments/`; reducer-level mutation primitives, including structural range replacement and inline slice/rebuild behavior, belong in `reducer/`.

- Keep animations as transient state descriptors. Actions decide when their
  mutation should start an animation because actions own the semantic edit
  policy; paint decides how an in-flight animation looks.
