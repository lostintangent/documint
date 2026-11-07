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
  getBlockChildren,
  type Block,
  type ListItemBlock,
} from "@/document";
import { blockquoteMarker, containerDirectiveClosingMarker, lineFeed } from "../shared";
import type { MarkdownParseContext } from "./context";
import { currentLine, isBlankLine, type MarkdownLineCursor } from "./index";
import { parseInlines } from "./inlines";
import { readLinkReferenceDefinitions } from "./references";
import { looksLikeTableRow, readAlignmentRow, readTable } from "./tables";

// --- Block-kind matchers, grouped by reader ---

// Headings
const atxHeading = /^(#{1,6})(?:\s+|$)(.*)$/;
const headingClosingSequence = /(?:^|\s+)#+\s*$/u;
// A line of `=` or `-` under paragraph text turns that text into a level 1 or
// 2 heading. A lone `-` stays an empty list item, since that's how the
// serializer writes one right after an item's text.
const setextUnderline = /^ {0,3}(?:=+|-{2,})[ \t]*$/;

// Lists
const listMarker = /^ {0,3}([-+*]|\d+\.)(?:\s+(.*)|\s*)$/;
const taskListMarker = /^\[( |x|X)\](?:\s|$)/;

// Fenced code. A backtick fence's info string can't hold a backtick, so an
// inline code span at line start stays text.
const fencedCodeOpening = /^(`{3,})([^\s`]*)(?:\s([^`]*))?$/;

// Indented code
const indentedCodeIndent = 4;

// Container directives
const containerDirectiveOpening = /^:::([A-Za-z][-\w]*)(.*)$/;

// Dividers (thematic breaks)
const divider = /^([-*_])(?:\s*\1){2,}$/;

// HTML blocks, as CommonMark's seven start conditions in spec order. The
// first five run through the line holding their closing marker, even across
// blank lines. The last two run until a blank line, and only the last (a
// lone complete tag, like `<a href="x">` or `<my-widget>`) can't interrupt a
// paragraph.
const htmlRawTextTagNames = "pre|script|style|textarea";
const htmlBlockTagNames =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|" +
  "dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|" +
  "header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|" +
  "param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const htmlAttribute = /\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?/.source;
const htmlBlockKinds = [
  {
    opening: new RegExp(`^<(?:${htmlRawTextTagNames})(?:\\s|>|$)`, "i"),
    closing: new RegExp(`</(?:${htmlRawTextTagNames})>`, "i"),
    interruptsParagraph: true,
  },
  { opening: /^<!--/, closing: /-->/, interruptsParagraph: true },
  { opening: /^<\?/, closing: /\?>/, interruptsParagraph: true },
  { opening: /^<![A-Za-z]/, closing: />/, interruptsParagraph: true },
  { opening: /^<!\[CDATA\[/, closing: /\]\]>/, interruptsParagraph: true },
  {
    opening: new RegExp(`^</?(?:${htmlBlockTagNames})(?:\\s|/?>|$)`, "i"),
    interruptsParagraph: true,
  },
  {
    opening: new RegExp(
      `^(?:<(?!(?:${htmlRawTextTagNames})[\\s/>])[A-Za-z][A-Za-z0-9-]*(?:${htmlAttribute})*\\s*/?>` +
        `|</(?!(?:${htmlRawTextTagNames})[\\s>])[A-Za-z][A-Za-z0-9-]*\\s*>)\\s*$`,
      "i",
    ),
    interruptsParagraph: false,
  },
];

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

    const block = readNextBlock(cursor, context);

    if (block) {
      blocks.push(block);
    }
  }

  return blocks;
}

function readNextBlock(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const line = currentLine(cursor);

  for (const reader of readersForLine(line) ?? []) {
    if (reader.canStart(line)) {
      const block = reader.read(cursor, context);
      if (block) {
        return block;
      }
    }
  }

  return readParagraph(cursor, context);
}

// Single source of truth for "what kinds of lines can start a block." The
// dispatcher (`readNextBlock`), the paragraph-interrupt predicate
// (`interruptsParagraph`) and the serializer's paragraph-line escape all read
// this table, so adding a block kind touches one entry. The dispatcher calls
// `read` once `canStart` passes, and only `readTable` can still decline.
// `readParagraph` is the catch-all, and returns null only for a paragraph that
// held nothing but link reference definitions.
//
// A line is only offered to readers whose `leadChars` include its first
// character, so only indented code, lists, and HTML blocks, which list a
// space, accept indentation.
//
// `interruptsParagraph` overrides the gate where a block can't interrupt a
// paragraph the way it starts one. A table's gate needs the next line to
// confirm, so only an alignment row interrupts. A lone complete HTML tag,
// indented code, and an ordered list past 1 can't interrupt at all.
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
    // The serializer escapes every leading space of a paragraph line, so the
    // block-start escape never sees one.
    leadChars: " ",
    canStart: (line) => countIndent(line) >= indentedCodeIndent,
    escapeParagraphStart: false,
    interruptsParagraph: () => false,
    read: readIndentedCode,
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
    canStart: (line) => divider.test(line.trim()),
    read: readDivider,
  },
  {
    leadChars: "|",
    canStart: looksLikeTableRow,
    interruptsParagraph: (line) => readAlignmentRow(line) !== null,
    read: readTable,
  },
  {
    // List markers may sit behind up to three spaces of indentation.
    leadChars: " -+*0123456789",
    canStart: (line) => readListMarker(line) !== null,
    interruptsParagraph: (line) => {
      const start = readListMarker(line)?.start;
      return start === null || start === 1;
    },
    read: readList,
  },
  {
    // HTML blocks may sit behind up to three spaces of indentation.
    leadChars: " <",
    canStart: (line) => findHtmlBlockKind(line) !== null,
    escapeParagraphStart: false,
    interruptsParagraph: (line) => findHtmlBlockKind(line)?.interruptsParagraph === true,
    read: readHtmlBlock,
  },
];

// Readers keyed by each of their `leadChars`, in table order.
const blockReadersByLeadChar = new Map<string, BlockReader[]>();

for (const reader of blockReaders) {
  for (const char of reader.leadChars) {
    blockReadersByLeadChar.set(char, [...(blockReadersByLeadChar.get(char) ?? []), reader]);
  }
}

function readersForLine(line: string) {
  return blockReadersByLeadChar.get(line[0] ?? "");
}

export function shouldEscapeParagraphLineStart(line: string) {
  // A wrapped line of only `=` or `-` would underline the lines above it.
  if (readSetextHeadingDepth(line) !== null) {
    return true;
  }

  return readersForLine(line)?.some(
    (reader) => reader.escapeParagraphStart !== false && reader.canStart(line),
  );
}

// --- Block readers, in dispatcher order ---
// Each runs only after its `canStart` passed, re-running the gate when it needs
// its captures, and advances the cursor past every consumed line. Per-reader
// helpers live immediately below their reader.

function readBlockquote(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const strippedLines: string[] = [];

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);

    if (!line.startsWith(blockquoteMarker)) {
      if (!readLazyLines(cursor, strippedLines, Infinity, context)) {
        break;
      }

      continue;
    }

    strippedLines.push(line.slice(line[1] === " " ? 2 : 1));
    cursor.index += 1;
  }

  return createBlockquoteBlock(parseBlocks({ index: 0, lines: strippedLines }, context));
}

function readFencedCode(cursor: MarkdownLineCursor) {
  const open = fencedCodeOpening.exec(currentLine(cursor))!;

  return createCodeBlock({
    language: open[2] || null,
    meta: open[3]?.trimStart() || null,
    source: readFencedBody(cursor, open[1]!),
  });
}

// Strips four columns of indentation from every line, keeping any deeper
// indentation as code. Blank lines continue the block, while trailing ones
// belong to whatever follows it.
function readIndentedCode(cursor: MarkdownLineCursor) {
  const lines: string[] = [];

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);

    if (!isBlankLine(line) && countIndent(line) < indentedCodeIndent) {
      break;
    }

    lines.push(line.slice(indentedCodeIndent));
    cursor.index += 1;
  }

  while (isBlankLine(lines[lines.length - 1]!)) {
    lines.pop();
  }

  return createCodeBlock({ language: null, meta: null, source: lines.join(lineFeed) });
}

function readContainerDirective(cursor: MarkdownLineCursor) {
  const [, name, suffix] = containerDirectiveOpening.exec(currentLine(cursor))!;
  const attributes = suffix.trim();

  return createDirectiveBlock({
    attributes:
      attributes.startsWith("{") && attributes.endsWith("}") ? attributes.slice(1, -1) : attributes,
    body: readFencedBody(cursor, containerDirectiveClosingMarker),
    name,
  });
}

function readHeading(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const match = atxHeading.exec(currentLine(cursor))!;
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
  const firstMarker = readListMarker(currentLine(cursor))!;
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

      // A blank line loosens the item when the next line is indented to its
      // content, even to open a nested list. Otherwise it ends the item, and
      // loosens the list when a sibling marker follows.
      if (isBlankLine(candidate)) {
        const nextIndex = findNextNonEmptyLineIndex(cursor.lines, cursor.index + 1);
        const nextLine = cursor.lines[nextIndex] ?? "";

        if (countIndent(nextLine) >= marker.contentIndent) {
          itemCompact = false;
          itemLines.push("");
          cursor.index += 1;
          continue;
        }

        if (readListMarker(nextLine)?.ordered === firstMarker.ordered) {
          compact = false;
          cursor.index = nextIndex;
        }

        break;
      }

      // Under-indented lines, including a sibling marker, end the item and
      // yield to the outer loop, unless they lazily continue its paragraph.
      if (countIndent(candidate) < marker.contentIndent) {
        if (!readLazyLines(cursor, itemLines, marker.contentIndent, context)) {
          break;
        }

        continue;
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
    start: firstMarker.start,
  });
}

function readListMarker(line: string) {
  const match = listMarker.exec(line);

  if (!match) {
    return null;
  }

  const marker = match[1];
  const ordered = marker.endsWith(".");
  const start = ordered ? Number(marker.slice(0, -1)) : null;
  let content = match[2] ?? "";
  let checked: boolean | null = null;
  // Children align to the list marker, not the task checkbox, which belongs to
  // the item's first line. An item that opens on a blank line indents one
  // column past its marker. Both are measured from column 0, so indented
  // markers carry their indentation into their children.
  const contentIndent =
    content.length > 0 ? line.length - content.length : countIndent(line) + marker.length + 1;

  if (taskListMarker.test(content)) {
    checked = content[1] === "x" || content[1] === "X";
    // Text after the checkbox is the item's paragraph, never indented code.
    content = content.slice(3).trimStart();
  }

  return { checked, content, contentIndent, ordered, start };
}

// An empty list item still gets one empty paragraph child so downstream
// consumers can treat every list item uniformly as a block container.
function parseListItemChildren(lines: string[], context: MarkdownParseContext) {
  const blocks = parseBlocks({ index: 0, lines }, context);
  return blocks.length > 0 ? blocks : [createParagraphBlock([])];
}

// Keeps the block's lines verbatim, apart from the first line's indentation,
// which would otherwise shift a list item's content column on save. An
// unclosed block runs to the end of its container, minus trailing blank lines.
function readHtmlBlock(cursor: MarkdownLineCursor) {
  const kind = findHtmlBlockKind(currentLine(cursor))!;
  const lines: string[] = [];

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);

    if (!kind.closing && isBlankLine(line)) {
      break;
    }

    lines.push(lines.length === 0 ? line.trimStart() : line);
    cursor.index += 1;

    if (kind.closing?.test(line)) {
      break;
    }
  }

  while (isBlankLine(lines.at(-1)!)) {
    lines.pop();
  }

  return createRawBlock({
    originalType: "html",
    source: lines.join(lineFeed),
  });
}

// A setext underline ends the paragraph and turns its text into a heading,
// winning over the divider that `---` would otherwise interrupt with.
function readParagraph(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const lines: string[] = [];
  let headingDepth: 1 | 2 | null = null;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);

    if (isBlankLine(line)) {
      break;
    }

    if (lines.length > 0) {
      headingDepth = readSetextHeadingDepth(line);

      if (headingDepth !== null || interruptsParagraph(line)) {
        break;
      }
    }

    lines.push(line);
    cursor.index += 1;
  }

  // Link reference definitions can only open a paragraph, and they leave no
  // block behind. Without paragraph text above it, an underline is read as
  // its own block.
  const source = readLinkReferenceDefinitions(lines.join(lineFeed), context);

  if (source.length === 0) {
    return null;
  }

  if (headingDepth === null) {
    return createParagraphBlock(parseInlines(source, context));
  }

  // The heading saves on one `#` line, so its wrapped lines join with a space.
  cursor.index += 1;
  return createHeadingBlock({
    children: parseInlines(source.trim().replace(/\s*\n\s*/g, " "), context),
    depth: headingDepth,
  });
}

function interruptsParagraph(line: string) {
  return readersForLine(line)?.some((reader) =>
    reader.interruptsParagraph ? reader.interruptsParagraph(line) : reader.canStart(line),
  );
}

// --- Low-level line utilities ---
// Line helpers shared by several readers or the paragraph-interrupt predicate.
// Cursor-bound helpers (`currentLine`, `isBlankLine`) live in `./index`, since
// the table parser shares them.

function countIndent(line: string) {
  let indent = 0;

  while (indent < line.length && line[indent] === " ") {
    indent += 1;
  }

  return indent;
}

// Consumes the opening line, then every line up to and including the closing
// line (or to the end of input when the fence never closes), and returns the
// lines in between. A closing line repeats `closing`'s character at least as
// many times.
function readFencedBody(cursor: MarkdownLineCursor, closing: string) {
  const body: string[] = [];
  cursor.index += 1;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);
    const fence = line.trim();
    cursor.index += 1;

    if (fence.startsWith(closing) && fence === closing[0]!.repeat(fence.length)) {
      break;
    }

    body.push(line);
  }

  return body.join(lineFeed);
}

