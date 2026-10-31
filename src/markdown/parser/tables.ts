/**
 * Owns canonical GFM-style table parsing and helper logic.
 */
import { createTableBlock, createTableCell, createTableRow } from "@/document";
import { currentLine, isBlankLine, peekLine, type MarkdownLineCursor } from "./index";
import { parseInlines } from "./inlines";
import type { MarkdownParseContext } from "./context";

const tableAlignmentCell = /^:?-+:?$/;

// --- Public exports ---

// The dispatcher only calls this once `looksLikeTableRow` accepted the header
// line, so the alignment row is the only thing left to confirm.
export function readTable(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const align = readAlignmentRow(peekLine(cursor, 1));

  if (!align) {
    return null;
  }

  const rows = [splitTableRow(currentLine(cursor))];
  cursor.index += 2;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);

    if (isBlankLine(line) || !looksLikeTableRow(line)) {
      break;
    }

    rows.push(splitTableRow(line));
    cursor.index += 1;
  }

  return createTableBlock({
    align,
    rows: rows.map((row) =>
      createTableRow(row.map((cell) => createTableCell(parseInlines(cell, context)))),
    ),
  });
}

// Returns the column alignments when `line` is an alignment row, else null.
export function readAlignmentRow(line: string) {
  // Verify the row shape before splitting so the speculative path
  // (`interruptsParagraph` on an ordinary paragraph line) bails without
  // allocating split/map intermediates.
  if (!looksLikeTableRow(line)) {
    return null;
  }

  const cells = splitTableRow(line);

  if (!cells.every((cell) => tableAlignmentCell.test(cell))) {
    return null;
  }

  return cells.map((cell) => {
    if (cell.startsWith(":")) {
      return cell.endsWith(":") ? "center" : "left";
    }

    return cell.endsWith(":") ? "right" : null;
  });
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

// Caller must have already verified `line` is a pipe-fenced row via
// `looksLikeTableRow`. Returns the trimmed cell list (always at least one
// cell), splitting only on unescaped pipes so `a \| b` stays one semantic
// cell.
function splitTableRow(line: string) {
  const cells: string[] = [];
  const body = line.trim().slice(1, -1);
  let cellStart = 0;

  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "\\") {
      index += 1;
      continue;
    }

    if (body[index] === "|") {
      cells.push(body.slice(cellStart, index).trim());
      cellStart = index + 1;
    }
  }

  cells.push(body.slice(cellStart).trim());
  return cells;
}
