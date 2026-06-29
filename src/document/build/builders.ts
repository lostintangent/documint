// Semantic node builders and rebuild helpers. Builders return canonical
// semantic values: every derived field (`plainText` on blocks/cells,
// canonical mark order, default property values) is computed here.

import {
  extractListPlainText,
  extractPlainTextFromBlockNodes,
  extractPlainTextFromInlineNodes,
  extractTablePlainText,
} from "../query/text";
import { canonicalizeMarks } from "../model/marks";
import { normalizeResourceProtocol, resolveResourceProtocol } from "../model/resources";
import type {
  Block,
  BlockquoteBlock,
  CodeBlock,
  DirectiveBlock,
  DividerBlock,
  HeadingBlock,
  Image,
  Inline,
  LineBreak,
  Link,
  ListBlock,
  ListItemBlock,
  Mark,
  Mention,
  MentionTarget,
  ParagraphBlock,
  Raw,
  RawBlock,
  Resource,
  TableBlock,
  TableCell,
  TableRow,
  Text,
} from "../model/types";

export function createParagraphBlock(children: Inline[]): ParagraphBlock {
  return {
    children,
    plainText: extractPlainTextFromInlineNodes(children),
    type: "paragraph",
  };
}

export function createParagraphTextBlock(text: string): ParagraphBlock {
  return createParagraphBlock(createTextChildren(text));
}

export function createHeadingBlock(options: {
  children: Inline[];
  depth: HeadingBlock["depth"];
}): HeadingBlock {
  return {
    children: options.children,
    depth: options.depth,
    plainText: extractPlainTextFromInlineNodes(options.children),
    type: "heading",
  };
}

export function createHeadingTextBlock(options: {
  depth: HeadingBlock["depth"];
  text: string;
}): HeadingBlock {
  return createHeadingBlock({
    children: createTextChildren(options.text),
    depth: options.depth,
  });
}

export function createText(text: string, marks: readonly Mark[] = []): Text {
  return {
    marks: canonicalizeMarks(marks),
    text,
    type: "text",
  };
}

export function createLineBreak(): LineBreak {
  return {
    type: "lineBreak",
  };
}

export function createLink(options: {
  children: Inline[];
  title?: string | null;
  url: string;
}): Link {
  return {
    children: options.children,
    title: options.title ?? null,
    type: "link",
    url: options.url,
  };
}

export function createImage(options: {
  alt?: string | null;
  title?: string | null;
  url: string;
  width?: number | null;
}): Image {
  return {
    alt: options.alt ?? null,
    title: options.title ?? null,
    type: "image",
    url: options.url,
    width: options.width ?? null,
  };
}

export function createMention(target: MentionTarget): Mention {
  return {
    name: target.name,
    type: "mention",
    userId: target.userId,
  };
}

export function createResource(options: {
  label: string;
  protocol?: string;
  url: string;
}): Resource {
  const protocol =
    resolveResourceProtocol(options.url) ?? normalizeResourceProtocol(options.protocol ?? "") ?? "";

  return {
    label: options.label,
    protocol,
    type: "resource",
    url: options.url,
  };
}

export function createRaw(options: { originalType: string; source: string }): Raw {
  return {
    originalType: options.originalType,
    source: options.source,
    type: "raw",
  };
}

export function createListItemBlock(options: {
  checked?: boolean | null;
  children: Block[];
  compact?: boolean;
}): ListItemBlock {
  return {
    checked: options.checked ?? null,
    children: options.children,
    compact: options.compact ?? true,
    plainText: extractPlainTextFromBlockNodes(options.children),
    type: "listItem",
  };
}

export function createListBlock(options: {
  compact?: boolean;
  items: ListItemBlock[];
  ordered: boolean;
  start?: number | null;
}): ListBlock {
  return {
    compact: options.compact ?? true,
    items: options.items,
    ordered: options.ordered,
    plainText: extractListPlainText(options.items),
    start: options.start ?? null,
    type: "list",
  };
}

export function createBlockquoteBlock(children: Block[]): BlockquoteBlock {
  return {
    children,
    plainText: extractPlainTextFromBlockNodes(children),
    type: "blockquote",
  };
}

export function createCodeBlock(options: {
  language?: string | null;
  meta?: string | null;
  source: string;
}): CodeBlock {
  return {
    language: options.language ?? null,
    meta: options.meta ?? null,
    plainText: options.source,
    source: options.source,
    type: "code",
  };
}

export function createTableCell(children: Inline[]): TableCell {
  return {
    children,
    plainText: extractPlainTextFromInlineNodes(children),
  };
}

export function createTableRow(cells: TableCell[]): TableRow {
  return {
    cells,
  };
}

export function createTableBlock(options: {
  align?: TableBlock["align"];
  rows: TableRow[];
}): TableBlock {
  return {
    align: options.align ?? [],
    plainText: extractTablePlainText(options.rows),
    rows: options.rows,
    type: "table",
  };
}

export function createDividerBlock(): DividerBlock {
  return {
    plainText: "",
    type: "divider",
  };
}

export function createRawBlock(options: { originalType: string; source: string }): RawBlock {
  return {
    originalType: options.originalType,
    plainText: options.source,
    source: options.source,
    type: "raw",
  };
}

export function createDirectiveBlock(options: {
  attributes: string;
  body: string;
  name: string;
}): DirectiveBlock {
  return {
    attributes: options.attributes,
    body: options.body,
    name: options.name,
    plainText: options.body,
    type: "directive",
  };
}

export function rebuildTextBlock(block: HeadingBlock | ParagraphBlock, children: Inline[]) {
  return block.type === "heading"
    ? createHeadingBlock({
        children,
        depth: block.depth,
      })
    : createParagraphBlock(children);
}

export function rebuildListItemBlock(block: ListItemBlock, children: Block[]): ListItemBlock {
  return createListItemBlock({
    checked: block.checked,
    children,
    compact: block.compact,
  });
}

export function rebuildListBlock(
  block: ListBlock,
  items: ListItemBlock[],
  overrides: Partial<Pick<ListBlock, "compact" | "ordered" | "start">> = {},
): ListBlock {
  return createListBlock({
    compact: overrides.compact ?? block.compact,
    items,
    ordered: overrides.ordered ?? block.ordered,
    start: overrides.start ?? block.start,
  });
}

export function rebuildTableBlock(block: TableBlock, rows: TableRow[]): TableBlock {
  return createTableBlock({
    align: block.align,
    rows,
  });
}

export function rebuildCodeBlock(block: CodeBlock, source: string): CodeBlock {
  return createCodeBlock({
    language: block.language,
    meta: block.meta,
    source,
  });
}

export function rebuildRawBlock(block: RawBlock, source: string): RawBlock {
  return createRawBlock({
    originalType: block.originalType,
    source,
  });
}

function createTextChildren(text: string): Text[] {
  return text.length > 0 ? [createText(text)] : [];
}
