# Component Sync

Component sync lets embedders treat Documint as a controlled markdown editor without losing editor continuity. Local edits emit markdown snapshots for the host, external markdown snapshots rebuild editor state, and narrow host events such as user mentions get markdown-shaped payloads. Markdown remains the interchange format while editor selection, editing semantics, networking, conflict resolution, and presence transport stay with their owning layers.

## Design Notes

- **Full snapshots keep controlled editing simple.** Local content edits synchronously serialize the live runtime document and pass the full next markdown string to `onContentChanged`, so embedders can own persistence, transport, conflict handling, and any minimal text diffs in their own model. Host echoes are compared as external snapshots and ignored when unchanged unless markdown options or resource protocol handling changed.
- **Markdown ranges are not editor truth.** Component sync does not maintain source maps, root offset tables, patch bases, or incremental markdown projections just to describe changes as ranges. The editor owns editing semantics, and full snapshots remain the host-facing interchange format until measured cost or a consumer-proven API justifies incremental projection.
- **External sync preserves selection without owning conflicts.** When host-supplied markdown rebuilds editor state, reconciliation tries stable region identity, unique text/path fallbacks, context-window offset repair, and nearby root anchors so controlled-content updates do not feel like editor resets. Ambiguous structural rewrites still apply the host markdown snapshot; they just skip speculative caret repair instead of merging competing edits or deciding document truth.
- **Mention events give hosts the changed markdown line.** Mention events report the canonical changed markdown line because embedders need that exact line content. The helper stays local and deterministic instead of growing into a general markdown-line diff system.

## Subsystem Map

- `useSync.ts` owns the React entrypoint: it emits content and mention callbacks, detects external content changes, and replaces editor state with reconciled snapshots.
- `external-reconciliation.ts` owns best-effort selection and caret continuity across externally supplied markdown snapshots.
- `mention-event.ts` owns accepted mention edits to canonical markdown-line payloads for embedders.
- `index.ts` owns the public component-sync surface exported to neighboring component code.
