# Markdown

This sub-system owns the markdown persistence boundary. It parses authored markdown directly into `Document` via `parseDocument(source)` and serializes semantic `Document` snapshots back to canonical markdown via `serializeDocument(document)`. The parser is bespoke and document-oriented: it recognizes the Documint markdown dialect directly instead of routing through mdast or a plugin pipeline. Generic unsupported markdown constructs are preserved as semantic `unsupported` nodes, while the trailing `documint-comments` directive is promoted into first-class `Document.comments`.

### Key Files

- `index.ts` - Owns the public markdown API. `parseDocument(...)` / `serializeDocument(...)` are the file persistence pair; `parseFragment(...)` / `serializeFragment(...)` are the clipboard fragment pair.

- `parser/index.ts` - Owns the public parser entrypoint and orchestrates block parsing plus trailing metadata extraction.

- `parser/blocks.ts` - Owns block-level markdown parsing into semantic document blocks, including list and blockquote nesting, directive preservation, and paragraph stopping rules.

- `parser/inline.ts` - Owns inline markdown parsing inside headings, paragraphs, and table cells. This includes marks, links, images, inline code, text directives, and inline raw preservation.

- `parser/tables.ts` - Owns canonical GFM-style table parsing, including `readTable(...)` and the table-specific recognition helpers that support block parsing.

- `parser/comments.ts` - Owns extraction of the trailing `documint-comments` directive from parsed document blocks and translates its JSON body into `Document.comments` while dropping misplaced comment directives from document blocks.

- `serializer.ts` - Owns canonical markdown emission from semantic `Document` snapshots, including list/table formatting, container-directive reconstruction from structured fields, raw unsupported content preservation, and synthetic emission of the trailing comments directive.

- `shared.ts` - Owns the small set of shared markdown syntax primitives and the shared `MarkdownOptions` used across both parsing and serialization (e.g. `preserveOrderedListStart` for the parser, `padTableColumns` for the serializer).

- `SUPPORT.md` - Owns the markdown feature matrix and explicit product stance on supported, preserved, canonicalized, and out-of-scope syntax.
