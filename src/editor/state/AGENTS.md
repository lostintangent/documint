# Editor State

The state subsystem owns semantic editing state and mutations. It projects immutable `Document` snapshots into an `EditorState` built around a `DocumentIndex`, then applies commands while preserving undo/redo, selection, animations, fragments, and anchored data integrity.

This is a state-in/state-out layer. Browser events, DOM geometry, layout, and canvas painting stay outside it; callers enter through commands or selection primitives and receive a new immutable `EditorState` or a no-op/null result. Animation helpers accept explicit timestamps for deterministic callers, with convenience defaults for ordinary command use.

`Fragment` is part of the document vocabulary, but fragment policy lives here. The document layer defines the clipboard payload shape (`text`, `inlines`, `blocks`); state decides how selections extract fragments and how destinations apply them.

## Design Principles

- **State transitions are staged.** Commands resolve semantic context, action factories produce declarative `EditorStateAction`s, and the reducer is the only commit point that rewrites documents/indexes/history.
- **The reducer should not know the gesture.** It applies actions, resolves post-edit selections, materializes animation intent, and keeps anchors/comments consistent without knowing whether the user typed, pasted, clicked, or accepted a completion.
- **Selection targets survive rebuilds.** Use selection targets for post-edit landing positions that must resolve against the rebuilt document; use concrete selections only when no rebuild boundary is involved.
- **Reuse mutation primitives.** Prefer existing text splice, inline rewrite, and structural fragment replacement paths over command-specific write paths.
- **Animations are descriptors, not effects.** State decides when a semantic edit starts an animation; canvas decides how that descriptor looks at paint time.

## Subsystem Map

- `commands/` owns the public editing API, command context, action factories, and input rules.
- `index/` owns the hot-path `Document → DocumentIndex` projection and incremental rebuild helpers.
- `selection/` owns selection primitives, normalization, selection targets, and selection queries.
- `fragments/` owns editor policy for document `Fragment` extraction and insertion.
- `reducer/` owns concrete state transitions, index rebuilds, selection resolution, history, and anchor/comment consistency.
- `animations/` owns animation descriptor types, semantic intents, materialization, pruning, and selection-driven helpers.
