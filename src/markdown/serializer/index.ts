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
    chunks.push(serializeCommentAppendix(document.comments));
  }

  const result = chunks.join(blockSeparator);
  return result.endsWith(lineFeed) ? result : `${result}${lineFeed}`;
}

// The trailing comment appendix is markdown-only: comment threads have no
// generic representation outside markdown persistence. Exposed for sync code
// that needs canonical appendix text without serializing a full document.
export function serializeCommentAppendix(comments: Document["comments"]) {
  if (comments.length === 0) {
    return "";
  }

  return renderDirective({
    attributes: "",
    body: JSON.stringify(comments.map(serializeCommentThread), null, 2),
    name: commentDirectiveName,
  });
}

function serializeCommentThread({ id: _id, ...thread }: Document["comments"][number]) {
  return thread;
}
