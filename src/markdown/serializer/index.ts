/**
 * Owns document-level serialization orchestration: metadata preamble, then blocks,
 * then the trailing comment-directive appendix, joined with the canonical
 * block separator and terminated with a trailing newline. Block, inline, and
 * table serialization live in sibling modules.
 */

import type { Document, Fragment } from "@/document";
import { serializeMetadataPreamble } from "../front-matter";
import { commentDirectiveName, lineFeed, type MarkdownOptions } from "../shared";
import { blockSeparator, renderDirective, serializeBlocks } from "./blocks";
import { serializeInlines } from "./inlines";

export { serializeBlocks } from "./blocks";

/**
 * Serializes a full document, including metadata and trailing comment
 * directive, into canonical markdown source. Always terminates with a
 * trailing newline unless the document is entirely empty.
 */
export function serializeDocument(document: Document, options: MarkdownOptions = {}) {
  if (
    document.blocks.length === 0 &&
    document.comments.length === 0 &&
    document.metadata === null
  ) {
    return "";
  }

  const chunks: string[] = [];

  const metadataPreamble = serializeMetadataPreamble(document.metadata);

  if (metadataPreamble.length > 0) {
    chunks.push(metadataPreamble);
  }

  if (document.blocks.length > 0) {
    const blocks = serializeBlocks(document.blocks, options);
    // A leading `---` would reload as front matter, so an opening divider saves as `***`.
    const body =
      document.metadata === null && document.blocks[0].type === "divider"
        ? blocks.replace("---", "***")
        : blocks;

    // Metadata-only documents do not need an empty serialized body.
    if (body.length > 0 || document.metadata === null) {
      chunks.push(body);
    }
  }

  if (document.comments.length > 0) {
    chunks.push(serializeCommentAppendix(document.comments));
  }

  const result = chunks.join(blockSeparator);
  return result.endsWith(lineFeed) ? result : `${result}${lineFeed}`;
}

export function serializeFragment(fragment: Fragment): string {
  switch (fragment.kind) {
    case "text":
      return fragment.text;

    case "inlines":
      return serializeInlines(fragment.inlines);

    case "blocks":
      return serializeBlocks(fragment.blocks);
  }
}

// The trailing comment appendix is markdown-only: comment threads have no
// generic representation outside markdown persistence.
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
