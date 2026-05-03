import type { Document } from "@/document";
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
  const lines = source.replace(/\r\n/g, lineFeed).split(lineFeed);
  const cursor: MarkdownLineCursor = {
    index: 0,
    lines,
  };

  const frontMatter = readFrontMatter(cursor);
  const blocks = parseBlocks(cursor, 0, options);
  const { comments, blocks: contentBlocks } = extractCommentDirective(blocks);

  return createDocument(contentBlocks, comments, frontMatter);
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
