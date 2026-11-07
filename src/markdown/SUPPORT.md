# Markdown Support Matrix

This file defines the markdown feature surface Documint currently cares about.
It is intentionally narrower than full CommonMark or full GitHub Flavored Markdown.

The markdown subsystem owns three concerns:

- Parse authored markdown into the semantic `Document` model
- Serialize semantic `Document` snapshots back to canonical markdown
- Preserve unsupported authored syntax losslessly when it matters

The semantic boundary is defined by [../document/model/types.ts](../document/model/types.ts). If a feature cannot be represented by that model, the markdown subsystem must either preserve it as `raw` content or declare it out of scope.

## Status Legend

- `Supported semantically`: parsed into `Document` and serialized back in canonical form
- `Preserved as unsupported/raw`: not understood semantically, but retained losslessly
- `Canonicalized`: supported, but authored syntax may serialize to a different canonical form
- `Intentional non-goal`: valid markdown feature we are deliberately not prioritizing
- `Partial`: some authored forms are supported, the rest are still a gap
- `Gap`: reasonable markdown/GFM feature not yet supported to the level users may expect

## Current Semantic Surface

These are the semantic node families currently representable in `Document` and therefore first-class markdown capabilities:

- Paragraphs
- Headings
- Blockquotes
- Lists
- List items
- Task items
- Fenced code blocks
- Tables
- Thematic breaks
- Text
- Text marks: inline code, bold, italic, strikethrough, underline, superscript
- Links
- Images
- Unsupported/raw block and inline content
- Comment appendix payload

## Block Features