// Moves lazy continuation lines, like `b` in `> a\nb`, into a container's
// `lines`. They lack the container's `>` or indentation but continue the
// paragraph that ends `lines`, however deeply nested. A run stops at a line
// indented to `contentIndent`, which is the container's own again, and at any
// line that would start a block, including every list marker. Each run
// reparses the container so far, which is quadratic in lazy runs per
// container. Real documents don't come close.
function readLazyLines(
  cursor: MarkdownLineCursor,
  lines: string[],
  contentIndent: number,
  context: MarkdownParseContext,
) {
  let end = cursor.index;

  for (; end < cursor.lines.length; end += 1) {
    const line = cursor.lines[end]!;

    if (
      isBlankLine(line) ||
      countIndent(line) >= contentIndent ||
      readListMarker(line) ||
      interruptsParagraph(line)
    ) {
      break;
    }
  }

  if (
    end === cursor.index ||
    isBlankLine(lines.at(-1)!) ||
    !endsInParagraph(parseBlocks({ index: 0, lines }, context))
  ) {
    return false;
  }

  // A lazy line is paragraph text even when it looks like a setext underline.
  for (; cursor.index < end; cursor.index += 1) {
    const line = currentLine(cursor);
    lines.push(readSetextHeadingDepth(line) === null ? line : `\\${line.trimStart()}`);
  }

  return true;
}

function endsInParagraph(blocks: Block[]): boolean {
  const last = blocks.at(-1);
  const children = last && getBlockChildren(last);

  return children ? endsInParagraph(children) : last?.type === "paragraph";
}

function findNextNonEmptyLineIndex(lines: string[], start: number) {
  for (let index = start; index < lines.length; index += 1) {
    if (!isBlankLine(lines[index] ?? "")) {
      return index;
    }
  }

  return -1;
}

function readSetextHeadingDepth(line: string) {
  return setextUnderline.test(line) ? (line.includes("=") ? 1 : 2) : null;
}

function findHtmlBlockKind(line: string) {
  const indent = countIndent(line);

  if (indent > 3 || line[indent] !== "<") {
    return null;
  }

  const candidate = line.slice(indent);
  return htmlBlockKinds.find((kind) => kind.opening.test(candidate)) ?? null;
}
