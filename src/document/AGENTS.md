# Document

This sub-system owns the format-agnostic semantic document model. Its job is to define what a `Document` is, which block and inline nodes exist, and which small semantic helpers the rest of the system can rely on.

The two main responsibilities in this subsystem are:

- Define the semantic `Document` object model
- Provide the canonical semantic construction and edit path for `Document`

The main usage pattern in this subsystem is:

- Use `create*` and `rebuild*` helpers from `build.ts` to construct valid semantic block and inline nodes
- Use `buildDocument(...)` for full canonical document construction
- Use `spliceDocument(...)` for incremental top-level document edits after rebuilding only the affected semantic nodes

### Key Files

- `types.ts` - Owns the semantic vocabulary: `Document`, block nodes, inline nodes, marks, and related model types.

- `document.ts` - Owns canonical document operations: `buildDocument(...)` for full construction, `spliceDocument(...)` for incremental root-level edits, and shared semantic helpers such as `nodeId(...)` and plain-text extraction.

- `build.ts` - Owns semantic node builders and rebuild helpers that keep semantic node shape and derived fields such as `plainText` correct for core node families.

- `visit.ts` - Owns typed semantic tree traversal for blocks, inline nodes, and table-cell text containers.

- `query.ts` - Owns small semantic queries built on the shared walker, such as image discovery and block lookup.

Keep markdown syntax out of this layer. If markdown introduces unsupported constructs such as directives, the markdown adapter should preserve them through the semantic `unsupported` nodes instead of teaching `src/document` generic markdown concepts.
