/**
 * Owns document-level parsing orchestration: metadata preamble, then blocks, then
 * trailing comment-directive extraction, assembled into a normalized
 * `Document`. `parseFragment` bypasses the persistence-only concerns so
 * clipboard payloads don't silently lose a leading `---` to front-matter
 * detection or a trailing `:::documint-comments` to comment extraction. Block,
 * inline, table, and comment-directive parsing live in sibling modules.
 *
 * The `MarkdownLineCursor` primitive and the shared line helpers
 * (`currentLine`, `isBlankLine`) live here because every parser module
 * consumes them.
 */

import type { Document, DocumentMetadata, Fragment } from "@/document";
import { createDocument, isPlainTextBlocks } from "@/document";
import { lineFeed, type MarkdownOptions } from "../shared";
import { metadataFence, parseMetadataPreambleLines } from "../front-matter";
import { parseBlocks } from "./blocks";
import { extractCommentDirective } from "./comments";
import { createMarkdownParseContext } from "./context";

export function parseDocument(source: string, options: MarkdownOptions = {}): Document {
  const cursor = createCursor(source);

  const metadata = readMetadata(cursor);
  const blocks = parseRootBlocks(cursor, options);
  const { comments, blocks: contentBlocks } = extractCommentDirective(blocks);

  return createDocument(contentBlocks, comments, metadata);
}

/**
 * Parses clipboard markdown, classifying the result for paste routing:
 *   - Empty source → `text` with `""`, so paste is a no-op at the inline
 *     altitude instead of a structural splice of nothing.
 *   - Plain text (single unmarked paragraph) → `text`, the inline-replace
 *     fast path.
 *   - Marked inlines (single paragraph with marks/links/images/breaks) →
 *     `inlines`, an in-leaf inline splice.
 *   - Anything richer → `blocks`, the structural seam-merge.
 */
export function parseFragment(source: string, options: MarkdownOptions = {}): Fragment {
  if (source.length === 0) {
    return { kind: "text", text: "" };
  }

  const blocks = parseRootBlocks(createCursor(source), options);

  // Link reference definitions leave no blocks behind, so a paste of only
  // definitions inserts them as text rather than nothing.
  if (blocks.length === 0 && source.trim().length > 0) {
    return { kind: "text", text: source.trim() };
  }

  if (isPlainTextBlocks(blocks)) {
    return { kind: "text", text: blocks[0]?.plainText ?? "" };
  }

  if (blocks.length === 1 && blocks[0]?.type === "paragraph") {
    return { kind: "inlines", inlines: blocks[0].children };
  }

  return { kind: "blocks", blocks };
}

// Link reference definitions often follow the references that use them, as
// at the foot of most READMEs, so a source with any definitions parses a
// second time with all of them known.
function parseRootBlocks(cursor: MarkdownLineCursor, options: MarkdownOptions) {
  const start = cursor.index;
  const context = createMarkdownParseContext(options);
  const blocks = parseBlocks(cursor, context);

  if (context.linkReferences.size === 0) {
    return blocks;
  }

  cursor.index = start;
  return parseBlocks(cursor, context);
}

function readMetadata(cursor: MarkdownLineCursor): DocumentMetadata | null {
  const close = cursor.lines[0] === metadataFence ? cursor.lines.indexOf(metadataFence, 1) : -1;

  if (close < 0) {
    return null;
  }

  cursor.index = close + 1;
  return parseMetadataPreambleLines(cursor.lines.slice(1, close));
}

// --- Shared cursor and line helpers ---

export type MarkdownLineCursor = {
  index: number;
  lines: string[];
};

function createCursor(source: string): MarkdownLineCursor {
  const normalized = source.includes("\r") ? source.replace(/\r\n/g, lineFeed) : source;

  return {
    index: 0,
    lines: normalized.split(lineFeed),
  };
}

export function currentLine(cursor: MarkdownLineCursor) {
  return cursor.lines[cursor.index] ?? "";
}

export function isBlankLine(line: string) {
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character !== " " && character !== "\t") {
      return false;
    }
  }

  return true;
}
