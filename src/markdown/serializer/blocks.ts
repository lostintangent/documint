/**
 * Owns block-level serialization for the Documint markdown dialect: the
 * dispatcher, every block-kind serializer, and the `renderDirective` envelope
 * shared with the comment appendix in `./index`.
 */

import { createParagraphBlock, type Block, type ListBlock, type ListItemBlock } from "@/document";
import { shouldEscapeParagraphLineStart } from "../parser/blocks";
import {
  blockquoteMarker,
  containerDirectiveClosingMarker,
  lineFeed,
  type MarkdownOptions,
} from "../shared";
import { serializeInlines } from "./inlines";
import { serializeTable } from "./tables";

export const blockSeparator = "\n\n";

/**
 * Serializes a sequence of top-level blocks using the canonical block
 * separator. No front matter, comments, or trailing newline — caller-owned
 * concerns. Used by `serializeDocument` and by clipboard-fragment
 * serialization, which wants the bare block payload.
 */
export function serializeBlocks(blocks: Block[], options: MarkdownOptions = {}): string {
  const cache = options.padTableColumns ? paddedRootCache : unpaddedRootCache;

  return blocks
    .map((block) => {
      let markdown = cache.get(block);

      if (markdown === undefined) {
        markdown = serializeBlock(block, 0, options);
        cache.set(block, markdown);
      }

      return markdown;
    })
    .join(blockSeparator);
}

// Root blocks are immutable, so unchanged roots reuse their markdown by
// identity. `padTableColumns` is the only option the serializer reads, so
// there's one cache per value.
const unpaddedRootCache = new WeakMap<Block, string>();
const paddedRootCache = new WeakMap<Block, string>();

function serializeBlock(block: Block, indent: number, options: MarkdownOptions): string {
  switch (block.type) {
    case "blockquote":
      return serializeBlockquote(block, indent, options);
    case "code":
      return serializeCode(block, indent);
    case "directive":
      return indentBlockText(renderDirective(block), indent);
    case "heading":
      return serializeHeading(block, indent);
    case "list":
      return serializeList(block, indent, options);
    case "listItem":
      return serializeListItem(block, indent, false, 1, options);
    case "paragraph":
      return serializeParagraph(block, indent);
    case "table":
      return serializeTable(block, indent, options);
    case "divider":
      return `${indentText(indent)}---`;
    case "raw":
      return indentBlockText(block.source, indent);
  }
}

// --- Block serializers ---
// Each returns its block at `indent`, with no trailing newline.

function serializeBlockquote(
  block: Extract<Block, { type: "blockquote" }>,
  indent: number,
  options: MarkdownOptions,
) {
  const inner = block.children
    .map((child) => serializeBlock(child, 0, options))
    .join(blockSeparator);
  const indentPrefix = indentText(indent);
  const prefixLine = (line: string) =>
    `${indentPrefix}${blockquoteMarker}${line.length > 0 ? ` ${line}` : ""}`;

  // Single-line fast path. A blockquote with one short paragraph child —
  // by far the common shape (`> single sentence`) — needs only one prefix
  // and no split/map/join allocations.
  if (!inner.includes(lineFeed)) {
    return prefixLine(inner);
  }

  return inner.split(lineFeed).map(prefixLine).join(lineFeed);
}

