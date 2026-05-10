// Semantic node builders and rebuild helpers. These own semantic node shape and
// derived fields such as plain-text projections. Canonical document IDs come
// from `createDocument(...)` and `spliceDocument(...)`.

import { extractPlainTextFromBlockNodes, extractPlainTextFromInlineNodes } from "./document";

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
} from "./types";

const preNormalizationFields = {
  id: "",
} as const;

export function createParagraphBlock(children: Inline[]): ParagraphBlock {
  const plainText = extractPlainTextFromInlineNodes(children);

  return {
    children,
    ...preNormalizationFields,
    plainText,
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
  const plainText = extractPlainTextFromInlineNodes(options.children);

  return {
    children: options.children,
    depth: options.depth,
    ...preNormalizationFields,
    plainText,
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

export function createText(text: string, marks: Mark[] = []): Text {
  return {
    marks,
    ...preNormalizationFields,
    text,
    type: "text",
  };
}

export function createLineBreak(): LineBreak {
  return {
    ...preNormalizationFields,
    type: "lineBreak",
  };
}

export function createCode(code: string): Code {
  return {
    code,
    ...preNormalizationFields,
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
    ...preNormalizationFields,
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
  const alt = options.alt ?? null;
  const width = options.width ?? null;

  return {
    alt,
    ...preNormalizationFields,
    title: options.title ?? null,
    type: "image",
    url: options.url,
    width,
  };
}

export function createMention(options: { name: string; userId: string }): Mention {
  return {
    name: options.name,
    ...preNormalizationFields,
    type: "mention",
    userId: options.userId,
  };
}

export function createRaw(options: { originalType: string; source: string }): Raw {
  return {
    originalType: options.originalType,
    ...preNormalizationFields,
    source: options.source,
    type: "raw",
  };
}

export function createListItemBlock(options: {
  checked?: boolean | null;
  children: Block[];
  spread?: boolean;
}): ListItemBlock {
  const plainText = extractPlainTextFromBlockNodes(options.children);

  return {
    checked: options.checked ?? null,
    children: options.children,
    ...preNormalizationFields,
    plainText,
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
  const plainText = options.items.map((item) => item.plainText).join("\n");

  return {
    items: options.items,
    ...preNormalizationFields,
    ordered: options.ordered,
    plainText,
    spread: options.spread ?? false,
    start: options.start ?? null,
    type: "list",
  };
}

export function createBlockquoteBlock(children: Block[]): BlockquoteBlock {
  const plainText = extractPlainTextFromBlockNodes(children);

  return {
    children,
    ...preNormalizationFields,
    plainText,
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
    ...preNormalizationFields,
    plainText: options.source,
    source: options.source,
    type: "code",
  };
}

export function createTableCell(children: Inline[]): TableCell {
  const plainText = extractPlainTextFromInlineNodes(children);

  return {
    children,
    ...preNormalizationFields,
    plainText,
  };
}

export function createTableRow(cells: TableCell[]): TableRow {
  return {
    cells,
    ...preNormalizationFields,
  };
}

export function createTableBlock(options: {
  align?: TableBlock["align"];
  rows: TableRow[];
}): TableBlock {
  const plainText = options.rows
    .map((row) => row.cells.map((cell) => cell.plainText).join(" | "))
    .join("\n");

  return {
    align: options.align ?? [],
    plainText,
    ...preNormalizationFields,
    rows: options.rows,
    type: "table",
  };
}

export function createDividerBlock(): DividerBlock {
  return {
    plainText: "",
    ...preNormalizationFields,
    type: "divider",
  };
}

export function createRawBlock(options: { originalType: string; source: string }): RawBlock {
  return {
    originalType: options.originalType,
    ...preNormalizationFields,
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
    ...preNormalizationFields,
    name: options.name,
    plainText: options.body,
    type: "directive",
  };
}

// Restore the canonical form after a mutation that fragmented adjacent
// text inlines — e.g. removing a link spreads its children into the parent
// (text inside + text outside become adjacent), merging two paragraphs
// concatenates their children at the seam, and inline splices generate
// new text runs adjacent to existing same-mark ones. Without this pass
// the tree would carry pointless `[text("foo"), text("bar")]` runs in
// place of `[text("foobar")]`. Only adjacent text inlines with identical
// marks are merged; other inline kinds pass through.
export function defragmentTextInlines(nodes: Inline[]) {
  const defragmented: Inline[] = [];

  for (const node of nodes) {
    const previous = defragmented.at(-1);

    if (
      previous?.type === "text" &&
      node.type === "text" &&
      previous.marks.join(",") === node.marks.join(",")
    ) {
      defragmented[defragmented.length - 1] = createText(previous.text + node.text, previous.marks);
      continue;
    }

    defragmented.push(node);
  }

  return defragmented;
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
