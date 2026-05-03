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
import { parseInlineMarkdown } from "./inlines";

const tableAlignmentCell = /^:?-+:?$/;

// --- Public exports ---

export function readTable(cursor: MarkdownLineCursor, baseIndent: number) {
  const headerLine = currentLine(cursor);
  const alignLine = peekLine(cursor, 1);
  const headerContent = sliceIndentedContent(headerLine, baseIndent);
  const alignmentContent = sliceIndentedContent(alignLine, baseIndent);

  if (!looksLikeTableRow(headerContent) || !looksLikeAlignmentRow(alignmentContent)) {
    return null;
  }

  const rows = [splitTableRow(headerContent)];
  const align = parseAlignmentRow(alignmentContent);
  cursor.index += 2;

  while (cursor.index < cursor.lines.length) {
    const line = currentLine(cursor);
    const content = sliceIndentedContent(line, baseIndent);

    if (isBlankLine(line) || !looksLikeTableRow(content)) {
      break;
    }

    rows.push(splitTableRow(content));
    cursor.index += 1;
  }

  return createTableBlock({
    align,
    rows: rows.map((row) =>
      createTableRow({
        cells: row.map((cell) =>
          createTableCell({
            children: parseInlineMarkdown(cell),
          }),
        ),
      }),
    ),
  });
}

export function looksLikeAlignmentRow(line: string) {
  const cells = splitTableRow(line);

  return cells.length > 0 && cells.every((cell) => tableAlignmentCell.test(cell.trim()));
}

// --- Internal helpers ---

function looksLikeTableRow(line: string) {
  const trimmed = line.trim();

  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

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

function splitTableRow(line: string) {
  const trimmed = line.trim();

  // Real table rows are pipe-fenced. Bail without allocating for the common
  // case where this is called speculatively from `shouldParagraphStop` on an
  // ordinary paragraph line.
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return [];
  }

  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}
