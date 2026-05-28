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
import { type MarkdownParseContext, withBaseIndent } from "./context";
import { currentLine, isBlankLine, sliceIndentedContent, type MarkdownLineCursor } from "./index";
import { parseInlines } from "./inlines";
import { looksLikeAlignmentRow, looksLikeTableRow, readTable } from "./tables";

// A line indented more than this many spaces past the enclosing container's
// indent terminates the current parse pass — that lets nested containers stop
// slurping when the user has clearly fallen out of them. The choice of `3`
// mirrors CommonMark's four-space rule for indented code blocks: anything
// indented `baseIndent + 4` or more would, in a CommonMark engine, switch into
// indented-code parsing, so we hand back to the caller at that threshold even
// though Documint itself doesn't emit indented code blocks.
const maxContainerIndentSlack = 3;

// --- Block-kind matchers, grouped by reader ---

// Headings
const atxHeading = /^(#{1,6})\s+(.*)$/;
const headingClosingSequence = /\s+#+\s*$/u;

// Lists
const listMarker = /^(\s*)([-+*]|\d+\.)(?:\s+(.*)|\s*)$/;
const orderedListMarker = /^\d+\.$/;
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

    // Skip the phantom trailing element produced by `source.split("\n")` when
    // the source ends with a newline.
    if (cursor.index === cursor.lines.length - 1 && line === "") {
      break;
    }

    if (isBlankLine(line)) {
      cursor.index += 1;
      continue;
    }

    // Line is indented past the budget for this nesting level — break so the
    // caller can decide what to do with it.
    if (countIndent(line) > context.baseIndent + maxContainerIndentSlack) {
      break;
    }

    const block = readNextBlock(cursor, context);
    if (!block) {
      break;
    }

    blocks.push(block);
  }

  return blocks;
}

