# Document

The document subsystem gives every layer one format-agnostic `Document` model for editable content, so markdown round-trips, editor commands, rendering, comments, and presence all target the same semantic truth. A `Document` is a closed immutable tree of block and inline nodes with structural paths, canonical IDs, plain-text projections, and anchored annotations. That shared model is what lets undo/redo share unchanged structure, comments survive edits, and search reason about user-visible text instead of markdown syntax or rendering artifacts.

## Design Notes

- **A closed typed model keeps every layer speaking the same language.** Blocks, inlines, marks, resources, and comments are closed model shapes with exhaustive unions where the schema branches. New content concepts should become typed variants, not editor-specific side channels. `frontMatter` is the one format-specific exception: document code preserves it as an opaque markdown round-trip slot but does not interpret it.
- **Canonical construction makes immutable snapshots cheap to compare.** Builders create semantic node shapes with derived fields such as `plainText` and canonical marks. `createDocument` and `spliceDocument` seal deterministic IDs from type, structural path, and semantic content, then preserve eligible unchanged roots and arrays so undo/redo and downstream caches can share structure. IDs and paths identify nodes inside one canonical snapshot, not long-lived anchors for comments, presence, or selection repair.
- **Shared queries keep semantic text reads consistent.** Cached `plainText` strips away markdown syntax and inline formatting noise, so search and anchor matching can reason about text users recognize, such as image alt text, `@mention` names, and resource labels. Inline coordinate helpers are separate from `plainText`: line breaks and references count as one object coordinate each, and `block.plainText.length` is not automatically a selection length.
- **Content-addressable anchors make annotations survive edits.** Anchor algebra describes positions by semantic text containers and surrounding content, not editor runtime offsets or snapshot IDs. Paragraphs, headings, code blocks, and table cells can be anchor containers. Aggregate `plainText` on lists, blockquotes, tables, directives, raw blocks, or dividers is deliberately not one. Editor consumers convert anchor matches to runtime offsets at the boundary.
- **Comments and fragments stay at their own altitude.** Comment threads live on `Document.comments`, store content-addressable anchors plus quoted text, and keep thread CRUD plus matched/repaired/ambiguous/stale resolution policy in `comments/`. Clipboard `Fragment`s carry text, inline, or block payloads without comments or front matter. Markdown owns fragment conversion, and the editor owns insertion policy.

## Subsystem Map

- `index.ts` owns the public document facade and re-exports only the surfaces that cross the document boundary.
- `model/` owns the closed semantic schema, structural path vocabulary, container-block policy, mark canonicalization, resource protocol helpers, and document node types.
- `build/` owns semantic builders, canonical document construction, root-level splicing, document-level comment splicing/id sealing, deterministic IDs, no-op-aware canonicalization, and `plainText` normalization.
- `query/` owns traversal, lookup, tree mapping, inline coordinate measurement, plain-text projection, reference classification, and content-addressable anchor primitives.
- `comments/` owns persisted comment-thread shape, immutable thread mutations, defensive parsing, deterministic thread IDs, and comment-specific anchor resolution policy.
