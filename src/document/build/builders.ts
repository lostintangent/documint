// Semantic node builders and rebuild helpers. Builders set `id: ""` as a
// placeholder; the canonical id is assigned by `createDocument` /
// `spliceDocument` from each node's structural path. Builders are otherwise
// canonical: every derived field (`plainText` on blocks, default property
// values) is computed here, so a builder's output is immediately usable as
// the corresponding node type minus the deferred id assignment.

import { extractPlainTextFromBlockNodes, extractPlainTextFromInlineNodes } from "../query/text";
import { canonicalizeMarks } from "../marks";
import type {
  Block,
  BlockquoteBlock,
  Code,
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
  ParagraphBlock,
  Raw,
  RawBlock,
  TableBlock,
  TableCell,
  TableRow,
  Text,
} from "../types";

export function createParagraphBlock(children: Inline[]): ParagraphBlock {
  return {
    children,
    id: "",
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
    id: "",
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
    id: "",
    marks: canonicalizeMarks(marks),
    text,
    type: "text",
  };
}

export function createLineBreak(): LineBreak {
  return {
    id: "",
    type: "lineBreak",
  };
}

export function createCode(code: string): Code {
  return {
    code,
    id: "",
    type: "code",
  };
}

export function createLink(options: {
  children: Inline[];
  title?: string | null;
  url: string;
}): Link {
  return {
    children: options.children,
    id: "",
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
    id: "",
    title: options.title ?? null,
    type: "image",
    url: options.url,
    width: options.width ?? null,
  };
}

export function createMention(options: { name: string; userId: string }): Mention {
  return {
    id: "",
    name: options.name,
    type: "mention",
    userId: options.userId,
  };
}

export function createRaw(options: { originalType: string; source: string }): Raw {
  return {
    id: "",
    originalType: options.originalType,
    source: options.source,
    type: "raw",
  };
}

export function createListItemBlock(options: {
  checked?: boolean | null;
  children: Block[];
  spread?: boolean;
}): ListItemBlock {
  return {
    checked: options.checked ?? null,
    children: options.children,
    id: "",
    plainText: extractPlainTextFromBlockNodes(options.children),
    spread: options.spread ?? false,
    type: "listItem",
  };
}

export function createListBlock(options: {
  items: ListItemBlock[];
  ordered: boolean;
  spread?: boolean;
  start?: number | null;
}): ListBlock {
  return {
    id: "",
    items: options.items,
    ordered: options.ordered,
    plainText: options.items.map((item) => item.plainText).join("\n"),
    spread: options.spread ?? false,
    start: options.start ?? null,
    type: "list",
  };
}

export function createBlockquoteBlock(children: Block[]): BlockquoteBlock {
  return {
    children,
    id: "",
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
    id: "",
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
    id: "",
    plainText: extractPlainTextFromInlineNodes(children),
  };
}

export function createTableRow(cells: TableCell[]): TableRow {
  return {
    cells,
    id: "",
  };
}

export function createTableBlock(options: {
  align?: TableBlock["align"];
  rows: TableRow[];
}): TableBlock {
  return {
    align: options.align ?? [],
    id: "",
    plainText: options.rows
      .map((row) => row.cells.map((cell) => cell.plainText).join(" | "))
      .join("\n"),
    rows: options.rows,
    type: "table",
  };
}

export function createDividerBlock(): DividerBlock {
  return {
    id: "",
    plainText: "",
    type: "divider",
  };
}

export function createRawBlock(options: { originalType: string; source: string }): RawBlock {
  return {
    id: "",
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
    id: "",
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
    spread: block.spread,
  });
}

export function rebuildListBlock(
  block: ListBlock,
  items: ListItemBlock[],
  overrides: Partial<Pick<ListBlock, "ordered" | "spread" | "start">> = {},
): ListBlock {
  return createListBlock({
    items,
    ordered: overrides.ordered ?? block.ordered,
    spread: overrides.spread ?? block.spread,
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
