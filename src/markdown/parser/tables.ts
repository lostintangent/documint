/**
 * Owns canonical GFM-style table parsing and helper logic.
 */
import { createTableBlock, createTableCell, createTableRow } from "@/document";
import {
  currentLine,
  isBlankLine,
  peekLine,
  sliceIndentedContent,
  type MarkdownLineCursor,
} from "./index";
import { parseInlines } from "./inlines";
import type { MarkdownParseContext } from "./context";

const tableAlignmentCell = /^:?-+:?$/;

// --- Public exports ---

export function readTable(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const headerLine = currentLine(cursor);
  const alignLine = peekLine(cursor, 1);
  const headerContent = sliceIndentedContent(headerLine, context.baseIndent);
  const alignmentContent = sliceIndentedContent(alignLine, context.baseIndent);

  if (!looksLikeTableRow(headerContent) || !looksLikeAlignmentRow(alignmentContent)) {
    return null;
  }

  const rows = [splitTableRow(headerContent)];
  const align = parseAlignmentRow(alignmentContent);
  cursor.index += 2;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);
    const content = sliceIndentedContent(line, context.baseIndent);

    if (isBlankLine(line) || !looksLikeTableRow(content)) {
      break;
    }

    rows.push(splitTableRow(content));
    cursor.index += 1;
  }

  return createTableBlock({
    align,
    rows: rows.map((row) =>
      createTableRow(row.map((cell) => createTableCell(parseInlines(cell, context)))),
    ),
  });
}

export function looksLikeAlignmentRow(line: string) {
  // Verify the row shape before splitting so the speculative path
  // (`interruptsParagraph` on an ordinary paragraph line) bails without
  // allocating split/map intermediates.
  if (!looksLikeTableRow(line)) {
    return false;
  }

  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => tableAlignmentCell.test(cell.trim()));
}

// Cheap header-line check shared with `parser/blocks.ts` for the
// table reader's dispatcher gate. The full table detection still requires
// the next line to be an alignment row — that confirmation lives in
// `readTable`.
export function looksLikeTableRow(line: string) {
  const trimmed = line.trim();

  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

// --- Internal helpers ---

function parseAlignmentRow(line: string) {
  return splitTableRow(line).map((cell) => {
    const trimmed = cell.trim();

    if (trimmed.startsWith(":") && trimmed.endsWith(":")) {
      return "center";
    }

    if (trimmed.startsWith(":")) {
      return "left";
    }

    if (trimmed.endsWith(":")) {
      return "right";
    }

    return null;
  });
}

// Caller must have already verified `line` is a pipe-fenced row via
// `looksLikeTableRow`. Returns the trimmed cell list. Every call site —
// `readTable` (twice), `looksLikeAlignmentRow`, `parseAlignmentRow` —
// pre-gates with `looksLikeTableRow` (directly or transitively), so the
// boundary check that used to live here was always redundant on the path
// that reached it.
function splitTableRow(line: string) {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}