| Feature                            | Example                                    | Status                         | Notes                                                                                                               |
| ---------------------------------- | ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| ATX headings                       | `## Heading`                               | `Supported semantically`       | Maps directly to heading depth 1-6, and a bare `##` is empty. A trailing `#` run in the text saves escaped.         |
| Setext headings                    | `Heading` + `---` / `===`                  | `Canonicalized`                | Serializes as `#` or `##`, joining wrapped lines. A lone `-` stays an empty list item, as the editor saves one.     |
| Paragraphs                         | plain text blocks                          | `Supported semantically`       | Canonical serialization preserves blank-line-separated block structure.                                             |
| Blockquotes                        | `> quote`                                  | `Supported semantically`       | Nested block structure is supported. A blank line ends a quote, as in CommonMark.                                   |
| Bullet lists                       | `- item`                                   | `Supported semantically`       | Canonical serializer emits `-`.                                                                                     |
| Alternate bullet markers           | `* item`, `+ item`                         | `Canonicalized`                | Parse support exists; serializer normalizes to `-`.                                                                 |
| Ordered lists with `.`             | `1. item`                                  | `Supported semantically`       | Items save numbered up from the authored start.                                                                     |
| Ordered lists with `)`             | `1) item`                                  | `Gap`                          | Reasonable imported markdown syntax; still worth considering.                                                       |
| Task lists                         | `- [ ] item`                               | `Supported semantically`       | Blank task items are preserved.                                                                                     |
| Nested task lists                  | nested checkbox items                      | `Supported semantically`       | Children indent to the list marker, not past the checkbox, as in GFM.                                               |
| Tight vs loose lists               | blank lines between items                  | `Supported semantically`       | Represented through list/list-item `compact`.                                                                       |
| Indented lists and 4-space nesting | `  - item`, `    - child`                  | `Canonicalized`                | Markers may sit behind up to three spaces. Serializer emits root lists at column 0 and nests at the marker width.   |
| Fenced code blocks with backticks  | ` `\``ts `                                 | `Supported semantically`       | Language/meta round-trip. Longer fences parse, and saves widen the fence past backtick-only code lines.             |
| Fenced code blocks with tildes     | `~~~`                                      | `Intentional non-goal`         | Valid markdown, but backtick fences are the canonical Documint syntax.                                              |
| Indented code blocks               | 4-space indented code                      | `Canonicalized`                | Serializes as a backtick fence. Tab-indented lines stay paragraph text for now.                                     |
| Thematic breaks                    | `***`, `---`, `___`                        | `Supported semantically`       | Serializer canonicalizes to `---`, or `***` when it opens the document.                                             |
| GFM tables                         | pipe tables                                | `Supported semantically`       | Alignment and escaped cell pipes are supported; short rows get empty cells, as in GFM.                              |
| YAML front matter                  | leading `---` preamble                     | `Supported semantically`       | Flat semantic strings/booleans; strings emit as quoted scalars or literal blocks, while unsupported YAML stays raw. |
| Flexible table forms               | edge-valid GFM table syntax                | `Gap`                          | Current parser handles the canonical table shape, not the full GFM acceptance surface.                              |
| HTML blocks                        | multi-line `<div>`, `<!-- -->`, `<script>` | `Preserved as unsupported/raw` | CommonMark start/end conditions. Lines stay verbatim, and markdown between blank-line-separated tags parses.        |
| Container directives               | `:::callout`                               | `Supported semantically`       | Modeled as `DirectiveBlock` with name, attributes, and raw body.                                                    |
| Comment appendix directive         | `:::documint-comments`                     | `Supported semantically`       | Special markdown-only translation into `Document.comments`. Anchors on repeated text save which copy they sit on.   |

## Inline Features

| Feature                              | Example                                          | Status                         | Notes                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain text                           | `text`                                           | `Supported semantically`       | Base inline content.                                                                                                                                                |
| Bold                                 | `**bold**` / `__bold__` / `<strong>`             | `Supported semantically`       | CommonMark delimiter runs, paired as GitHub pairs them.                                                                                                             |
| Italic                               | `*italic*` / `_italic_` / `<em>`                 | `Supported semantically`       | CommonMark delimiter runs, paired as GitHub pairs them.                                                                                                             |
| Strikethrough                        | `~~strike~~`                                     | `Supported semantically`       | GFM extension.                                                                                                                                                      |
| Underline                            | `<ins>underline</ins>` / `<u>underline</u>`      | `Supported semantically`       | Markdown-only convention; serializes back as `<ins>`.                                                                                                               |
| Superscript                          | `<sup>2</sup>`                                   | `Supported semantically`       | Markdown-only convention; serializes back as `<sup>`.                                                                                                               |
| Inline code                          | `` `code` ``                                     | `Supported semantically`       | Represented as the composable code text mark; serializer expands fence width when needed.                                                                           |
| Inline links                         | `[label](url "title")`                           | `Supported semantically`       | Text may hold images and balanced brackets; code spans and escapes bind tighter, and the innermost nested link wins. Destinations nest `()` or hold spaces in `<>`. |
| Registered resource links            | `[label](demo-resource://id)`                    | `Supported semantically`       | Parses as a semantic resource inline when the host registers the URL protocol; serializes as a link.                                                                |
| Inline images                        | `![alt](url "title")`                            | `Supported semantically`       | Width extension supported separately.                                                                                                                               |
| Image width extension                | `![x](url){width=320}`                           | `Supported semantically`       | Documint-specific markdown policy.                                                                                                                                  |
| Invalid width extension preservation | `{width=0}` etc.                                 | `Supported semantically`       | Invalid width stays plain text in the paragraph stream.                                                                                                             |
| Raw inline HTML                      | inline tags other than the mark tags shown above | `Preserved as unsupported/raw` | Preserved where encountered, not modeled semantically. Tags wrapped across lines drop their indentation, as GFM does.                                               |
| Text directives                      | `:badge[text]{...}`                              | `Preserved as unsupported/raw` | Preserved as raw inline nodes. They need a label or attributes, so prose like `Note:Use` and `:heart:` stays text.                                                  |
| Hard line breaks                     | two-space break / explicit break                 | `Supported semantically`       | Canonical serializer emits `<br>`.                                                                                                                                  |
| Soft line breaks                     | newline in paragraph                             | `Canonicalized`                | Preserved through paragraph text shape. Wrapped lines in quotes and list items save with the `>` or item indent, even lazy ones.                                    |
| Autolinks in angle brackets          | `<https://example.com>`                          | `Gap`                          | Common modern markdown input; likely worth supporting.                                                                                                              |
| GFM bare autolinks                   | `www.example.com`                                | `Gap`                          | Common modern markdown input; likely worth supporting.                                                                                                              |
| Reference-style links                | `[a][b]` + `[b]: ...`                            | `Canonicalized`                | Full, collapsed, and shortcut forms resolve against definitions anywhere in the document, then save as inline links/images.                                         |
| Entity/numeric references            | `&amp;`, `&#x20;`                                | `Partial`                      | Ordinary-space numeric references (`&#x20;`, `&#32;`) decode to spaces so the serializer's leading-space escape round-trips; broader entity decoding remains a gap. |

## Serialization Policy

These behaviors are intentional even when authored input has multiple valid spellings:

| Policy                                                       | Status                         | Notes                                                                              |
| ------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------- |
| Bullet lists serialize with `-`                              | `Canonicalized`                | We do not preserve `*` or `+`.                                                     |
| Thematic breaks serialize as `---`                           | `Canonicalized`                | Multiple valid forms normalize to one.                                             |
| Ordered lists number items sequentially                      | `Canonicalized`                | `1. 1. 1.` saves as `1. 2. 3.`, matching how it renders.                           |
| Tables serialize with compact cells by default               | `Canonicalized`                | Cells emit at their natural width; opt in to column padding via `padTableColumns`. |
| Front matter uses one canonical YAML subset                  | `Canonicalized`                | Ambiguous or multiline strings use literal blocks; unsupported source stays raw.   |
| Underline serializes as `<ins>`                              | `Canonicalized`                | Semantic underline does not require alternate markdown spellings.                  |
| Superscript serializes as `<sup>`                            | `Canonicalized`                | Semantic superscript does not require alternate markdown spellings.                |
| Bold and italic serialize as `**` and `*`                    | `Canonicalized`                | `<strong>`/`<em>` only where `*` can't bind, as in `a<strong>"b"</strong>`.        |
| Marks serialize as spans                                     | `Canonicalized`                | One span runs across code, links and atoms, as in `**see [docs](url) here**`.      |
| Reference links serialize as inline links                    | `Canonicalized`                | Definitions are dropped on save, including `[//]: # (comment)` idioms.             |
| Setext headings and indented code save as `#` and fences     | `Canonicalized`                | The canonical dialect has one heading and one code block form.                     |
| Unsupported directives/raw content preserve authored payload | `Preserved as unsupported/raw` | Avoids destructive loss.                                                           |

## Translation Rules

These are the high-level parse/serialize invariants:

- Markdown is the persistence boundary.
- `Document` is the semantic truth.
- Multiple authored markdown spellings may map to the same semantic node.
- Serializer output is canonical markdown, not byte-for-byte source preservation, except for unsupported/raw preserved content.
- Markdown-only constructs with semantic meaning in Documint, such as the comment appendix and image width extension, are owned entirely by the markdown subsystem.

## Current Proof Sources

The current support claims are backed by these files:

- [AGENTS.md](./AGENTS.md): markdown subsystem ownership and policy
- [index.ts](./index.ts): public markdown boundary
- [parser/index.ts](./parser/index.ts): parser entrypoint and orchestration
- [parser/blocks.ts](./parser/blocks.ts): block-level markdown parsing into `Document`
- [parser/inlines.ts](./parser/inlines.ts): inline markdown parsing into semantic inline nodes
- [parser/references.ts](./parser/references.ts): link reference definitions and label lookup
- [parser/tables.ts](./parser/tables.ts): canonical table recognition helpers
- [parser/comments.ts](./parser/comments.ts): trailing comment-directive extraction
- [serializer/index.ts](./serializer/index.ts): document-level serialization orchestration and comment-directive emission
- [serializer/blocks.ts](./serializer/blocks.ts): block-level markdown emission from `Document`
- [serializer/inlines.ts](./serializer/inlines.ts): inline markdown emission
- [serializer/tables.ts](./serializer/tables.ts): canonical pipe-table emission
- [../../test/markdown/parser.test.ts](../../test/markdown/parser.test.ts): focused parse behavior
- [../../test/markdown/serializer.test.ts](../../test/markdown/serializer.test.ts): focused emission and canonicalization behavior
- [../../test/markdown/fragment.test.ts](../../test/markdown/fragment.test.ts): clipboard-fragment classification and persistence-boundary isolation
- [../../test/markdown/roundtrip.test.ts](../../test/markdown/roundtrip.test.ts): canonical round-tripping over goldens
- [../../test/goldens](../../test/goldens): scenario fixtures

## Recommended Next Additions

These are the most obvious high-value additions if the goal is to close modern markdown gaps that users may reasonably expect:

1. Autolinks
1. Ordered list `)` delimiters

## Intentional Non-Goals For Now

These are valid markdown features that we are deliberately not prioritizing because they are not part of the canonical Documint authoring dialect:

1. Tilde fences

## Product Position

Documint does not aim to be a maximally complete generic markdown engine.
It aims to support a clear, modern, canonical markdown dialect that matches the editor surface and preserves important unsupported authored constructs when possible.

In practice this means:

- Prefer ATX headings over setext headings
- Prefer backtick fences over tilde or indented code blocks
- Prefer inline links/images over reference-style link syntax
- Preserve raw/directive content when it cannot be modeled semantically
- Prioritize support for common modern imported markdown over obscure spec completeness
