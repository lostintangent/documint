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
  type MarkdownOptions,
} from "../shared";
import {
  currentLine,
  isBlankLine,
  sliceIndentedContent,
  type MarkdownLineCursor,
} from "./index";
import { parseInlineMarkdown } from "./inlines";
import { looksLikeAlignmentRow, readTable } from "./tables";

// A line indented more than this many spaces past the enclosing container's
// indent terminates the current parse pass — that lets nested containers stop
// slurping when the user has clearly fallen out of them.
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

export function parseBlocks(
  cursor: MarkdownLineCursor,
  baseIndent: number,
  options: MarkdownOptions,
) {
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
    if (countIndent(line) > baseIndent + maxContainerIndentSlack) {
      break;
    }

    const block = readNextBlock(cursor, baseIndent, options);
    if (!block) {
      break;
    }

    blocks.push(block);
  }

  return blocks;
}

function readNextBlock(cursor: MarkdownLineCursor, baseIndent: number, options: MarkdownOptions) {
  return (
    readBlockquote(cursor, baseIndent, options) ??
    readFencedCode(cursor, baseIndent) ??
    readContainerDirective(cursor, baseIndent) ??
    readHeading(cursor, baseIndent) ??
    readDivider(cursor, baseIndent) ??
    readTable(cursor, baseIndent) ??
    readList(cursor, baseIndent, options) ??
    readRawHtmlBlock(cursor, baseIndent) ??
    readParagraph(cursor, baseIndent)
  );
}

// --- Block readers, in dispatcher order ---
// Each returns a parsed Block on a successful match (advancing the cursor past
// every consumed line) or `null` to let the dispatcher try the next reader.
// `readParagraph` is the catch-all and never returns null. Per-reader helpers
// live immediately below their reader; helpers shared with other readers (and
// with `shouldParagraphStop`) live in the low-level utilities section.

function readBlockquote(cursor: MarkdownLineCursor, baseIndent: number, options: MarkdownOptions) {
  const firstLine = currentLine(cursor);

  if (!sliceIndentedContent(firstLine, baseIndent).startsWith(blockquoteMarker)) {
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

    if (indent < baseIndent) {
      break;
    }

    const content = sliceIndentedContent(line, baseIndent);

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

  return createBlockquoteBlock({
    children: parseBlocks({ index: 0, lines: strippedLines }, 0, options),
  });
}

function readFencedCode(cursor: MarkdownLineCursor, baseIndent: number) {
  const line = currentLine(cursor);
  const trimmed = sliceIndentedContent(line, baseIndent);
  const open = fencedCodeOpening.exec(trimmed);

  if (!open) {
    return null;
  }

  cursor.index += 1;
  const body: string[] = [];

  while (cursor.index < cursor.lines.length) {
    const candidate = currentLine(cursor);
    const content = sliceIndentedContent(candidate, baseIndent);

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

function readContainerDirective(cursor: MarkdownLineCursor, baseIndent: number) {
  const startLine = currentLine(cursor);
  const startContent = sliceIndentedContent(startLine, baseIndent);
  const startMatch = containerDirectiveOpening.exec(startContent);

  if (!startMatch) {
    return null;
  }

  const name = startMatch[1]!;
  const bodyLines: string[] = [];
  cursor.index += 1;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);
    const content = sliceIndentedContent(line, baseIndent);

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

function readHeading(cursor: MarkdownLineCursor, baseIndent: number) {
  const line = currentLine(cursor);
  const match = atxHeading.exec(sliceIndentedContent(line, baseIndent));

  if (!match) {
    return null;
  }

  cursor.index += 1;
  return createHeadingBlock({
    children: parseInlineMarkdown(match[2].replace(headingClosingSequence, "")),
    depth: match[1].length as 1 | 2 | 3 | 4 | 5 | 6,
  });
}

function readDivider(cursor: MarkdownLineCursor, baseIndent: number) {
  const trimmed = sliceIndentedContent(currentLine(cursor), baseIndent).trim();

  if (!isDivider(trimmed)) {
    return null;
  }

  cursor.index += 1;
  return createDividerBlock();
}

function readList(cursor: MarkdownLineCursor, baseIndent: number, options: MarkdownOptions) {
  const firstMarker = readListMarker(currentLine(cursor), baseIndent);

  if (!firstMarker) {
    return null;
  }

  const items: ListItemBlock[] = [];
  let spread = false;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);
    const marker = readListMarker(line, baseIndent);

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

        if (nextIndex < 0 || countIndent(cursor.lines[nextIndex] ?? "") <= baseIndent) {
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
      if (candidateIndent === baseIndent && readListMarker(candidate, baseIndent)) {
        break;
      }

      itemLines.push(sliceIndentedLine(candidate, marker.contentIndent));
      cursor.index += 1;
    }

    spread ||= itemSpread;

    items.push(
      createListItemBlock({
        checked: marker.checked,
        children: parseListItemChildren(itemLines, options),
        spread: itemSpread,
      }),
    );
  }

  return createListBlock({
    items,
    ordered: firstMarker.ordered,
    spread,
    start:
      firstMarker.ordered && options.preserveOrderedListStart ? (firstMarker.start ?? 1) : null,
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

function parseListItemChildren(lines: string[], options: MarkdownOptions) {
  const blocks = parseBlocks({ index: 0, lines }, 0, options);

  // An empty list item still gets one empty paragraph child so downstream
  // consumers can treat every list item uniformly as a block container.
  if (blocks.length > 0) {
    return blocks;
  }

  return [createParagraphBlock({ children: [] })];
}

function readRawHtmlBlock(cursor: MarkdownLineCursor, baseIndent: number) {
  const line = sliceIndentedContent(currentLine(cursor), baseIndent).trim();

  if (!looksLikeSimpleHtmlBlock(line)) {
    return null;
  }

  cursor.index += 1;
  return createRawBlock({
    originalType: "html",
    source: line,
  });
}

function readParagraph(cursor: MarkdownLineCursor, baseIndent: number) {
  const lines: string[] = [];

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);
    const indent = countIndent(line);

    if (isBlankLine(line)) {
      break;
    }

    if (indent < baseIndent) {
      break;
    }

    const content = sliceIndentedContent(line, baseIndent);

    if (lines.length > 0 && shouldParagraphStop(line, content, baseIndent)) {
      break;
    }

    lines.push(content);
    cursor.index += 1;
  }

  return createParagraphBlock({
    children: parseInlineMarkdown(lines.join(lineFeed)),
  });
}

function shouldParagraphStop(line: string, content: string, baseIndent: number) {
  // Paragraphs slurp lines until the next line could start any other block
  // kind — keep this list aligned with the readers in `readNextBlock`.
  const trimmed = content.trim();
  return (
    content.startsWith(blockquoteMarker) ||
    fencedCodeOpening.test(content) ||
    containerDirectiveOpening.test(content) ||
    atxHeading.test(content) ||
    isDivider(trimmed) ||
    looksLikeAlignmentRow(content) ||
    readListMarker(line, baseIndent) !== null ||
    looksLikeSimpleHtmlBlock(trimmed)
  );
}

// --- Low-level line utilities ---
// Block-specific line helpers for indent measurement, slicing, and line-shape
// recognition. The recognition helpers (`isDivider`,
// `looksLikeSimpleHtmlBlock`) are shared between their reader and the
// paragraph-stop predicate, which is why they live here rather than adjacent
// to a single reader. Cursor-bound helpers (`currentLine`, `isBlankLine`,
// `sliceIndentedContent`) live in `./index` since they're shared with the
// table parser.

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
