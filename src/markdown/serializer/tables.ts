/**
 * Serializes semantic tables into canonical pipe-table markdown, with column
 * widths, alignment dividers and optional column padding.
 */

import type { TableBlock } from "@/document";
import { lineFeed, type MarkdownOptions } from "../shared";
import { serializeInlines } from "./inlines";

type TableAlignment = TableBlock["align"][number];

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

// A divider cell is at least three dashes, plus its alignment colons.
function alignmentCell(align: TableAlignment, width: number) {
  const [before, after] = align ? alignmentColons[align] : ["", ""];
  const dashCount = Math.max(3, width - before.length - after.length);

  return `${before}${"-".repeat(dashCount)}${after}`;
}

function padTableCell(value: string, width: number, align: TableAlignment) {
  return align === "right" ? value.padStart(width) : value.padEnd(width);
}

// Table cell pipes are structural unless escaped. Only add a slash when the
// pipe is not already escaped by an odd-length backslash run.
function escapeTableCellPipes(value: string) {
  return value.replace(/(\\*)\|/g, (pipe, slashes: string) =>
    slashes.length % 2 === 0 ? `${slashes}\\|` : pipe,
  );
}
