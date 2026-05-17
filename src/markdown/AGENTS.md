# Markdown

The markdown subsystem owns Documint's persistence and clipboard format boundary. It parses authored markdown into semantic `Document` values and serializes `Document` snapshots back to canonical markdown. It also bridges markdown clipboard payloads to and from `Fragment` values.

This layer is intentionally document-oriented. It recognizes the Documint markdown dialect directly instead of routing through mdast or a plugin pipeline, and it preserves unsupported syntax as raw semantic nodes where possible so round-tripping does not silently discard content.

## Design Principles

- **Markdown is a boundary, not the model.** Add semantic shape in `src/document` first, then teach markdown how to read/write it.
- **Document and fragment altitudes differ.** Document parsing handles front matter and comment directives; fragment parsing deliberately does not.
- **Canonical output protects stability.** Serialization should be predictable even when input markdown had equivalent alternate spellings, and dialect changes should update `SUPPORT.md` alongside parser, serializer, and tests.
- **Round-trip preservation beats clever interpretation.** Unsupported or product-unknown syntax should survive as raw nodes when possible instead of being silently discarded or rewritten.
- **Parser and serializer policy should share tables.** Block readers, inline token readers, and inline mark specs use registries so fast paths, paragraph interruption, escaping, and emission stay aligned.

## Subsystem Map

- `index.ts` exposes `parseDocument(...)` and `serializeDocument(...)`.
- `fragment.ts` owns clipboard-altitude markdown parsing/serialization.
- `parser/` owns direct markdown-to-document parsing for documents, blocks, inlines, tables, and comments.
- `serializer/` owns canonical document-to-markdown emission.
- `shared.ts` owns syntax primitives and `MarkdownOptions` shared by parser and serializer.
- `SUPPORT.md` is the user-facing dialect matrix.

## Extending the Dialect

- For a new block kind, add the semantic node/builders in `src/document`, register a block reader, add serializer support, update `SUPPORT.md`, and add golden coverage.
- For a new inline mark, extend the document `Mark` union and the shared mark spec so parser dispatch and serializer emission derive from one row.
- For a new inline token kind, add the semantic shape/builder if needed, register a token reader, mirror it in `serializeInline`, and update escaping if the syntax introduces new punctuation.
- For a new option, add it to `MarkdownOptions` with a parser/serializer-side note and focused tests for both states.

## Testing

Markdown tests live in `test/markdown/`. Prefer focused parser/serializer tests plus golden round-trip fixtures for dialect behavior. Clipboard behavior belongs in fragment tests.
