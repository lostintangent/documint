/**
 * Owns document-level parsing orchestration: front matter, then blocks, then
 * trailing comment-directive extraction, assembled into a normalized
 * `Document`. The fragment-altitude entry (`parseFragmentBlocks`) bypasses
 * the persistence-only concerns so clipboard payloads don't silently lose a
 * leading `---` to front-matter detection or a trailing
 * `:::documint-comments` to comment extraction. Block, inline, table, and
 * comment-directive parsing live in sibling modules.
 *
 * The `MarkdownLineCursor` primitive and the shared cursor/line helpers
 * (`currentLine`, `peekLine`, `isBlankLine`, `sliceIndentedContent`) live
 * here because every parser module consumes them.
 */

import type { Block, Document } from "@/document";
import { createDocument } from "@/document";
import { lineFeed, type MarkdownOptions } from "../shared";
import { parseBlocks } from "./blocks";
import { extractCommentDirective } from "./comments";

export type MarkdownLineCursor = {
  index: number;
  lines: string[];
};

const frontMatterFence = "---";

export function parseDocument(source: string, options: MarkdownOptions = {}): Document {
  const cursor = createCursor(source);
  const frontMatter = readFrontMatter(cursor);
  const blocks = parseBlocks(cursor, 0, options);
  const { comments, blocks: contentBlocks } = extractCommentDirective(blocks);

  return createDocument(contentBlocks, comments, frontMatter);
}

// Fragment-altitude parsing. Skips the persistence concerns `parseDocument`
// owns (front matter detection, comment-directive extraction, document
// normalization) so a clipboard payload like `---\n…\n---` does not silently
// lose its leading divider as front matter, and a trailing
// `:::documint-comments` directive isn't stripped from the fragment. The
// returned blocks have unnormalized ids; that's fine because every paste
// path splices them into a `Document`, which re-normalizes.
export function parseFragmentBlocks(source: string, options: MarkdownOptions = {}): Block[] {
  return parseBlocks(createCursor(source), 0, options);
}

function createCursor(source: string): MarkdownLineCursor {
  return {
    index: 0,
    lines: source.replace(/\r\n/g, lineFeed).split(lineFeed),
  };
}

// Front matter is positionally significant: only a `---` on line 0 with a
// matching closing `---` qualifies. Anything else (including a lone leading
// `---`) falls through to the regular block parser as a divider.
function readFrontMatter(cursor: MarkdownLineCursor): string | undefined {
  if (cursor.lines[0] !== frontMatterFence) {
    return undefined;
  }

  for (let close = 1; close < cursor.lines.length; close += 1) {
    if (cursor.lines[close] === frontMatterFence) {
      const source = cursor.lines.slice(0, close + 1).join(lineFeed);
      cursor.index = close + 1;
      return source;
    }
  }

  return undefined;
}

// --- Shared cursor and line helpers ---
// Used by every parser module. Block-specific helpers (indent measurement,
// list-continuation slicing, line-shape recognition) live in `./blocks`.

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
  return line.trim() === "";
}

export function sliceIndentedContent(line: string, indent: number) {
  return line.slice(indent);
}
