# Sync

The sync subsystem owns Documint's embedder-facing document synchronization helpers. It translates editor transitions and externally supplied snapshots into small deterministic payloads and state repairs at the markdown/editor boundary.

This is an integration layer, not a transport layer. Markdown owns canonical text syntax, editor owns editing semantics and selection state, and component owns React/browser lifetimes. Sync composes those capabilities for embedders without taking ownership of networking, server conflict resolution, or multiplayer presence.

## Design Principles

- **Patches describe persisted markdown.** `DocumintPatch` values are line replacements against a caller-provided revision. Use markdown serializer primitives for canonical text, and return `null` instead of guessing when a transition cannot be represented safely.
- **Editor semantics stay in editor.** Sync may consume immutable `EditorState` snapshots and transition metadata, but it should not encode command behavior or mutate editor state through reducer internals.
- **External reconciliation is editor continuity.** Reconciliation preserves selection/caret position across externally supplied content snapshots. It does not merge competing document edits or decide server truth.
- **Fast paths must preserve convergence.** Specialized paths for code, tables, lists, structural root spans, comments, and mention payloads are valid only when applying the emitted lines produces the same markdown as full serialization.
- **React effects stay at the host edge.** Hooks may call sync helpers, but sync files should remain deterministic helpers over their inputs.

## Subsystem Map

- `content-patch.ts` builds `DocumintPatch` payloads from editor transitions.
- `markdown-lines.ts` owns canonical markdown line replacement and root line-offset primitives shared by sync payloads.
- `mention-event.ts` resolves accepted mention edits to the markdown line payload reported to embedders.
- `external-reconciliation.ts` preserves editor selection/caret continuity across externally supplied content snapshots.

## Testing

Tests live in `test/sync`. Patch tests should assert convergence by applying non-null patch changes to the previous serialized markdown and comparing the result to the next serialized markdown. Add or update benchmark coverage when changing hot patch paths.
