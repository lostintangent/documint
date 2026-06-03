# Component Sync

Component sync owns Documint's embedder-facing synchronization helpers. It repairs editor continuity across externally supplied markdown snapshots and resolves narrow host events that need markdown-shaped payloads.

This is component-owned integration code, not a top-level engine subsystem and not a transport layer. Markdown owns canonical text syntax, editor owns editing semantics and selection state, and component owns React/browser lifetimes. These helpers compose those capabilities for embedders without taking ownership of networking, server conflict resolution, multiplayer presence, or host-side text diffs.

## Design Principles

- **Snapshots are the content contract.** `onContentChanged` receives the full next markdown string on every local content edit. Hosts that need minimal text edits can diff their previous snapshot against the next snapshot in their own text model.
- **No hidden markdown buffer.** Component sync should not maintain source maps, root offset tables, patch bases, or incremental markdown projections just to describe changes as ranges. That machinery belongs only behind a future consumer-proven API.
- **Editor semantics stay in editor.** Component sync may consume immutable `EditorState` snapshots and transition metadata, but it should not encode command behavior or mutate editor state through reducer internals.
- **External reconciliation is editor continuity.** Reconciliation preserves selection/caret position across externally supplied content snapshots. It does not merge competing document edits or decide server truth.
- **Mention events are intentionally narrow.** Mention payloads report the canonical markdown line for the accepted mention edit because hosts need that exact line content. Keep that helper deterministic and local instead of reviving general markdown-line diff utilities.
- **React effects stay at the host edge.** Hooks may call sync helpers, but sync files should remain deterministic helpers over their inputs.

## Subsystem Map

- `mention-event.ts` resolves accepted mention edits to the canonical markdown line payload reported to embedders.
- `external-reconciliation.ts` preserves editor selection/caret continuity across externally supplied content snapshots.

## Testing

Tests live in `test/component/sync`. Reconciliation tests should prove selection continuity across external snapshots. Mention tests should assert the reported line number and line markdown. End-to-end edit benchmarks should include the production behavior of editor mutation plus markdown serialization.
