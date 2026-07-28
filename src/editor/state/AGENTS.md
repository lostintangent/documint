# Editor State

The state subsystem owns semantic editing state and mutations. It projects immutable `Document` snapshots into an `EditorState` built around a `DocumentIndex`, then applies commands while preserving undo/redo, selection, semantic effects, fragments, and anchored data integrity.

This is a state-in/state-out layer. Browser events, DOM geometry, layout, clocks, and renderer painting stay outside it; callers enter through commands or selection primitives and receive a new immutable `EditorState` or a no-op/null result. Semantic effects describe what happened without choosing visual policy or timing.

`Fragment` is part of the document vocabulary, but fragment policy lives here. The document layer defines the clipboard payload shape (`text`, `inlines`, `blocks`); state decides how selections extract fragments and how destinations apply them.

## Design Notes

- **State transitions are staged.** Commands resolve semantic context, actions declare the intended edit, and the reducer is the only commit point that rewrites documents, indexes, history, selection, effects, and anchors/comments.
- **Commands should read like editor policy.** Action files should describe behavior in domain language first, with mechanical helpers pushed below the main flow. `commands/actions/blocks/list.ts` is the reference shape.
- **Actions declare intent, not reducer mechanics.** Prefer semantic helpers over inline coordinate or splice arithmetic, and extract shared helpers only when they clarify repeated behavior.
- **Selection targets are action vocabulary.** Use them to describe where selection should land after a rebuild; use concrete selections only when no rebuild boundary is involved.
- **The reducer should not know the gesture.** It applies actions, resolves post-edit selections, materializes semantic effects, and keeps anchors/comments consistent without knowing whether the user typed, pasted, clicked, or accepted a completion.
- **Reuse mutation primitives.** Prefer existing text, inline, fragment, and index rebuild paths over command-specific write paths.
- **Mutation ranges prove structural safety.** Commands may reuse local text offsets and index facts, but selection-only navigation targets are not evidence that every crossed structure is safe to edit. Cross-path commands inspect the actual document topology they can mutate.
- **Hot paths stay explicit.** Prefer clear direct control flow when abstraction would add hidden work to index, text, or character-level editing paths.
- **Effects are semantic, not visual policy.** State decides when a semantic edit occurred; component/renderer policy decides whether and how that effect animates.

## Subsystem Map

- `commands/` owns the public editing API, command context, action factories, and input rules.
- `index/` owns the hot-path `Document → DocumentIndex` projection, lookup maps, and incremental rebuild helpers.
- `selection/` owns selection primitives, normalization, action selection targets, and read-only selection queries.
- `fragments/` owns editor policy for document `Fragment` extraction and insertion.
- `reducer/` owns concrete state transitions, index rebuilds, selection resolution, history, and anchor/comment consistency.
- `effects.ts` owns semantic effect resolution and the command-result effect side channel.
