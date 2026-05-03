/**
 * Owns document-level serialization orchestration: front matter, then blocks,
 * then the trailing comment-directive appendix, joined with the canonical
 * block separator and terminated with a trailing newline. Block, inline, and
 * table serialization live in sibling modules.
 */

import type { Document } from "@/document";
import { commentDirectiveName, lineFeed, type MarkdownOptions } from "../shared";
import { blockSeparator, renderDirective, serializeBlocks } from "./blocks";

export { serializeBlocks } from "./blocks";
export { serializeInlines } from "./inlines";

/**
 * Serializes a full document, including front matter and trailing comment
 * directive, into canonical markdown source. Always terminates with a
 * trailing newline unless the document is entirely empty.
 */
export function serializeDocument(document: Document, options: MarkdownOptions = {}) {
  if (
    document.blocks.length === 0 &&
    document.comments.length === 0 &&
    document.frontMatter === undefined
  ) {
    return "";
  }

  const chunks: string[] = [];

  if (document.frontMatter !== undefined) {
    chunks.push(document.frontMatter);
  }

  if (document.blocks.length > 0) {
    chunks.push(serializeBlocks(document.blocks, options));
  }

  if (document.comments.length > 0) {
    chunks.push(serializeCommentDirective(document.comments));
  }

  const result = chunks.join(blockSeparator);

  return result.endsWith(lineFeed) ? result : `${result}${lineFeed}`;
}

// The trailing comment appendix is markdown-only — comment threads have no
// generic representation outside markdown persistence — so the emitter lives
// here next to its only caller (`serializeDocument`) rather than getting its
// own module like the parser side, where extraction logic earns one.
function serializeCommentDirective(comments: Document["comments"]) {
  return renderDirective({
    attributes: "",
    body: JSON.stringify(comments, null, 2),
    name: commentDirectiveName,
  });
}
