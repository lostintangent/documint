# Anchors

The anchors subsystem owns editor-side runtime support for the document anchor algebra. The document layer defines the content-addressable vocabulary and search primitives. This layer resolves those anchors into editor runtime state, layout, and viewport behavior.

Anchors sit alongside the editor pipeline rather than inside one stage. They keep comments, presence, and other anchored data attached to the current document snapshot as content changes.

## Design Principles

- **Document owns the algebra, editor owns runtime resolution.** Anchor vocabulary and semantic resolution live in `src/document`. This subsystem maps matches to runtime regions, ranges, cursors, and viewport statuses.
- **Node anchors resolve to both document paths and editor regions.** Document node anchors prove a block or table cell match across snapshots. Editor node anchors keep the matched document path separate from the resolved `EditableRegion`, so block-level consumers do not accidentally collapse into descendant-region identity.
- **Selection anchors recover offsets, not external trust.** `SelectionAnchor` is an editor-owned, ephemeral anchor for a selection point. It composes document text-anchor context with selection affinity, a fallback offset, and text-continuity checks over runtime editor text. Component sync decides when an external snapshot is trustworthy enough to reuse that recovered offset.
- **Anchors are not selections.** Anchor offsets are semantic container offsets. Editor selections are runtime region offsets. Convert deliberately at the boundary.
- **Anchor containers resolve through paths.** Document anchor matches carry the current snapshot's container path; editor resolution maps that path to `EditableRegion.containerPath`. Ordinals are consistency checks, not fallback locations.
- **Use the cheapest correct repair path.** Full re-resolve is correct but walks the document; edit-time remap is local and cheap when the edit range and inserted/deleted lengths are known.
- **Unresolved is a valid state.** Presence targets and comment ranges may fail to resolve against the current snapshot; callers should preserve source data and omit only the runtime result.

## Subsystem Map

- `index.ts` owns public re-exports.
- `text.ts` owns editor resolution of document text-anchor containers into runtime regions.
- `nodes.ts` owns editor resolution of document node anchors into matched paths and runtime regions.
- `selection.ts` owns editor selection anchors, which recover runtime offsets and text continuity from document text-anchor context plus selection affinity.
- `comments/` owns comment capture, runtime range resolution, viewport geometry, active-thread lookup, and edit-time repair.
- `presence/` owns host-provided presence target resolution and viewport mapping.
