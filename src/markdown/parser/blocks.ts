/**
 * Owns line-oriented block parsing for the Documint markdown dialect.
 */

import {
  createBlockquoteBlock,
  createCodeBlock,
  createDirectiveBlock,
  createDividerBlock,
  createHeadingBlock,
  createListBlock,
  createListItemBlock,
  createParagraphBlock,
  createRawBlock,
  type Block,
  type ListItemBlock,
} from "@/document";
import {
  blockquoteMarker,
  containerDirectiveClosingMarker,
  fencedCodeMarker,
  lineFeed,
} from "../shared";
import type { MarkdownParseContext } from "./context";
import { currentLine, isBlankLine, type MarkdownLineCursor } from "./index";
import { parseInlines } from "./inlines";
import { looksLikeTableRow, readAlignmentRow, readTable } from "./tables";

// --- Block-kind matchers, grouped by reader ---

// Headings
const atxHeading = /^(#{1,6})\s+(.*)$/;
const headingClosingSequence = /\s+#+\s*$/u;

// Lists
const listMarker = /^([-+*]|\d+\.)(?:\s+(.*)|\s*)$/;
const taskListMarker = /^\[( |x|X)\](?:\s|$)/;

// Fenced code
const fencedCodeOpening = /^```([^\s`]*)?(?:\s+(.*))?$/;

// Container directives
const containerDirectiveOpening = /^:::([A-Za-z][-\w]*)(.*)$/;

// Dividers (thematic breaks)
const dividerPatterns = [/^(\*\s*){3,}$/, /^(-\s*){3,}$/, /^(_\s*){3,}$/];

export function parseBlocks(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const blocks: Block[] = [];

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);

    // Also skips the phantom trailing "" that `split("\n")` leaves when the
    // source ends with a newline.
    if (isBlankLine(line)) {
      cursor.index += 1;
      continue;
    }

    blocks.push(readNextBlock(cursor, context));
  }

  return blocks;
}

function readNextBlock(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const line = currentLine(cursor);

  // Fast-reject: paragraph lines (anything starting with a non-trigger char)
  // skip the eight-entry reader walk and go straight to `readParagraph`.
  const first = line[0];
  if (first === undefined || !blockTriggerLeadChars.includes(first)) {
    return readParagraph(cursor, context);
  }

  for (const reader of blockReaders) {
    if (reader.canStart(line)) {
      const block = reader.read(cursor, context);
      if (block) {
        return block;
      }
    }
  }

  return readParagraph(cursor, context);
}

// Single source of truth for "what kinds of lines can start a block." Both
// the dispatcher (`readNextBlock`) and the paragraph-interrupt predicate
// (`interruptsParagraph`) read from this table, so adding a block kind
// requires touching exactly one entry. The dispatcher tries readers in
// order and calls `read` once `canStart` passes. Only `readTable` can still
// decline (return null), in which case the dispatcher continues.
// `readParagraph` is the catch-all.
//
// `leadChars` is the set of first-line characters this reader's `canStart`
// may fire on. The union across readers feeds `blockTriggerLeadChars` (the
// fast-reject used by dispatcher, paragraph-interrupt, and the serializer's
// paragraph escape) so the set can't drift from the predicates that consume
// it.
//
// Tables are the one asymmetric case: their dispatcher gate needs the next
// line (the alignment row) to confirm, while the paragraph-interrupt
// heuristic only sees the current line — hence `interruptsParagraph` is the
// weaker "looks like an alignment divider" check.
type BlockReader = {
  leadChars: string;
  canStart(line: string): boolean;
  escapeParagraphStart?: boolean;
  interruptsParagraph?: (line: string) => boolean;
  read(cursor: MarkdownLineCursor, context: MarkdownParseContext): Block | null;
};

const blockReaders: BlockReader[] = [
  {
    leadChars: blockquoteMarker,
    canStart: (line) => line.startsWith(blockquoteMarker),
    read: readBlockquote,
  },
  {
    leadChars: "`",
    canStart: (line) => fencedCodeOpening.test(line),
    read: readFencedCode,
  },
  {
    leadChars: ":",
    canStart: (line) => containerDirectiveOpening.test(line),
    read: readContainerDirective,
  },
  {
    leadChars: "#",
    canStart: (line) => atxHeading.test(line),
    read: readHeading,
  },
  {
    leadChars: "*-_",
    canStart: (line) => isDivider(line.trim()),
    read: readDivider,
  },
  {
    leadChars: "|",
    canStart: looksLikeTableRow,
    interruptsParagraph: (line) => readAlignmentRow(line) !== null,
    read: readTable,
  },
  {
    leadChars: "-+*0123456789",
    canStart: (line) => readListMarker(line) !== null,
    read: readList,
  },
  {
    leadChars: "<",
    canStart: (line) => looksLikeSimpleHtmlBlock(line.trim()),
    escapeParagraphStart: false,
    read: readRawHtml,
  },
];

