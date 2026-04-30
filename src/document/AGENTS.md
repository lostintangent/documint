# Document

This sub-system owns the closed, immutable, format-agnostic semantic document model. It defines `Document` and all block/inline node types as discriminated unions, provides deterministic ID generation and `plainText` extraction during canonical construction, and exposes a typed visitor for tree traversal. The data model is intentionally closed — node types don't change at runtime — so exhaustive switches are the primary extension mechanism. Every other subsystem builds on this model without modifying it.

The document layer also owns the **anchor algebra**: the content-addressable position vocabulary and primitives that comments, presence cursors, and selection rebase compose into their own policies.

### Key Files

- `types.ts` - Owns the semantic vocabulary: `Document`, block nodes, inline nodes, marks, and related model types.

- `document.ts` - Owns canonical document operations: `createDocument(...)` for full construction, `spliceDocument(...)` for incremental root-level edits, and shared semantic helpers such as `nodeId(...)`, plain-text extraction, and block-tree accessors.

- `build.ts` - Owns semantic node builders and rebuild helpers that keep semantic node shape and derived fields such as `plainText` correct for core node families.

- `visit.ts` - Owns typed semantic tree traversal for blocks, inline nodes, and table-cell text containers.

- `query.ts` - Owns small semantic queries built on the shared walker, such as image discovery and block lookup.

- `anchors.ts` - Owns the anchor algebra: the content-addressable position vocabulary, container discovery, and fingerprint capture/search/verification primitives consumed by comments, presence, and selection rebase.

- `comments/` - Owns comment threads as anchored annotations on the document: persisted thread shape, immutable thread CRUD, defensive parsing of untrusted payloads, and the quote/context-based resolution policy that scores threads against the current snapshot using the shared anchor algebra.