function readNextBlock(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const line = currentLine(cursor);
  const content = sliceIndentedContent(line, context.baseIndent);

  // Fast-reject: paragraph lines (anything starting with a non-trigger char)
  // skip the eight-entry reader walk and go straight to `readParagraph`.
  const first = content[0];
  if (first === undefined || !blockTriggerLeadChars.includes(first)) {
    return readParagraph(cursor, context);
  }

  for (const reader of blockReaders) {
    if (reader.canStart(line, content, context)) {
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
// order; each `read` may decline (return null) if its full gate fails, in
// which case the dispatcher continues. `readParagraph` is the catch-all.
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
  canStart(line: string, content: string, context: MarkdownParseContext): boolean;
  escapeParagraphStart?: boolean;
  interruptsParagraph?: (
    line: string,
    content: string,
    context: MarkdownParseContext,
  ) => boolean;
  read(cursor: MarkdownLineCursor, context: MarkdownParseContext): Block | null;
};

const blockReaders: BlockReader[] = [
  {
    leadChars: blockquoteMarker,
    canStart: (_line, content) => content.startsWith(blockquoteMarker),
    read: readBlockquote,
  },
  {
    leadChars: "`",
    canStart: (_line, content) => fencedCodeOpening.test(content),
    read: readFencedCode,
  },
  {
    leadChars: ":",
    canStart: (_line, content) => containerDirectiveOpening.test(content),
    read: readContainerDirective,
  },
  {
    leadChars: "#",
    canStart: (_line, content) => atxHeading.test(content),
    read: readHeading,
  },
  {
    leadChars: "*-_",
    canStart: (_line, content) => isDivider(content.trim()),
    read: readDivider,
  },
  {
    leadChars: "|",
    canStart: (_line, content) => looksLikeTableRow(content),
    interruptsParagraph: (_line, content) => looksLikeAlignmentRow(content),
    read: readTable,
  },
  {
    leadChars: "-+*0123456789",
    canStart: (line, _content, context) => readListMarker(line, context.baseIndent) !== null,
    read: readList,
  },
  {
    leadChars: "<",
    canStart: (_line, content) => looksLikeSimpleHtmlBlock(content.trim()),
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
export const blockTriggerLeadChars = [
  ...new Set(blockReaders.flatMap((reader) => [...reader.leadChars])),
].join("");

const rootParagraphEscapeContext: MarkdownParseContext = {
  baseIndent: 0,
  options: {},
  resourceProtocols: new Set(),
};

export function shouldEscapeParagraphLineStart(line: string) {
  const first = line[0];

  if (first === undefined || !blockTriggerLeadChars.includes(first)) {
    return false;
  }

  return blockReaders.some((reader) => {
    return (
      reader.escapeParagraphStart !== false &&
      reader.canStart(line, line, rootParagraphEscapeContext)
    );
  });
}

// --- Block readers, in dispatcher order ---
// Each returns a parsed Block on a successful match (advancing the cursor past
// every consumed line) or `null` to let the dispatcher try the next reader.
// `readParagraph` is the catch-all and never returns null. Per-reader helpers
// live immediately below their reader; helpers shared with other readers (and
// with `interruptsParagraph`) live in the low-level utilities section.

function readBlockquote(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const firstLine = currentLine(cursor);

  if (!sliceIndentedContent(firstLine, context.baseIndent).startsWith(blockquoteMarker)) {
    return null;
  }

  const strippedLines: string[] = [];

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);
    const indent = countIndent(line);

    if (isBlankLine(line)) {
      strippedLines.push("");
      cursor.index += 1;
      continue;
    }

    if (indent < context.baseIndent) {
      break;
    }

    const content = sliceIndentedContent(line, context.baseIndent);

    if (!content.startsWith(blockquoteMarker)) {
      break;
    }

    let stripped = content.slice(1);

    if (stripped.startsWith(" ")) {
      stripped = stripped.slice(1);
    }

    strippedLines.push(stripped);
    cursor.index += 1;
  }

  return createBlockquoteBlock(
    parseBlocks({ index: 0, lines: strippedLines }, withBaseIndent(context, 0)),
  );
}

function readFencedCode(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const line = currentLine(cursor);
  const trimmed = sliceIndentedContent(line, context.baseIndent);
  const open = fencedCodeOpening.exec(trimmed);

  if (!open) {
    return null;
  }

  cursor.index += 1;
  const body: string[] = [];

  while (cursor.index < cursor.lines.length) {
    const candidate = currentLine(cursor);
    const content = sliceIndentedContent(candidate, context.baseIndent);

    if (content.trim() === fencedCodeMarker) {
      cursor.index += 1;
      break;
    }

    body.push(content);
    cursor.index += 1;
  }

  return createCodeBlock({
    language: open[1] ? open[1] : null,
    meta: open[2] ? open[2] : null,
    source: body.join(lineFeed),
  });
}

function readContainerDirective(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const startLine = currentLine(cursor);
  const startContent = sliceIndentedContent(startLine, context.baseIndent);
  const startMatch = containerDirectiveOpening.exec(startContent);

  if (!startMatch) {
    return null;
  }

  const name = startMatch[1]!;
  const bodyLines: string[] = [];
  cursor.index += 1;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);
    const content = sliceIndentedContent(line, context.baseIndent);

    if (content.trim() === containerDirectiveClosingMarker) {
      cursor.index += 1;
      break;
    }

    bodyLines.push(content);
    cursor.index += 1;
  }

  return createDirectiveBlock({
    attributes: parseDirectiveAttributes(startMatch[2] ?? ""),
    body: bodyLines.join(lineFeed),
    name,
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
  const line = currentLine(cursor);
  const match = atxHeading.exec(sliceIndentedContent(line, context.baseIndent));

  if (!match) {
    return null;
  }

  cursor.index += 1;
  return createHeadingBlock({
    children: parseInlines(match[2].replace(headingClosingSequence, ""), context),
    depth: match[1].length as 1 | 2 | 3 | 4 | 5 | 6,
  });
}

function readDivider(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const trimmed = sliceIndentedContent(currentLine(cursor), context.baseIndent).trim();

  if (!isDivider(trimmed)) {
    return null;
  }

  cursor.index += 1;
  return createDividerBlock();
}

function readList(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const firstMarker = readListMarker(currentLine(cursor), context.baseIndent);

  if (!firstMarker) {
    return null;
  }

  const items: ListItemBlock[] = [];
  let spread = false;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);
    const marker = readListMarker(line, context.baseIndent);

    if (!marker || marker.ordered !== firstMarker.ordered) {
      break;
    }

    cursor.index += 1;
    const itemLines = [marker.content];
    let itemSpread = false;

    while (cursor.index < cursor.lines.length) {
      const candidate = currentLine(cursor);
      const candidateIndent = countIndent(candidate);

      if (isBlankLine(candidate)) {
        // Stay inside the item only if the next non-blank line is still
        // nested past `baseIndent` — otherwise the blank line ends the item.
        const nextIndex = findNextNonEmptyLineIndex(cursor.lines, cursor.index + 1);

        if (nextIndex < 0 || countIndent(cursor.lines[nextIndex] ?? "") <= context.baseIndent) {
          break;
        }

        itemSpread = true;
        itemLines.push("");
        cursor.index += 1;
        continue;
      }

      if (candidateIndent < marker.contentIndent) {
        break;
      }

      // Sibling list marker at the list's base indent — yield to the outer
      // loop so it can start the next item.
      if (candidateIndent === context.baseIndent && readListMarker(candidate, context.baseIndent)) {
        break;
      }

      itemLines.push(sliceIndentedLine(candidate, marker.contentIndent));
      cursor.index += 1;
    }

    spread ||= itemSpread;

    items.push(
      createListItemBlock({
        checked: marker.checked,
        children: parseListItemChildren(itemLines, context),
        spread: itemSpread,
      }),
    );
  }

  return createListBlock({
    items,
    ordered: firstMarker.ordered,
    spread,
    start:
      firstMarker.ordered && context.options.preserveOrderedListStart
        ? (firstMarker.start ?? 1)
        : null,
  });
}