// Union of every reader's `leadChars`, deduplicated. Built once at module
// load and consumed by:
//   - the dispatcher (`readNextBlock`) fast-reject,
//   - the paragraph-interrupt (`interruptsParagraph`) fast-reject,
//   - the serializer's paragraph-line escape fast-reject (imported across
//     the subsystem boundary).
// Order isn't significant — every consumer uses `.includes(char)`.
const blockTriggerLeadChars = [
  ...new Set(blockReaders.flatMap((reader) => Array.from(reader.leadChars))),
].join("");

export function shouldEscapeParagraphLineStart(line: string) {
  const first = line[0];

  if (first === undefined || !blockTriggerLeadChars.includes(first)) {
    return false;
  }

  return blockReaders.some((reader) => {
    return reader.escapeParagraphStart !== false && reader.canStart(line);
  });
}

// --- Block readers, in dispatcher order ---
// Each runs only after its `canStart` passed and advances the cursor past every
// consumed line. Readers that need the gate's captures re-run it to narrow, and
// only `readTable` can still decline (return `null`) so the dispatcher tries the
// next reader. `readParagraph` is the catch-all and never returns null. Per-reader helpers
// live immediately below their reader; helpers shared with other readers (and
// with `interruptsParagraph`) live in the low-level utilities section.

function readBlockquote(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const strippedLines: string[] = [];

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);

    if (isBlankLine(line)) {
      strippedLines.push("");
      cursor.index += 1;
      continue;
    }

    if (!line.startsWith(blockquoteMarker)) {
      break;
    }

    let stripped = line.slice(1);

    if (stripped.startsWith(" ")) {
      stripped = stripped.slice(1);
    }

    strippedLines.push(stripped);
    cursor.index += 1;
  }

  return createBlockquoteBlock(parseBlocks({ index: 0, lines: strippedLines }, context));
}

function readFencedCode(cursor: MarkdownLineCursor) {
  const open = fencedCodeOpening.exec(currentLine(cursor));

  if (!open) {
    return null;
  }

  return createCodeBlock({
    language: open[1] ? open[1] : null,
    meta: open[2] ? open[2] : null,
    source: readFencedBody(cursor, fencedCodeMarker),
  });
}

function readContainerDirective(cursor: MarkdownLineCursor) {
  const startMatch = containerDirectiveOpening.exec(currentLine(cursor));

  if (!startMatch) {
    return null;
  }

  return createDirectiveBlock({
    attributes: parseDirectiveAttributes(startMatch[2] ?? ""),
    body: readFencedBody(cursor, containerDirectiveClosingMarker),
    name: startMatch[1]!,
  });
}

function parseDirectiveAttributes(suffix: string) {
  const trimmed = suffix.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function readHeading(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const match = atxHeading.exec(currentLine(cursor));

  if (!match) {
    return null;
  }

  cursor.index += 1;
  return createHeadingBlock({
    children: parseInlines(match[2].replace(headingClosingSequence, ""), context),
    depth: match[1].length as 1 | 2 | 3 | 4 | 5 | 6,
  });
}

function readDivider(cursor: MarkdownLineCursor) {
  cursor.index += 1;
  return createDividerBlock();
}

function readList(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const firstMarker = readListMarker(currentLine(cursor));

  if (!firstMarker) {
    return null;
  }

  const items: ListItemBlock[] = [];
  let compact = true;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);
    const marker = readListMarker(line);

    if (!marker || marker.ordered !== firstMarker.ordered) {
      break;
    }

    cursor.index += 1;
    const itemLines = [marker.content];
    let itemCompact = true;

    while (cursor.index < cursor.lines.length) {
      const candidate = currentLine(cursor);

      if (isBlankLine(candidate)) {
        const blankLine = classifyListBlankLine(cursor, firstMarker.ordered);
        if (blankLine.kind === "next-item") {
          compact = false;
          cursor.index = blankLine.nextIndex;
          break;
        }

        if (blankLine.kind === "end-item") {
          break;
        }

        itemCompact = false;
        itemLines.push("");
        cursor.index += 1;
        continue;
      }

      // Under-indented lines, including a sibling marker at column 0, end the
      // item and yield to the outer loop.
      if (countIndent(candidate) < marker.contentIndent) {
        break;
      }

      itemLines.push(candidate.slice(marker.contentIndent));
      cursor.index += 1;
    }

    compact &&= itemCompact;

    items.push(
      createListItemBlock({
        checked: marker.checked,
        children: parseListItemChildren(itemLines, context),
        compact: itemCompact,
      }),
    );
  }

  return createListBlock({
    compact,
    items,
    ordered: firstMarker.ordered,
    start:
      firstMarker.ordered && context.options.preserveOrderedListStart
        ? (firstMarker.start ?? 1)
        : null,
  });
}

type ListBlankLineClassification =
  | { kind: "end-item" }
  | { kind: "loosen-item" }
  | { kind: "next-item"; nextIndex: number };

