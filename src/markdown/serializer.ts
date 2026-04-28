/**
 * Serializes semantic documents into the canonical Documint markdown dialect.
 */

import type {
  Block,
  Document,
  Inline,
  ListBlock,
  ListItemBlock,
  Mark,
  TableBlock,
} from "@/document";
import {
  blockquoteMarker,
  commentDirectiveName,
  containerDirectiveClosingMarker,
  fencedCodeMarker,
  lineFeed,
  type MarkdownOptions,
  underlineCloseTag,
  underlineOpenTag,
} from "./shared";

const blockSeparator = "\n\n";

const unorderedListMarker = "-";
const orderedListDelimiter = ".";

const thematicBreakMarker = "***";
const leadingSpaceEntity = "&#x20;";

const minimumTableDividerWidth = 3;
const minimumCenteredAlignmentWidth = 5;
const minimumEdgeAlignedWidth = 4;
const leftAlignedDividerPadding = 2;
const centeredDividerPadding = 2;
const rightAlignedDividerPadding = 1;

const markdownTextEscapePattern = /([\\`*_[\]])/g;
const markdownDestinationEscapePattern = /([\\)&])/g;
const markdownTitleEscapePattern = /(["\\])/g;

export function serializeMarkdown(document: Document, options: MarkdownOptions = {}) {
  if (
    document.blocks.length === 0 &&
    document.comments.length === 0 &&
    document.frontMatter === undefined
  ) {
    return "";
  }

  const chunks = document.blocks.map((block) => serializeBlock(block, 0, options));

  if (document.comments.length > 0) {
    chunks.push(serializeCommentDirective(document.comments));
  }

  if (document.frontMatter !== undefined) {
    chunks.unshift(document.frontMatter);
  }

  const result = chunks.join(blockSeparator);

  return result.endsWith(lineFeed) ? result : `${result}${lineFeed}`;
}

function serializeBlock(block: Block, indent: number, options: MarkdownOptions): string {
  const indentPrefix = indentText(indent);

  switch (block.type) {
    case "blockquote":
      return serializeBlockquote(block, indent, options);
    case "code":
      return serializeCodeBlock(block, indent);
    case "directive":
      return serializeDirective(block, indent);
    case "heading":
      return serializeHeading(block, indent);
    case "list":
      return serializeList(block, indent, options);
    case "listItem":
      return serializeListItem(block, indent, false, 1, options);
    case "paragraph":
      return `${indentPrefix}${protectLeadingWhitespace(serializeInlineNodes(block.children))}`;
    case "table":
      return serializeTable(block, indent, options);
    case "thematicBreak":
      return `${indentPrefix}${thematicBreakMarker}`;
    case "unsupported":
      return indent === 0 ? block.source : indentBlockText(block.source, indent);
  }
}

function serializeBlockquote(
  block: Extract<Block, { type: "blockquote" }>,
  indent: number,
  options: MarkdownOptions,
) {
  const inner = block.children
    .map((child) => serializeBlock(child, 0, options))
    .join(blockSeparator);
  const indentPrefix = indentText(indent);

  return inner
    .split(lineFeed)
    .map((line) => `${indentPrefix}${blockquoteMarker}${line.length > 0 ? ` ${line}` : ""}`)
    .join(lineFeed);
}

function serializeCodeBlock(block: Extract<Block, { type: "code" }>, indent: number) {
  const info = [block.language ?? "", block.meta ?? ""].filter(Boolean).join(" ").trim();
  const indentPrefix = indentText(indent);
  const header = `${indentPrefix}${fencedCodeMarker}${info ? info : ""}`;
  const body =
    block.source.length > 0
      ? block.source
          .split(lineFeed)
          .map((line) => `${indentPrefix}${line}`)
          .join(lineFeed)
      : indentPrefix;

  return `${header}${lineFeed}${body}${lineFeed}${indentPrefix}${fencedCodeMarker}`;
}

function serializeHeading(block: Extract<Block, { type: "heading" }>, indent: number) {
  const content = protectLeadingWhitespace(serializeInlineNodes(block.children));
  const marker = `${indentText(indent)}${"#".repeat(block.depth)}`;

  return content.length > 0 ? `${marker} ${content}` : marker;
}

function serializeList(block: ListBlock, indent: number, options: MarkdownOptions) {
  const markerNumber = block.start ?? 1;

  return block.items
    .map((item) => serializeListItem(item, indent, block.ordered, markerNumber, options))
    .join(block.spread ? blockSeparator : lineFeed);
}

function serializeListItem(
  block: ListItemBlock,
  indent: number,
  ordered: boolean,
  markerNumber: number,
  options: MarkdownOptions,
) {
  const marker = ordered ? `${markerNumber}${orderedListDelimiter}` : unorderedListMarker;
  const checkbox = block.checked === null ? "" : `[${block.checked ? "x" : " "}] `;
  const prefix = `${indentText(indent)}${marker} ${checkbox}`;
  const childIndent = indent + marker.length + 1;
  const children = block.children;

  if (children.length === 0) {
    return checkbox.length > 0 ? prefix : prefix.trimEnd();
  }

  const [firstChild, ...rest] = children;
  const firstContent = serializeListItemFirstChild(
    firstChild,
    prefix,
    checkbox.length > 0,
    options,
  );
  const tail = rest
    .map((child) => serializeBlock(child, childIndent, options))
    .join(block.spread ? blockSeparator : lineFeed);

  if (!tail) {
    return firstContent;
  }

  return `${firstContent}${block.spread ? blockSeparator : lineFeed}${tail}`;
}

function serializeListItemFirstChild(
  block: Block,
  prefix: string,
  hasCheckbox: boolean,
  options: MarkdownOptions,
) {
  switch (block.type) {
    case "paragraph": {
      const content = protectLeadingWhitespace(serializeInlineNodes(block.children));

      if (content.length === 0) {
        return hasCheckbox ? prefix : prefix.trimEnd();
      }

      return `${prefix}${content}`;
    }
    case "heading":
      return `${prefix}${serializeHeading(block, 0)}`;
    case "directive":
    case "unsupported": {
      const body = block.type === "directive" ? renderDirective(block) : block.source;
      const [firstLine, ...rest] = body.split(lineFeed);
      return [
        prefix + firstLine,
        ...rest.map((line) => `${indentText(prefix.length)}${line}`),
      ].join(lineFeed);
    }
    default: {
      const childIndent = prefix.length;
      return `${prefix.trimEnd()}${lineFeed}${serializeBlock(block, childIndent, options)}`;
    }
  }
}

function serializeTable(block: TableBlock, indent: number, options: MarkdownOptions) {
  const rowValues = block.rows.map((row) =>
    row.cells.map((cell) => serializeInlineNodes(cell.children)),
  );
  const columnCount = Math.max(1, ...rowValues.map((row) => row.length));
  const headerRow = rowValues[0] ?? [];
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(
      minimumTableDividerWidth,
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
  return `${indentText(indent)}| ${widths.map((width) => "".padEnd(width, " ")).join(" | ")} |`;
}

function alignmentCell(align: TableBlock["align"][number], width: number) {
  const dashCount = Math.max(
    minimumTableDividerWidth,
    width - (align === "center" ? centeredDividerPadding : align ? rightAlignedDividerPadding : 0),
  );

  switch (align) {
    case "center":
      return `:${"-".repeat(Math.max(1, dashCount))}:`;
    case "left":
      return `:${"-".repeat(Math.max(leftAlignedDividerPadding, dashCount))}`;
    case "right":
      return `${"-".repeat(Math.max(leftAlignedDividerPadding, dashCount))}:`;
    default:
      return "-".repeat(dashCount);
  }
}

function minimumAlignmentWidth(align: TableBlock["align"][number]) {
  return align === "center"
    ? minimumCenteredAlignmentWidth
    : align
      ? minimumEdgeAlignedWidth
      : minimumTableDividerWidth;
}

function padTableCell(value: string, width: number, align: TableBlock["align"][number]) {
  if (align === "right") {
    return value.padStart(width, " ");
  }

  return value.padEnd(width, " ");
}

function serializeInlineNodes(nodes: Inline[]) {
  return mergeInlineText(nodes)
    .map((node) => serializeInline(node))
    .join("");
}

function protectLeadingWhitespace(value: string) {
  return value.replace(/^ +/gm, (spaces) => leadingSpaceEntity.repeat(spaces.length));
}

function serializeInline(node: Inline): string {
  switch (node.type) {
    case "break":
      return lineFeed;
    case "image":
      return serializeImage(node);
    case "inlineCode":
      return serializeInlineCode(node.code);
    case "link":
      return serializeLink(node);
    case "text":
      return applyMarks(escapeMarkdownText(node.text), node.marks);
    case "unsupported":
      return node.source;
  }
}

function mergeInlineText(nodes: Inline[]) {
  const merged: Inline[] = [];

  for (const node of nodes) {
    const previous = merged.at(-1);

    if (
      previous?.type === "text" &&
      node.type === "text" &&
      hasMatchingMarks(previous.marks, node.marks)
    ) {
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + node.text,
      };
      continue;
    }

    merged.push(node);
  }

  return merged;
}

function hasMatchingMarks(previous: Mark[], next: Mark[]) {
  return previous.length === next.length && previous.every((mark, index) => mark === next[index]);
}

function applyMarks(value: string, marks: Mark[]) {
  return marks.reduce((current, mark) => {
    switch (mark) {
      case "bold":
        return `**${current}**`;
      case "italic":
        return `*${current}*`;
      case "strikethrough":
        return `~~${current}~~`;
      case "underline":
        return `${underlineOpenTag}${current}${underlineCloseTag}`;
    }
  }, value);
}

function serializeInlineCode(value: string) {
  let widestFence = 0;
  let currentFence = 0;

  for (const character of value) {
    if (character === "`") {
      currentFence += 1;

      if (currentFence > widestFence) {
        widestFence = currentFence;
      }

      continue;
    }

    currentFence = 0;
  }

  const fenceWidth = widestFence > 0 ? widestFence + 1 : 1;
  const fence = "`".repeat(fenceWidth);
  const padded = value.startsWith("`") || value.endsWith("`") ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
}

