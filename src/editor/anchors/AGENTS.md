# Anchors

The anchors subsystem owns editor-side runtime support for the document anchor algebra. The document layer defines the content-addressable vocabulary and search primitives; this layer projects those anchors into editor runtime state, layout, and viewport behavior.

Anchors sit alongside the editor pipeline rather than inside one stage. They keep comments, presence, and other anchored data attached to the current document snapshot as content changes.

## Design Principles

- **Document owns the algebra; editor owns projection.** Anchor vocabulary and semantic resolution live in `src/document`; this subsystem maps matches to runtime regions, ranges, cursors, and viewport statuses.
- **Anchors are not selections.** Anchor offsets are semantic container offsets; editor selections are runtime region offsets. Convert deliberately at the boundary.
- **Use the cheapest correct repair path.** Full re-resolve is correct but walks the document; edit-time remap is local and cheap when the edit range and inserted/deleted lengths are known.
- **Unresolved is a valid state.** Presence targets and comment ranges may fail to resolve against the current snapshot; callers should preserve source data and omit only the runtime projection.

## Subsystem Map

- `index.ts` owns `projectAnchorContainersToEditor` and public re-exports.
- `comments/` owns comment capture, runtime range projection, viewport geometry, active-thread lookup, and edit-time repair.
- `presence/` owns host-provided presence target resolution and viewport projection.
