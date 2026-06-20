# Component Sync

Component sync lets embedders connect Documint to markdown files without making React props the live editing buffer. Local edits emit markdown snapshots for host persistence, host-supplied external snapshots rebuild editor state, and narrow host events such as user mentions get markdown-shaped payloads. Markdown remains the interchange format while editor selection, editing semantics, networking, conflict resolution, and presence transport stay with their owning layers.

## Design Notes

- **Full snapshots keep persistence simple.** Local content edits synchronously serialize the live runtime document and pass the full next markdown string to `onContentChanged`. That snapshot is a host notification for saving, transport, conflict handling, and text diffs, not a request to feed the same markdown back through the `content` prop.
- **Markdown ranges are not editor truth.** Component sync does not maintain source maps, root offset tables, patch bases, or incremental markdown projections just to describe changes as ranges. The editor owns editing semantics, and full snapshots remain the host-facing interchange format until measured cost or a consumer-proven API justifies incremental projection.
- **External snapshots replace editor state atomically.** `Documint` parses host markdown into a `Document` before `useSync` runs, then sync builds one fresh editor state, repairs selection when it can, and publishes the result through `store.editor.replace`. External replacements publish `source: "external"`, so Documint does not echo host-applied snapshots back through `onContentChanged`.
- **String-equal snapshots are no-ops.** Sync applies host markdown when `content` or parser options change. It does not keep local-emission history or revision tokens, so hosts should update `content` only for external file or network changes instead of treating Documint as a controlled text input.
- **Diff display is optional host policy.** `showDiffs` defaults on. When it is false, sync still reconciles external snapshots and repairs selection, but skips document-change detection, unacknowledged-change merging, and diff effects.
- **Best-effort reconciliation preserves continuity without owning conflicts.** Selection repair may use stable region identity, document-node content evidence, path evidence, context windows around the old offset, or nearby root anchors. Ambiguous structural rewrites still apply the host markdown snapshot, but sync skips speculative caret repair instead of merging competing edits or deciding document truth.
- **Unacknowledged document changes are sync lifecycle state.** Document diff detects semantic additions and modifications, while sync resolves those changes against the current editor state, filters the active selection, and decides which changes remain unacknowledged. Newly observed changes are reported separately from retained changes so the render pipeline can animate introductions once without making document diff own UI timing.
- **Mention events give hosts the changed markdown line.** Mention events report the canonical changed markdown line because embedders need that exact line content. The helper stays local and deterministic instead of growing into a general markdown-line diff system.

## Subsystem Map

- `useSync.ts` owns the React entrypoint: it emits content and mention callbacks, detects external content changes, and replaces editor state with reconciled snapshots.
- `external-changes.ts` owns unacknowledged document-change lifecycle: merge, retargeting through document diff and editor queries, selection dismissal, and new-change reporting.
- `external-reconciliation.ts` owns best-effort selection and caret continuity across externally supplied markdown snapshots.
- `mention-event.ts` owns accepted mention edits to canonical markdown-line payloads for embedders.
- `index.ts` owns the public component-sync surface exported to neighboring component code.
