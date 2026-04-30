// The markdown subsystem exposes two parse/serialize pairs:
//
//   - Document operations: round-trippable to the canonical markdown source
//     including front matter, comments, and trailing newline. Use these for
//     file save/load.
//   - Fragment operations: clipboard-shaped — no front matter, no comments,
//     no trailing newline.
//
// The semantic shapes (`Document`, `Fragment`) live in `src/document`; this
// subsystem only owns the text adapters between them and markdown source.

export type { MarkdownOptions } from "./shared";

export { parseDocument } from "./parser";
export { serializeDocument } from "./serializer";

export { parseFragment, serializeFragment } from "./fragment";
