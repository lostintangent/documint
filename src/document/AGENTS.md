# Document

The document subsystem owns Documint's closed, immutable, format-agnostic semantic model. It defines `Document`, block nodes, inline nodes, fragments, structural paths, canonical IDs, plain-text projections, document queries, and comment threads as anchored annotations.

This is the semantic truth layer. Markdown creates it, editor indexing projects it, and component code should never bypass it by inventing parallel document semantics.

## Design Principles

- **The schema is closed and semantic.** Node types do not change at runtime. Add explicit union variants and exhaustive handling instead of storing editor-specific side channels in document data.
- **Canonicalization happens at construction boundaries.** Builders create raw shapes, while `createDocument`/`spliceDocument` assign structural IDs, normalize `plainText`, and clean up post-mutation details.
- **Reference identity carries meaning.** No-op transforms return the original array, and `spliceDocument` preserves unchanged root identity outside the edited range.
- **Comments are document data with content-addressable anchors.** Threads live on `Document.comments`, but their runtime ranges are resolved later by document/editor anchor code. Thread IDs use one recipe for created and parsed documents so save/reload preserves identity.
- **Comment timestamps are inputs when determinism matters.** Thread helpers default timestamps for convenience, but callers can provide `createdAt`, `updatedAt`, or `resolvedAt` to make comment mutations deterministic.

## Subsystem Map

- `types.ts` defines the closed document, fragment, block, inline, and mark unions.
- `paths.ts` and `containers.ts` define structural coordinates and container-block policy.
- `build/` owns builders, construction/splice APIs, normalization, canonicalization, IDs, and `plainText`.
- `query/` owns traversal, lookup, plain-text projection, and anchor algebra.
- `comments/` owns persisted thread shape, immutable thread CRUD, serialization, and quote/context resolution.

## Anchors

The anchor algebra in `query/anchors.ts` is the shared substrate for comments, presence, and selection rebase. It describes text positions by surrounding content, not by editor runtime offsets.

Anchor containers are single semantic text containers: paragraph/heading text, code source, or a table cell's inline text. Anchors never span containers. `listAnchorContainers` returns containers in document order with a stable ordinal; consumers layer their own scoring or affinity policy on top of the candidate search primitives.

Do not conflate anchor offsets with the visitor's `enterPlainText` offsets. The visitor uses editor selection-offset space, where atomic inline stops such as line breaks, images, and mentions count as one character.