function classifyListBlankLine(
  cursor: MarkdownLineCursor,
  ordered: boolean,
): ListBlankLineClassification {
  const nextIndex = findNextNonEmptyLineIndex(cursor.lines, cursor.index + 1);

  if (nextIndex < 0) {
    return { kind: "end-item" };
  }

  const nextLine = cursor.lines[nextIndex] ?? "";
  const nextMarker = readListMarker(nextLine);

  if (nextMarker && nextMarker.ordered === ordered) {
    return { kind: "next-item", nextIndex };
  }

  return countIndent(nextLine) === 0 ? { kind: "end-item" } : { kind: "loosen-item" };
}

type ParsedListMarker = {
  checked: boolean | null;
  content: string;
  contentIndent: number;
  ordered: boolean;
  start: number | null;
};

function readListMarker(line: string): ParsedListMarker | null {
  // Fast-reject: only `-`, `+`, `*`, or a digit in the first column can lead
  // a list marker. The regex below would otherwise scan the whole line for
  // every continuation/non-marker line inside `readList`'s loop. The
  // dispatcher's per-line fast-reject already protects the entry point; this
  // guards the inner callers.
  const candidate = line[0];
  if (
    candidate === undefined ||
    (candidate !== "-" &&
      candidate !== "+" &&
      candidate !== "*" &&
      !(candidate >= "0" && candidate <= "9"))
  ) {
    return null;
  }

  const match = listMarker.exec(line);

  if (!match) {
    return null;
  }

  const marker = match[1];
  const ordered = marker.endsWith(".");
  const start = ordered ? Number(marker.slice(0, -1)) : null;
  let content = match[2] ?? "";
  let checked: boolean | null = null;

  if (taskListMarker.test(content)) {
    checked = content[1] === "x" || content[1] === "X";
    content = content.slice(3);

    if (content.startsWith(" ")) {
      content = content.slice(1);
    }
  }

  const separatorWidth = match[0].length - marker.length - content.length;

  return {
    checked,
    content,
    contentIndent: marker.length + separatorWidth,
    ordered,
    start,
  };
}

function parseListItemChildren(lines: string[], context: MarkdownParseContext) {
  const blocks = parseBlocks({ index: 0, lines }, context);

  // An empty list item still gets one empty paragraph child so downstream
  // consumers can treat every list item uniformly as a block container.
  if (blocks.length > 0) {
    return blocks;
  }

  return [createParagraphBlock([])];
}

function readRawHtml(cursor: MarkdownLineCursor) {
  const line = currentLine(cursor).trim();

  cursor.index += 1;
  return createRawBlock({
    originalType: "html",
    source: line,
  });
}

function readParagraph(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const lines: string[] = [];

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);

    if (isBlankLine(line)) {
      break;
    }

    if (lines.length > 0 && interruptsParagraph(line)) {
      break;
    }

    lines.push(line);
    cursor.index += 1;
  }

  return createParagraphBlock(parseInlines(lines.join(lineFeed), context));
}

function interruptsParagraph(line: string) {
  // Fast-reject: paragraph slurp continues through lines whose first
  // character can't possibly start a sibling block. Same lead-char set the
  // dispatcher uses; mirrors the early-out in `readNextBlock`.
  const first = line[0];
  if (first === undefined || !blockTriggerLeadChars.includes(first)) {
    return false;
  }

  // Driven by the same `blockReaders` table the dispatcher uses, so the two
  // can never drift out of sync. `interruptsParagraph` overrides the gate
  // for readers that interpret paragraph-interrupt differently than their
  // dispatcher entry (today: tables).
  return blockReaders.some((reader) =>
    reader.interruptsParagraph ? reader.interruptsParagraph(line) : reader.canStart(line),
  );
}

// --- Low-level line utilities ---
// Block-specific line helpers for indent measurement, fenced bodies, and
// line-shape recognition. The recognition helpers (`isDivider`,
// `looksLikeSimpleHtmlBlock`) are shared between their reader and the
// paragraph-interrupt predicate, which is why they live here rather than
// adjacent to a single reader. Cursor-bound helpers (`currentLine`,
// `isBlankLine`) live in `./index` since they're shared with the table
// parser.

function countIndent(line: string) {
  let indent = 0;

  while (indent < line.length && line[indent] === " ") {
    indent += 1;
  }

  return indent;
}

// Consumes the opening line, then every line up to and including the
// `closing` line (or to the end of input when the fence never closes), and
// returns the lines in between.
function readFencedBody(cursor: MarkdownLineCursor, closing: string) {
  const body: string[] = [];
  cursor.index += 1;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);
    cursor.index += 1;

    if (line.trim() === closing) {
      break;
    }

    body.push(line);
  }

  return body.join(lineFeed);
}

function findNextNonEmptyLineIndex(lines: string[], start: number) {
  for (let index = start; index < lines.length; index += 1) {
    if (!isBlankLine(lines[index] ?? "")) {
      return index;
    }
  }

  return -1;
}

function isDivider(line: string) {
  return dividerPatterns.some((pattern) => pattern.test(line));
}

function looksLikeSimpleHtmlBlock(line: string) {
  return line.startsWith("<") && line.endsWith(">");
}
