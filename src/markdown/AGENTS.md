# Markdown

This sub-system owns the markdown parsing/serialization boundary. Its job is to turn markdown source into `Document`, and to turn `Document` back into markdown, which allows the editor to operate on documents in a completely format-agnostic way.

The two main operations in this subsystem are:

- `parseMarkdown(source) -> Document`
- `serializeMarkdown(document) -> string`

### Key Files

- `index.ts` - Owns the public markdown API. `parseMarkdown(...)` runs markdown source through `remark` and then translates mdast into `Document`; `serializeMarkdown(...)` translates `Document` back to mdast and then stringifies markdown.

- `to-document.ts` - Owns the mdast-to-`Document` translation, including ordinary block/inline mapping plus markdown-only normalization like comment appendix extraction, directive preservation through semantic unsupported nodes, underline/image-width adaptation, and blank task-item handling.

- `from-document.ts` - Owns the `Document`-to-mdast translation, including ordinary block/inline mapping plus markdown-only emission like comment appendices, underline/image-width markup, and raw preservation of unsupported markdown content.

- `remark/index.ts` - Owns the lower-level `remark` parse and stringify pipelines, the shared tree-rewrite orchestration for remark extensions, and internal markdown formatting defaults used during serialization.

- `remark/image-width.ts` - Owns the image-width child-transform logic plus the image stringify handler that appends `{width=...}` when semantic image width is present.

- `remark/task-list.ts` - Owns task-list-specific markdown stringify behavior so empty semantic task items still serialize to explicit checkbox markers.

- `remark/underline.ts` - Owns the underline child-transform logic plus the inline serialization helper for `<ins>...</ins>` markup.

Keep the standard markdown mapping explicit and switch-based inside `to-document.ts` and `from-document.ts`. Put remark-specific parse plugins and stringify handlers in `src/markdown/remark` instead of inventing a generalized markdown feature system. Generic markdown directives belong to this layer, not to `src/document`; preserve them as unsupported semantic content unless and until Documint grows an explicit semantic feature for them.

Comment threads are persisted through the markdown appendix syntax here, but comment schema and repair semantics belong to `src/comments`, not to this layer.