function serializeCode(block: Extract<Block, { type: "code" }>, indent: number) {
  const info = [block.language ?? "", block.meta ?? ""].filter(Boolean).join(" ").trim();
  const indentPrefix = indentText(indent);
  const body = indentBlockText(block.source, indent);
  // A backtick-only line in the code would close any fence no longer than it.
  const fence = [...block.source.matchAll(/^[^\S\n]*(`{3,})[^\S\n]*$/gm)].reduce(
    (widest, [, run]) => (run!.length >= widest.length ? `${run}\`` : widest),
    "```",
  );

  return `${indentPrefix}${fence}${info}${lineFeed}${body}${lineFeed}${indentPrefix}${fence}`;
}

// Builds the `:::name{attrs}\nbody\n:::` envelope. Shared between user-defined
// directive blocks and the comment-directive appendix
// (`serializeCommentAppendix` in `./index`).
export function renderDirective(directive: {
  attributes: string;
  body: string;
  name: string;
}): string {
  const attributes = directive.attributes ? `{${directive.attributes}}` : "";
  return `:::${directive.name}${attributes}${lineFeed}${directive.body}${lineFeed}${containerDirectiveClosingMarker}`;
}

function serializeHeading(block: Extract<Block, { type: "heading" }>, indent: number) {
  // A `#` run ending the text would reload as a closing sequence.
  const content = escapeLeadingWhitespace(serializeInlines(block.children)).replace(
    /(?<!\S)#(?=#*\s*$)/,
    "\\#",
  );
  const marker = `${indentText(indent)}${"#".repeat(block.depth)}`;

  return content.length > 0 ? `${marker} ${content}` : marker;
}

function serializeList(block: ListBlock, indent: number, options: MarkdownOptions) {
  const start = block.start ?? 1;

  return block.items
    .map((item, index) => serializeListItem(item, indent, block.ordered, start + index, options))
    .join(block.compact ? lineFeed : blockSeparator);
}

function serializeListItem(
  block: ListItemBlock,
  indent: number,
  ordered: boolean,
  markerNumber: number,
  options: MarkdownOptions,
) {
  const marker = ordered ? `${markerNumber}.` : "-";
  const checkbox = block.checked === null ? "" : `[${block.checked ? "x" : " "}] `;
  const prefix = `${indentText(indent)}${marker} ${checkbox}`;
  const childIndent = indent + marker.length + 1;
  const [firstChild = createParagraphBlock([]), ...rest] = block.children;
  const firstContent = serializeListItemFirstChild(
    firstChild,
    prefix,
    childIndent,
    checkbox.length > 0,
    options,
  );
  const childSeparator = block.compact ? lineFeed : blockSeparator;
  const tail = rest
    .map((child) => serializeBlock(child, childIndent, options))
    .join(childSeparator);

  return tail ? `${firstContent}${childSeparator}${tail}` : firstContent;
}

function serializeListItemFirstChild(
  block: Block,
  prefix: string,
  childIndent: number,
  hasCheckbox: boolean,
  options: MarkdownOptions,
) {
  switch (block.type) {
    case "paragraph": {
      const content = serializeParagraph(block, childIndent, "");
      return content || hasCheckbox ? `${prefix}${content}` : prefix.trimEnd();
    }
    case "heading":
      return `${prefix}${serializeHeading(block, 0)}`;
    case "directive":
    case "raw": {
      const body = block.type === "directive" ? renderDirective(block) : block.source;
      const [firstLine, ...rest] = body.split(lineFeed);
      const indent = indentText(childIndent);
      return [prefix + firstLine, ...rest.map((line) => indent + line)].join(lineFeed);
    }
    default:
      return `${prefix.trimEnd()}${lineFeed}${serializeBlock(block, childIndent, options)}`;
  }
}

// Each paragraph line is escaped so it can't reload as a block start or lose
// its leading spaces.
function serializeParagraph(
  block: Extract<Block, { type: "paragraph" }>,
  indent: number,
  firstLinePrefix = indentText(indent),
): string {
  const value = serializeInlines(block.children);

  // Most paragraphs are one line, so skip the split.
  if (!value.includes(lineFeed)) {
    return `${firstLinePrefix}${escapeParagraphLine(value)}`;
  }

  // Every soft-wrapped line keeps the container indent, or the next parse
  // would end the list item at the first under-indented line.
  const lines = value.split(lineFeed).map(escapeParagraphLine);
  return `${firstLinePrefix}${lines.join(`${lineFeed}${indentText(indent)}`)}`;
}

// --- Low-level block helpers ---

// Leading spaces become entities, or the next parse would strip them.
function escapeLeadingWhitespace(value: string) {
  if (!value.startsWith(" ") && !value.includes("\n ")) {
    return value;
  }
  return value.replace(/^ +/gm, (spaces) => "&#x20;".repeat(spaces.length));
}

function escapeParagraphLine(line: string) {
  return line.startsWith(" ") ? escapeLeadingWhitespace(line) : escapeBlockStartPrefix(line);
}

// The parser's block readers decide which lines would reload as a block start.
// HTML blocks are excluded because text `<` is already escaped inline and a
// raw tag at line start must stay raw. An ordered marker escapes its dot so
// the digits stay text, a `*`, `_` or backtick run escapes every character,
// and anything else takes one leading backslash.
function escapeBlockStartPrefix(line: string): string {
  if (!shouldEscapeParagraphLineStart(line)) {
    return line;
  }

  if (/^\d+\.(\s|$)/.test(line)) {
    return line.replace(".", "\\.");
  }

  const run = /^([`*_])\1*/.exec(line)?.[0];
  return run ? `${run.replace(/./g, "\\$&")}${line.slice(run.length)}` : `\\${line}`;
}

function indentText(indent: number) {
  return " ".repeat(indent);
}

// Prefixes every line, including an empty value's single line.
function indentBlockText(value: string, indent: number) {
  if (indent === 0) {
    return value;
  }

  const indentPrefix = indentText(indent);
  return `${indentPrefix}${value.replaceAll(lineFeed, `${lineFeed}${indentPrefix}`)}`;
}
