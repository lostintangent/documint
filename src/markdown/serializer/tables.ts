/**
 * Serializes semantic tables into canonical pipe-table markdown. Lives in
 * its own module because table layout — column-width computation, alignment
 * dividers, optional column padding — is a self-contained concern.
 */

import type { TableBlock } from "@/document";
import { lineFeed, type MarkdownOptions } from "../shared";
import { serializeInlines } from "./inlines";

// A divider cell is at minimum three dashes; each colon-marked side adds one
// character to the rendered width. `alignmentColons(align)` returns 0/1/2.
const minimumTableDividerWidth = 3;

export function serializeTable(block: TableBlock, indent: number, options: MarkdownOptions) {
  const rowValues = block.rows.map((row) =>
    row.cells.map((cell) => serializeInlines(cell.children)),
  );
  const columnCount = Math.max(1, ...rowValues.map((row) => row.length));
  const headerRow = rowValues[0] ?? [];
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(
      minimumAlignmentWidth(block.align[columnIndex]),
      ...(options.padTableColumns
        ? rowValues.map((row) => row[columnIndex]?.length ?? 0)
        : [headerRow[columnIndex]?.length ?? 0]),
    ),
  );
  const separator = serializeTableAlignment(columnWidths, block.align, indent);
  const header = serializeTableRow(headerRow, columnWidths, block.align, indent, options);
  const body = rowValues
    .slice(1)
    .map((row) => serializeTableRow(row, columnWidths, block.align, indent, options));

  return [header ?? serializeEmptyTableRow(columnWidths, indent), separator, ...body].join(
    lineFeed,
  );
}

function serializeTableRow(
  row: string[],
  widths: number[],
  align: TableBlock["align"],
  indent: number,
  options: MarkdownOptions,
) {
  const cells = widths.map((width, columnIndex) => {
    const value = row[columnIndex] ?? "";

    if (!options.padTableColumns) {
      return value;
    }

    return padTableCell(value, width, align[columnIndex]);
  });

  return `${" ".repeat(indent)}| ${cells.join(" | ")} |`;
}

function serializeTableAlignment(widths: number[], align: TableBlock["align"], indent: number) {
  const cells = widths.map((width, columnIndex) => alignmentCell(align[columnIndex], width));

  return `${" ".repeat(indent)}| ${cells.join(" | ")} |`;
}

function serializeEmptyTableRow(widths: number[], indent: number) {
  return `${" ".repeat(indent)}| ${widths.map((width) => "".padEnd(width, " ")).join(" | ")} |`;
}

function alignmentCell(align: TableBlock["align"][number], width: number) {
  const colons = alignmentColons(align);
  const dashCount = Math.max(minimumTableDividerWidth, width - colons);
  const dashes = "-".repeat(dashCount);

  switch (align) {
    case "center":
      return `:${dashes}:`;
    case "left":
      return `:${dashes}`;
    case "right":
      return `${dashes}:`;
    default:
      return dashes;
  }
}

function minimumAlignmentWidth(align: TableBlock["align"][number]) {
  return minimumTableDividerWidth + alignmentColons(align);
}

function alignmentColons(align: TableBlock["align"][number]) {
  if (align === "center") {
    return 2;
  }

  return align ? 1 : 0;
}

function padTableCell(value: string, width: number, align: TableBlock["align"][number]) {
  if (align === "right") {
    return value.padStart(width, " ");
  }

  return value.padEnd(width, " ");
}
