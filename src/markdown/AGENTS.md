# Markdown

This sub-system owns the markdown persistence boundary. It parses authored markdown directly into `Document` via `parseDocument(source)` and serializes semantic `Document` snapshots back to canonical markdown via `serializeDocument(document)`. A companion `parseFragment` / `serializeFragment` pair handles clipboard payloads at fragment altitude (no front matter, no comments, no trailing newline).

The parser is bespoke and document-oriented: it recognizes the Documint markdown dialect directly instead of routing through mdast or a plugin pipeline. Generic unsupported markdown constructs are preserved as semantic `unsupported` nodes so round-tripping doesn't lose content, while the trailing `documint-comments` directive is promoted into first-class `Document.comments`.

### Key Areas

- `index.ts` - Owns the public markdown API. `parseDocument(...)` / `serializeDocument(...)` are the file persistence pair; `parseFragment(...)` / `serializeFragment(...)` are the clipboard fragment pair.

- `parser/` - Owns the bespoke markdown parser. Recognizes the Documint dialect — blocks, inlines, tables, and the trailing `documint-comments` directive — and produces semantic `Document` blocks plus extracted leading front matter.

- `serializer/` - Owns canonical markdown emission from semantic `Document` snapshots. Mirrors the parser folder: `index.ts` orchestrates document-level emission and the comment-directive appendix, `blocks.ts` owns the block dispatcher and per-kind serializers, `inlines.ts` owns inline emission, and `tables.ts` owns pipe-table layout.

- `fragment.ts` - Owns the markdown ↔ `Fragment` bridge for clipboard payloads. Mirrors the parser/serializer pair at fragment altitude (no front matter, no comments, no trailing newline) and narrows parsed input to the most precise variant (`text` / `inlines` / `blocks`) for paste routing.

- `shared.ts` - Owns the small set of shared markdown syntax primitives and the shared `MarkdownOptions` used across both parsing and serialization (e.g. `preserveOrderedListStart` for the parser, `padTableColumns` for the serializer).

- `SUPPORT.md` - Owns the markdown feature matrix and explicit product stance on supported, preserved, canonicalized, and out-of-scope syntax.
