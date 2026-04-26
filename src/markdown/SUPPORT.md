# Markdown Support Matrix

This file defines the markdown feature surface Documint currently cares about.
It is intentionally narrower than full CommonMark or full GitHub Flavored Markdown.

The markdown subsystem owns three concerns:

- Parse authored markdown into the semantic `Document` model
- Serialize semantic `Document` snapshots back to canonical markdown
- Preserve unsupported authored syntax losslessly when it matters

The semantic boundary is defined by [../document/types.ts](../document/types.ts). If a feature cannot be represented by that model, the markdown subsystem must either preserve it as semantic `unsupported` content or declare it out of scope.

## Status Legend

- `Supported semantically`: parsed into `Document` and serialized back in canonical form
- `Preserved as unsupported/raw`: not understood semantically, but retained losslessly
- `Canonicalized`: supported, but authored syntax may serialize to a different canonical form
- `Intentional non-goal`: valid markdown feature we are deliberately not prioritizing
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
- Inline code
- Links
- Images
- Text marks: bold, italic, strikethrough, underline
- Unsupported/raw block and inline content
- Comment appendix payload

## Block Features

| Feature                            | Example                                    | Status                         | Notes                                                                                  |
| ---------------------------------- | ------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------- |
| ATX headings                       | `## Heading`                               | `Supported semantically`       | Maps directly to heading depth 1-6.                                                    |
| Setext headings                    | `Heading` + `---` / `===`                  | `Intentional non-goal`         | Valid markdown, but not part of the canonical Documint authoring dialect.              |
| Paragraphs                         | plain text blocks                          | `Supported semantically`       | Canonical serialization preserves blank-line-separated block structure.                |
| Blockquotes                        | `> quote`                                  | `Supported semantically`       | Nested block structure is supported.                                                   |
| Bullet lists                       | `- item`                                   | `Supported semantically`       | Canonical serializer emits `-`.                                                        |
| Alternate bullet markers           | `* item`, `+ item`                         | `Canonicalized`                | Parse support exists; serializer normalizes to `-`.                                    |
| Ordered lists with `.`             | `1. item`                                  | `Supported semantically`       | Canonical serializer repeats the same marker number.                                   |
| Ordered lists with `)`             | `1) item`                                  | `Gap`                          | Reasonable imported markdown syntax; still worth considering.                          |
| Ordered list authored starts       | `3. item`                                  | `Supported semantically`       | Preserved only when `preserveOrderedListStart` is enabled; otherwise canonicalized.    |
| Task lists                         | `- [ ] item`                               | `Supported semantically`       | Blank task items are preserved.                                                        |
| Nested task lists                  | nested checkbox items                      | `Supported semantically`       | Covered by tests and editor behavior.                                                  |
| Tight vs loose lists               | blank lines between items                  | `Supported semantically`       | Represented through list/list-item `spread`.                                           |
| Fenced code blocks with backticks  | ` ```ts `                                  | `Supported semantically`       | Language/meta round-trip.                                                              |
| Fenced code blocks with tildes     | `~~~`                                      | `Intentional non-goal`         | Valid markdown, but backtick fences are the canonical Documint syntax.                 |
| Indented code blocks               | 4-space indented code                      | `Intentional non-goal`         | Valid markdown, but not part of the canonical Documint authoring dialect.              |
| Thematic breaks                    | `***`, `---`, `___`                        | `Supported semantically`       | Serializer canonicalizes to `***`.                                                     |
| GFM tables                         | pipe tables                                | `Supported semantically`       | Alignment is supported; serializer emits canonical pipe tables.                        |
| Flexible table forms               | edge-valid GFM table syntax                | `Gap`                          | Current parser handles the canonical table shape, not the full GFM acceptance surface. |
| HTML blocks, simple single-line    | `<aside>...</aside>`                       | `Preserved as unsupported/raw` | Preserved as unsupported semantic blocks.                                              |
| HTML blocks, full CommonMark forms | multi-line HTML block start/end conditions | `Gap`                          | Spec coverage is broader than current implementation.                                  |
| Directives                         | `:::callout`, `::badge`                    | `Preserved as unsupported/raw` | Intentionally preserved rather than modeled semantically.                              |
| Comment appendix directive         | `:::documint-comments`                     | `Supported semantically`       | Special markdown-only translation into `Document.comments`.                            |

## Inline Features

| Feature                              | Example                          | Status                         | Notes                                                                                                |
| ------------------------------------ | -------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Plain text                           | `text`                           | `Supported semantically`       | Base inline content.                                                                                 |
| Bold                                 | `**bold**`                       | `Supported semantically`       | Canonical serializer emits `**`.                                                                     |
| Italic                               | `*italic*`                       | `Supported semantically`       | Canonical serializer emits `*`.                                                                      |
| Strikethrough                        | `~~strike~~`                     | `Supported semantically`       | GFM extension.                                                                                       |
| Underline                            | `<ins>underline</ins>`           | `Supported semantically`       | Markdown-only convention; serializes back as `<ins>`.                                                |
| Inline code                          | `` `code` ``                     | `Supported semantically`       | Serializer expands fence width when needed.                                                          |
| Inline links                         | `[label](url "title")`           | `Supported semantically`       | Inline destination/title only.                                                                       |
| Inline images                        | `![alt](url "title")`            | `Supported semantically`       | Width extension supported separately.                                                                |
| Image width extension                | `![x](url){width=320}`           | `Supported semantically`       | Documint-specific markdown policy.                                                                   |
| Invalid width extension preservation | `{width=0}` etc.                 | `Supported semantically`       | Invalid width stays plain text in the paragraph stream.                                              |
| Raw inline HTML                      | inline tags other than `<ins>`   | `Preserved as unsupported/raw` | Preserved where encountered, not modeled semantically.                                               |
| Text directives                      | `:badge[text]{...}`              | `Preserved as unsupported/raw` | Preserved as unsupported inline nodes.                                                               |
| Hard line breaks                     | two-space break / explicit break | `Gap`                          | Common in imported prose markdown and worth deciding explicitly.                                     |
| Soft line breaks                     | newline in paragraph             | `Canonicalized`                | Preserved through paragraph text shape as needed for current canonical output.                       |
| Autolinks in angle brackets          | `<https://example.com>`          | `Gap`                          | Common modern markdown input; likely worth supporting.                                               |
| GFM bare autolinks                   | `www.example.com`                | `Gap`                          | Common modern markdown input; likely worth supporting.                                               |
| Reference-style links                | `[a][b]` + `[b]: ...`            | `Gap`                          | Not currently supported.                                                                             |
| Entity/numeric references            | `&amp;`, `&#x20;`                | `Gap`                          | Serializer emits `&#x20;` in some canonical cases, but full parse/normalize support is not explicit. |
| Full CommonMark emphasis rules       | nested delimiter edge cases      | `Gap`                          | Current parser supports the product surface, not the full delimiter algorithm.                       |

