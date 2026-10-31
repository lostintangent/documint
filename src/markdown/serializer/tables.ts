/**
 * Serializes semantic tables into canonical pipe-table markdown. Lives in
 * its own module because table layout — column-width computation, alignment
 * dividers, optional column padding — is a self-contained concern.
 */

import type { TableBlock } from "@/document";
import { lineFeed, type MarkdownOptions } from "../shared";
import { serializeInlines } from "./inlines";

type TableAlignment = TableBlock["align"][number];

// A divider cell is at minimum three dashes, plus the colons that mark its
// alignment on either side.
const minimumTableDividerWidth = 3;
const alignmentColons = {
  center: [":", ":"],
  left: [":", ""],
  right: ["", ":"],
} as const;

export function serializeTable(block: TableBlock, indent: number, options: MarkdownOptions) {
  const [headerRow = [], ...bodyRows] = block.rows.map((row) =>
    row.cells.map((cell) => escapeTableCellPipes(serializeInlines(cell.children))),
  );
  const columnCount = Math.max(1, headerRow.length, ...bodyRows.map((row) => row.length));
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(
      // A column is at least as wide as its narrowest divider cell.
      alignmentCell(block.align[columnIndex], 0).length,
      headerRow[columnIndex]?.length ?? 0,
      ...(options.padTableColumns ? bodyRows.map((row) => row[columnIndex]?.length ?? 0) : []),
    ),
  );
  const formatCells = (row: string[]) =>
    columnWidths.map((width, columnIndex) => {
      const value = row[columnIndex] ?? "";
      return options.padTableColumns ? padTableCell(value, width, block.align[columnIndex]) : value;
    });
  const alignmentRow = columnWidths.map((width, columnIndex) =>
    alignmentCell(block.align[columnIndex], width),
  );
  const indentPrefix = " ".repeat(indent);

  return [formatCells(headerRow), alignmentRow, ...bodyRows.map(formatCells)]
    .map((cells) => `${indentPrefix}| ${cells.join(" | ")} |`)
    .join(lineFeed);
}

function alignmentCell(align: TableAlignment, width: number) {
  const [before, after] = align ? alignmentColons[align] : ["", ""];
  const dashCount = Math.max(minimumTableDividerWidth, width - before.length - after.length);

  return `${before}${"-".repeat(dashCount)}${after}`;
}

function padTableCell(value: string, width: number, align: TableAlignment) {
  if (align === "right") {
    return value.padStart(width, " ");
  }

  return value.padEnd(width, " ");
}

// Table cell pipes are structural unless escaped. Only add a slash when the
// pipe is not already escaped by an odd-length backslash run.
function escapeTableCellPipes(value: string) {
  let escaped = "";
  let trailingBackslashes = 0;

  for (const character of value) {
    if (character === "|" && trailingBackslashes % 2 === 0) {
      escaped += "\\";
    }

    escaped += character;

    if (character === "\\") {
      trailingBackslashes += 1;
    } else {
      trailingBackslashes = 0;
    }
  }

  return escaped;
}