type ParsedListMarker = {
  checked: boolean | null;
  content: string;
  contentIndent: number;
  ordered: boolean;
  start: number | null;
};

function readListMarker(line: string, baseIndent: number): ParsedListMarker | null {
  // Fast-reject: only `-`, `+`, `*`, or a digit at the expected indent
  // column can lead a list marker. The regex below would otherwise scan
  // the whole line for every continuation/non-marker line inside
  // `readList`'s loop. The dispatcher's per-line fast-reject already
  // protects the entry point; this guards the inner callers.
  const candidate = line[baseIndent];
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

  if (!match || match[1].length !== baseIndent) {
    return null;
  }

  const marker = match[2];
  const ordered = orderedListMarker.test(marker);
  const start = ordered ? Number(marker.slice(0, -1)) : null;
  let content = match[3] ?? "";
  let checked: boolean | null = null;

  if (taskListMarker.test(content)) {
    checked = content[1] === "x" || content[1] === "X";
    content = content.slice(3);

    if (content.startsWith(" ")) {
      content = content.slice(1);
    }
  }

  const separatorWidth = match[0].length - match[1].length - match[2].length - content.length;

  return {
    checked,
    content,
    contentIndent: baseIndent + match[2].length + separatorWidth,
    ordered,
    start,
  };
}

function parseListItemChildren(lines: string[], context: MarkdownParseContext) {
  const blocks = parseBlocks({ index: 0, lines }, withBaseIndent(context, 0));

  // An empty list item still gets one empty paragraph child so downstream
  // consumers can treat every list item uniformly as a block container.
  if (blocks.length > 0) {
    return blocks;
  }

  return [createParagraphBlock([])];
}

function readRawHtml(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const line = sliceIndentedContent(currentLine(cursor), context.baseIndent).trim();

  if (!looksLikeSimpleHtmlBlock(line)) {
    return null;
  }

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
    const indent = countIndent(line);

    if (isBlankLine(line)) {
      break;
    }

    if (indent < context.baseIndent) {
      break;
    }

    const content = sliceIndentedContent(line, context.baseIndent);

    if (lines.length > 0 && interruptsParagraph(line, content, context)) {
      break;
    }

    lines.push(content);
    cursor.index += 1;
  }

  return createParagraphBlock(parseInlines(lines.join(lineFeed), context));
}

function interruptsParagraph(line: string, content: string, context: MarkdownParseContext) {
  // Fast-reject: paragraph slurp continues through lines whose first
  // character can't possibly start a sibling block. Same lead-char set the
  // dispatcher uses; mirrors the early-out in `readNextBlock`.
  const first = content[0];
  if (first === undefined || !blockTriggerLeadChars.includes(first)) {
    return false;
  }

  // Driven by the same `blockReaders` table the dispatcher uses, so the two
  // can never drift out of sync. `interruptsParagraph` overrides the gate
  // for readers that interpret paragraph-interrupt differently than their
  // dispatcher entry (today: tables).
  return blockReaders.some((reader) =>
    (reader.interruptsParagraph ?? reader.canStart)(line, content, context),
  );
}

// --- Low-level line utilities ---
// Block-specific line helpers for indent measurement, slicing, and line-shape
// recognition. The recognition helpers (`isDivider`,
// `looksLikeSimpleHtmlBlock`) are shared between their reader and the
// paragraph-interrupt predicate, which is why they live here rather than
// adjacent to a single reader. Cursor-bound helpers (`currentLine`,
// `isBlankLine`, `sliceIndentedContent`) live in `./index` since they're
// shared with the table parser.

function countIndent(line: string) {
  let indent = 0;

  while (indent < line.length && line[indent] === " ") {
    indent += 1;
  }

  return indent;
}

function sliceIndentedLine(line: string, contentIndent: number) {
  // Continuation lines for list items may be less indented than the item's
  // declared content column — accept them anyway, treating an under-indented
  // non-blank line as if it were aligned at the column it actually has.
  const indent = countIndent(line);

  if (indent >= contentIndent) {
    return line.slice(contentIndent);
  }

  return line.trim() === "" ? "" : line.slice(Math.min(indent, contentIndent));
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
