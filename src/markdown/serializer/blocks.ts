/**
 * Owns block-level serialization for the Documint markdown dialect: the
 * dispatcher, every block-kind serializer, the shared `renderDirective`
 * envelope (also used by the comment appendix in `./index`), and the
 * block-level low-level helpers (`indentText`, `protectLeadingWhitespace`).
 */

import type { Block, ListBlock, ListItemBlock } from "@/document";
import {
  blockquoteMarker,
  containerDirectiveClosingMarker,
  fencedCodeMarker,
  lineFeed,
  type MarkdownOptions,
} from "../shared";
import { serializeInlines } from "./inlines";
import { serializeTable } from "./tables";

// --- Block-level constants ---
export const blockSeparator = "\n\n";
const unorderedListMarker = "-";
const orderedListDelimiter = ".";
const dividerMarker = "---";
// Replaces leading spaces in inline output with an HTML entity so block parsers
// don't strip them. Used by paragraph and heading serializers.
const leadingSpaceEntity = "&#x20;";

/**
 * Serializes a sequence of top-level blocks using the canonical block
 * separator. No front matter, comments, or trailing newline — caller-owned
 * concerns. Used by `serializeDocument` and by clipboard-fragment
 * serialization, which wants the bare block payload.
 */
export function serializeBlocks(blocks: Block[], options: MarkdownOptions = {}): string {
  return blocks.map((block) => serializeBlock(block, 0, options)).join(blockSeparator);
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
      return `${indentPrefix}${protectLeadingWhitespace(serializeInlines(block.children))}`;
    case "table":
      return serializeTable(block, indent, options);
    case "divider":
      return `${indentPrefix}${dividerMarker}`;
    case "raw":
      return indent === 0 ? block.source : indentBlockText(block.source, indent);
  }
}

// --- Block serializers, in dispatcher order ---
// Each takes the block, its indent, and (where needed) options, and returns
// the rendered string with no trailing newline. Per-reader helpers live
// immediately below their serializer.

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

function serializeDirective(block: Extract<Block, { type: "directive" }>, indent: number): string {
  const rendered = renderDirective(block);
  return indent === 0 ? rendered : indentBlockText(rendered, indent);
}

// Builds the `:::name{attrs}\nbody\n:::` envelope. Shared between user-defined
// directives (`serializeDirective`) and the comment-directive appendix
// (`serializeCommentDirective` in `./index`).
export function renderDirective(directive: {
  attributes: string;
  body: string;
  name: string;
}): string {
  const attributes = directive.attributes ? `{${directive.attributes}}` : "";
  return `:::${directive.name}${attributes}${lineFeed}${directive.body}${lineFeed}${containerDirectiveClosingMarker}`;
}

function serializeHeading(block: Extract<Block, { type: "heading" }>, indent: number) {
  const content = protectLeadingWhitespace(serializeInlines(block.children));
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
      const content = protectLeadingWhitespace(serializeInlines(block.children));

      if (content.length === 0) {
        return hasCheckbox ? prefix : prefix.trimEnd();
      }

      return `${prefix}${content}`;
    }
    case "heading":
      return `${prefix}${serializeHeading(block, 0)}`;
    case "directive":
    case "raw": {
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

// --- Low-level block helpers ---
// Indent measurement and leading-whitespace protection. Used across the block
// serializers; not exported because no sibling module needs them.

// Replaces leading spaces (per line) with an HTML space entity so the block
// parser doesn't strip them on the next round-trip.
function protectLeadingWhitespace(value: string) {
  return value.replace(/^ +/gm, (spaces) => leadingSpaceEntity.repeat(spaces.length));
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