function escapeMarkdownText(value: string) {
  return value.replace(markdownTextEscapePattern, "\\$1");
}

function escapeMarkdownDestination(value: string) {
  return value.replace(markdownDestinationEscapePattern, "\\$1");
}

function serializeOptionalTitle(title: string | null) {
  return title ? ` "${title.replace(markdownTitleEscapePattern, "\\$1")}"` : "";
}

function serializeCommentDirective(comments: Document["comments"]) {
  return renderDirective({
    attributes: "",
    body: JSON.stringify(comments, null, 2),
    name: commentDirectiveName,
  });
}

function serializeDirective(block: Extract<Block, { type: "directive" }>, indent: number): string {
  const rendered = renderDirective(block);
  return indent === 0 ? rendered : indentBlockText(rendered, indent);
}

function renderDirective(directive: { attributes: string; body: string; name: string }): string {
  const attributes = directive.attributes ? `{${directive.attributes}}` : "";
  return `:::${directive.name}${attributes}${lineFeed}${directive.body}${lineFeed}${containerDirectiveClosingMarker}`;
}

function serializeImage(node: Extract<Inline, { type: "image" }>) {
  const alt = escapeMarkdownText(node.alt ?? "");
  const destination = serializeLinkDestination(node.url, node.title);
  const width = node.width ? `{width=${node.width}}` : "";

  return `![${alt}]${destination}${width}`;
}

function serializeLink(node: Extract<Inline, { type: "link" }>) {
  return `[${serializeInlineNodes(node.children)}]${serializeLinkDestination(node.url, node.title)}`;
}

function serializeLinkDestination(url: string, title: string | null) {
  return `(${escapeMarkdownDestination(url)}${serializeOptionalTitle(title)})`;
}

function indentText(indent: number) {
  return " ".repeat(indent);
}

function indentBlockText(value: string, indent: number) {
  const indentPrefix = indentText(indent);
  return value
    .split(lineFeed)
    .map((line) => `${indentPrefix}${line}`)
    .join(lineFeed);
}
