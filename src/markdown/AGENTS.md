# Markdown

The markdown subsystem owns the Documint dialect that lets the editor behave like a markdown-native surface: users can load and save markdown files, paste markdown from other tools, copy editor content as markdown, and hosts can receive predictable markdown snapshots after user edits. It is a bespoke parser and serializer over the `Document` model, not a wrapper around a generic markdown AST.

## Design Notes

- **Markdown syntax adapts to document semantics, not the other way around.** New product capabilities start in `src/document`. This layer teaches the Documint dialect how to read and write that semantic shape without making markdown source the editor model.
- **Full-document parsing preserves file-only state.** Full-document parsing keeps concerns such as front matter and the trailing comment appendix, while serialization emits stable saved markdown with canonical spellings such as `-` bullets, sequential ordered markers, backtick fences, and `<br>` hard breaks, compact tables by default, and a trailing newline for non-empty documents.
- **Fragment parsing is optimized for copy and paste.** Clipboard markdown bypasses file-only concerns such as front matter and comment directives, then classifies paste input as plain text, formatted inlines, or blocks so editor commands can use the lowest-loss insertion path.
- **Root-level caching makes per-edit snapshots viable.** Local document edits serialize the live runtime document before component sync hands hosts the full next markdown string. Unchanged immutable root blocks reuse cached output by block identity and the serializer option key, so the sync path pays mainly for edited roots.
- **Unsupported syntax survives when it can still be represented.** Raw HTML, text directives, and generic container directives stay as raw or directive nodes where possible, while `SUPPORT.md` declares which markdown features are semantic, preserved, canonicalized, gaps, or intentional non-goals.
- **Dialect changes update recognition and emission together.** Block readers, inline token readers, inline mark specs, block-start escape predicates, serializer output, preservation policy, and `SUPPORT.md` status move together so parser and serializer behavior does not drift.
- **Host options tune markdown translation, not document schema.** Parser options can promote links into resource nodes, recognize bare `@Name` text, or preserve ordered-list starts, while serializer options such as table padding change output formatting without creating host-specific document schema.

## Subsystem Map

- `index.ts` owns the public boundary for document and fragment parse/serialize operations.
- `parser/` owns direct markdown-to-document parsing for front matter, blocks, inlines, tables, raw syntax, and trailing comment directives.
- `serializer/` owns canonical document-to-markdown emission for documents, fragments, blocks, inlines, tables, cached root blocks, and the comment appendix.
- `shared.ts` owns markdown options, syntax constants, comment directive naming, resource-protocol normalization, and inline mark specs shared by parser and serializer.
- `SUPPORT.md` owns the detailed dialect matrix, including supported semantics, canonicalization policy, gaps, and intentional non-goals.
