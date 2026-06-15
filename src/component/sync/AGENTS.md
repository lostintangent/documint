# Component Sync

Component sync lets embedders treat Documint as a controlled markdown editor
without losing editor continuity. Local edits emit markdown snapshots for the
host, external markdown snapshots rebuild editor state, and narrow host events
such as user mentions get markdown-shaped payloads.

Sync consumes local editor transitions and externally supplied markdown. Local
transitions become host callbacks such as `onContentChanged` and
`onUserMentioned`; external markdown becomes reconciled editor state. Markdown
owns canonical text syntax, editor owns selection and editing semantics, and
embedders own networking, conflict resolution, presence transport, and
host-side text diffs.

## Design Notes

- **Full snapshots keep controlled editing simple.** `onContentChanged`
  receives the full next markdown string for local content edits, so embedders
  can own persistence, transport, conflict handling, and any minimal text diffs
  in their own model. The snapshot comes from the live runtime document, not
  save-canonical serialization, so host echoes do not collapse transient
  structure before reconciliation; identical host echoes are ignored unless
  markdown options or resource protocol handling changed.
- **Markdown ranges are not editor truth.** Component sync does not maintain
  source maps, root offset tables, patch bases, or incremental markdown
  projections just to describe changes as ranges. The editor owns editing
  semantics, and full snapshots remain the host-facing interchange format until
  measured cost or a consumer-proven API justifies incremental projection.
- **External sync preserves selection through reconciliation.** When
  host-supplied markdown rebuilds editor state, reconciliation tries to keep the
  user's selection or caret stable so controlled-content updates do not feel
  like editor resets.
- **Reconciliation stays conservative to avoid owning conflicts.** Selection
  repair first prefers stable region identity, then unique text/path fallbacks
  and context-window offset repair. Transient empty root paragraphs can be
  recreated when nearby surviving roots anchor the position; ambiguous
  structural rewrites leave the rebuilt host-markdown editor state unchanged
  instead of merging competing edits or deciding document truth.
- **Mention events give hosts the changed markdown line.** Mention events report
  the canonical changed markdown line because embedders need that exact line
  content. The helper stays local and deterministic instead of growing into a
  general markdown-line diff system.
- **React lifetimes stay isolated in `useSync`.** `useSync` owns React refs,
  lifecycle timing, callback emission, and editor replacement. Files in `sync/`
  remain deterministic helpers over explicit markdown, document, editor, and
  transition inputs.

## Subsystem Map

- `useSync.ts` owns the React entrypoint: it emits content and mention
  callbacks, detects external content changes, and replaces editor state with
  reconciled snapshots.
- `external-reconciliation.ts` owns best-effort selection and caret continuity
  across externally supplied markdown snapshots.
- `mention-event.ts` owns accepted mention edits to canonical markdown-line
  payloads for embedders.
- `index.ts` owns the public component-sync surface exported to neighboring
  component code.