## Serialization Policy

These behaviors are intentional even when authored input has multiple valid spellings:

| Policy                                                       | Status                         | Notes                                                                              |
| ------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------- |
| Bullet lists serialize with `-`                              | `Canonicalized`                | We do not preserve `*` or `+`.                                                     |
| Thematic breaks serialize as `***`                           | `Canonicalized`                | Multiple valid forms normalize to one.                                             |
| Ordered lists repeat the same visible marker number          | `Canonicalized`                | Matches existing subsystem behavior.                                               |
| Ordered list start preservation is opt-in                    | `Canonicalized`                | Controlled by `preserveOrderedListStart`.                                          |
| Tables serialize with compact cells by default               | `Canonicalized`                | Cells emit at their natural width; opt in to column padding via `padTableColumns`. |
| Underline serializes as `<ins>`                              | `Canonicalized`                | Semantic underline does not require alternate markdown spellings.                  |
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
- [parser/inline.ts](./parser/inline.ts): inline markdown parsing into semantic inline nodes
- [parser/tables.ts](./parser/tables.ts): canonical table recognition helpers
- [parser/comments.ts](./parser/comments.ts): trailing comment-directive extraction
- [serializer.ts](./serializer.ts): canonical markdown emission from `Document`
- [../../test/markdown/parse.test.ts](../../test/markdown/parse.test.ts): focused parse behavior
- [../../test/markdown/policy.test.ts](../../test/markdown/policy.test.ts): markdown-specific policy behavior
- [../../test/markdown/roundtrip.test.ts](../../test/markdown/roundtrip.test.ts): canonical round-tripping over goldens
- [../../test/goldens](../../test/goldens): scenario fixtures

## Recommended Next Additions

These are the most obvious high-value additions if the goal is to close modern markdown gaps that users may reasonably expect:

1. Hard line breaks
2. Autolinks
3. Reference-style links
4. Ordered list `)` delimiters
5. Broader HTML block handling

## Intentional Non-Goals For Now

These are valid markdown features that we are deliberately not prioritizing because they are not part of the canonical Documint authoring dialect:

1. Setext headings
2. Tilde fences
3. Indented code blocks

## Product Position

Documint does not aim to be a maximally complete generic markdown engine.
It aims to support a clear, modern, canonical markdown dialect that matches the editor surface and preserves important unsupported authored constructs when possible.

In practice this means:

- Prefer ATX headings over setext headings
- Prefer backtick fences over tilde or indented code blocks
- Prefer inline links/images over reference-style link syntax
- Preserve raw/directive content when it cannot be modeled semantically
- Prioritize support for common modern imported markdown over obscure spec completeness

## Non-Goals For Now

Unless product requirements change, the markdown subsystem does not need to become a full generic Markdown engine. The goal is:

- Complete support for the markdown surface Documint uses
- Canonical, deterministic serialization
- Lossless preservation for unsupported authored constructs that must survive round-trip
- Clear explicit declaration of anything outside that surface
