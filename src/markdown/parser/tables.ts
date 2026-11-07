/**
 * Owns canonical GFM-style table parsing and helper logic.
 */
import { createTableBlock, createTableCell, createTableRow } from "@/document";
import { currentLine, type MarkdownLineCursor } from "./index";
import { parseInlines } from "./inlines";
import type { MarkdownParseContext } from "./context";

const tableAlignmentCell = /^:?-+:?$/;

// --- Public exports ---

// The dispatcher only calls this once `looksLikeTableRow` accepted the header
// line, so the alignment row is the only thing left to confirm.
export function readTable(cursor: MarkdownLineCursor, context: MarkdownParseContext) {
  const align = readAlignmentRow(cursor.lines[cursor.index + 1] ?? "");

  if (!align) {
    return null;
  }

  const rows = [splitTableRow(currentLine(cursor))];
  cursor.index += 2;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);

    if (!looksLikeTableRow(line)) {
      break;
    }

    rows.push(splitTableRow(line));
    cursor.index += 1;
  }

  // Short rows get empty cells, as in GFM. Rows with extra cells keep them, so
  // every row is as wide as the widest.
  const width = Math.max(...rows.map((row) => row.length));

  return createTableBlock({
    align,
    rows: rows.map((row) =>
      createTableRow(
        Array.from({ length: width }, (_, index) =>
          createTableCell(parseInlines(row[index] ?? "", context)),
        ),
      ),
    ),
  });
}

// Returns the column alignments when `line` is an alignment row, else null.
export function readAlignmentRow(line: string) {
  // Paragraph lines reach here through `interruptsParagraph`, so bail before
  // splitting.
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

// The table reader's gate. `readTable` still confirms the alignment row.
export function looksLikeTableRow(line: string) {
  const trimmed = line.trim();

  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

// --- Internal helpers ---

// Splits a row that passed `looksLikeTableRow` on unescaped pipes, so `a \| b`
// stays one cell.
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
