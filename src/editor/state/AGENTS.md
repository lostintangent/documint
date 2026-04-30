# Editor State

This sub-system owns semantic editing state and mutations. It projects the
immutable `Document` into an `EditorState` built around a `DocumentIndex`,
then applies edits against that projection while preserving undo/redo,
selection, and anchored data integrity.

The key boundary is:

- `src/document` owns semantic document truth and block/inline shape.
- `src/editor/state` owns how that truth is indexed, queried during editing,
  and mutated in response to commands.

`Fragment` is part of the document vocabulary, but fragment policy is not.
The document layer defines the clipboard payload shape (`text`, `inlines`,
`blocks`). The state layer decides how a selection extracts a fragment and
how a destination applies one.

### Key Areas

- **Commands** (`commands.ts`) - Owns the public editing API over `EditorState`: typing, deletion, formatting, structural edits, clipboard, undo/redo, and table/list operations. Commands should read semantically and delegate quickly.

- **Index** (`index/`) - Owns the hot-path editing projection from `Document` to `DocumentIndex`: roots, regions, paths, block metadata, and the helpers needed to rebuild that projection incrementally after edits.

- **Selection** (`selection.ts`) - Owns selection normalization and selection-derived read queries, such as marks at selection, region resolution by path, and selection targets.

- **Context** (`context.ts`) - Owns semantic command context resolution from selection and index state: list item, blockquote text block, table cell, code block, and related editing views used by structural commands.

- **Fragment** (`fragment/`) - Owns clipboard-specific semantics. `extract.ts` turns a selection into a `Fragment`, `apply.ts` routes a `Fragment` into the correct mutation path, `context.ts` resolves source and destination clipboard context, and `blocks.ts` owns shared structural trim and seam-merge policy.

- **Actions** (`actions/`) - Owns focused command-building helpers for specific edit families such as text, lists, tables, block transforms, and input rules. These helpers resolve intent into reducer actions without owning state transitions themselves.

- **Reducer** (`reducer/`) - Owns the concrete state transition machinery. It applies actions, rewrites document structure, updates undo/redo state, and preserves anchor/selection consistency through edits.

- **Animations** (`animations.ts`) - Owns edit-driven animation descriptors that the rendering pipeline consumes later.

### Design Notes

- Prefer resolving context once, then routing semantically, instead of re-deriving selection facts ad hoc in every command.

- Prefer reusing existing mutation primitives (`splice-text`, inline insertion, structural fragment splice) over adding clipboard- or command-specific write paths.

- Keep clipboard policy in `fragment/`, not in `src/document` or `src/component`. Clipboard crosses markdown, selection, and mutation concerns, so it belongs at the editor-state altitude.
