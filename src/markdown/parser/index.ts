/**
 * Owns document-level parsing orchestration: metadata preamble, then blocks, then
 * trailing comment-directive extraction, assembled into a normalized
 * `Document`. The fragment-altitude entry (`parseFragmentBlocks`) bypasses
 * the persistence-only concerns so clipboard payloads don't silently lose a
 * leading `---` to front-matter detection or a trailing
 * `:::documint-comments` to comment extraction. Block, inline, table, and
 * comment-directive parsing live in sibling modules.
 *
 * The `MarkdownLineCursor` primitive and the shared cursor/line helpers
 * (`currentLine`, `peekLine`, `isBlankLine`) live here because every parser
 * module consumes them.
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
  const context = createMarkdownParseContext(options);

  const metadata = readMetadata(cursor);
  const blocks = parseBlocks(cursor, context);
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

  const cursor = createCursor(source);
  const context = createMarkdownParseContext(options);

  const blocks = parseBlocks(cursor, context);

  if (isPlainTextBlocks(blocks)) {
    return { kind: "text", text: blocks[0]?.plainText ?? "" };
  }

  if (blocks.length === 1 && blocks[0]?.type === "paragraph") {
    return { kind: "inlines", inlines: blocks[0].children };
  }

  return { kind: "blocks", blocks };
}

function readMetadata(cursor: MarkdownLineCursor): DocumentMetadata | null {
  if (cursor.lines[0] !== metadataFence) {
    return null;
  }

  for (let close = 1; close < cursor.lines.length; close += 1) {
    if (cursor.lines[close] === metadataFence) {
      const metadata = parseMetadataPreambleLines(cursor.lines.slice(1, close));
      cursor.index = close + 1;
      return metadata;
    }
  }

  return null;
}

// --- Shared cursor and line helpers ---
// Used by every parser module. Block-specific helpers (indent measurement,
// list-continuation slicing, line-shape recognition) live in `./blocks`.

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
  return peekLine(cursor, 0);
}

// Reads a line at a positive offset from the cursor without advancing it. Used
// by readers (e.g. tables) that need a single line of lookahead to decide
// whether to start consuming.
export function peekLine(cursor: MarkdownLineCursor, offset: number) {
  return cursor.lines[cursor.index + offset] ?? "";
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
