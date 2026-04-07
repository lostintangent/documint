// Semantic node builders and rebuild helpers. These own semantic node shape and
// derived fields such as plain-text projections. When a path is provided they
// also derive deterministic pre-build IDs, but canonical document IDs still
// come from `buildDocument(...)` and `spliceDocument(...)`.
import {
  extractPlainTextFromBlockNodes,
  extractPlainTextFromInlineNodes,
  nodeId,
} from "./document";
import type {
  Block,
  BlockquoteBlock,
  LineBreak,
  CodeBlock,
  HeadingBlock,
  Image,
  Code,
  Inline,
  Link,
  ListBlock,
  ListItemBlock,
  Mark,
  ParagraphBlock,
  TableBlock,
  TableCell,
  TableRow,
  Text,
  DividerBlock,
  RawBlock,
  Raw,
} from "./types";

type PathOptions = {
  path?: string;
};

export function createText(options: {
  marks?: Mark[];
  text: string;
} & PathOptions): Text {
  const marks = options.marks ?? [];

  return {
    id: resolveNodeId(options.path, "text", `${options.text}:${marks.join(",")}`),
    marks,
    text: options.text,
    type: "text",
  };
}

export function createLineBreak(options: PathOptions = {}): LineBreak {
  return {
    id: resolveNodeId(options.path, "break", "break"),
    type: "break",
  };
}

export function createCode(options: { code: string } & PathOptions): Code {
  return {
    code: options.code,
    id: resolveNodeId(options.path, "inlineCode", options.code),
    type: "inlineCode",
  };
}

export function createLink(options: {
  children: Inline[];
  title?: string | null;
  url: string;
} & PathOptions): Link {
  return {
    children: options.children,
    id: resolveNodeId(
      options.path,
      "link",
      `${options.url}:${extractPlainTextFromInlineNodes(options.children)}`,
    ),
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
} & PathOptions): Image {
  const alt = options.alt ?? null;
  const width = options.width ?? null;

  return {
    alt,
    id: resolveNodeId(options.path, "image", `${options.url}:${width ?? ""}:${alt ?? ""}`),
    title: options.title ?? null,
    type: "image",
    url: options.url,
    width,
  };
}

export function createRaw(options: {
  originalType: string;
  raw: string;
} & PathOptions): Raw {
  return {
    id: resolveNodeId(options.path, "unsupported", options.raw),
    originalType: options.originalType,
    raw: options.raw,
    type: "unsupported",
  };
}

export function createParagraphBlock(options: {
  children: Inline[];
} & PathOptions): ParagraphBlock {
  const plainText = extractPlainTextFromInlineNodes(options.children);

  return {
    children: options.children,
    id: resolveNodeId(options.path, "paragraph", plainText),
    plainText,
    type: "paragraph",
  };
}

export function createParagraphTextBlock(options: {
  text: string;
}): ParagraphBlock {
  return createParagraphBlock({
    children: createTextChildren(undefined, options.text),
  });
}

export function createHeadingBlock(options: {
  children: Inline[];
  depth: HeadingBlock["depth"];
} & PathOptions): HeadingBlock {
  const plainText = extractPlainTextFromInlineNodes(options.children);

  return {
    children: options.children,
    depth: options.depth,
    id: resolveNodeId(options.path, "heading", `${options.depth}:${plainText}`),
    plainText,
    type: "heading",
  };
}

export function createHeadingTextBlock(options: {
  depth: HeadingBlock["depth"];
  text: string;
}): HeadingBlock {
  return createHeadingBlock({
    children: createTextChildren(undefined, options.text),
    depth: options.depth,
  });
}

export function createListItemBlock(options: {
  checked?: boolean | null;
  children: Block[];
  spread?: boolean;
} & PathOptions): ListItemBlock {
  const plainText = extractPlainTextFromBlockNodes(options.children);

  return {
    checked: options.checked ?? null,
    children: options.children,
    id: resolveNodeId(options.path, "listItem", plainText),
    plainText,
    spread: options.spread ?? false,
    type: "listItem",
  };
}

export function createListBlock(options: {
  children: ListItemBlock[];
  ordered: boolean;
  spread?: boolean;
  start?: number | null;
} & PathOptions): ListBlock {
  const plainText = options.children.map((child) => child.plainText).join("\n");

  return {
    children: options.children,
    id: resolveNodeId(options.path, "list", `${String(options.ordered)}:${plainText}`),
    ordered: options.ordered,
    plainText,
    spread: options.spread ?? false,
    start: options.start ?? null,
    type: "list",
  };
}

export function createBlockquoteBlock(options: {
  children: Block[];
} & PathOptions): BlockquoteBlock {
  const plainText = extractPlainTextFromBlockNodes(options.children);

  return {
    children: options.children,
    id: resolveNodeId(options.path, "blockquote", plainText),
    plainText,
    type: "blockquote",
  };
}

export function createCodeBlock(options: {
  language?: string | null;
  meta?: string | null;
  value: string;
} & PathOptions): CodeBlock {
  return {
    id: resolveNodeId(options.path, "code", `${options.language ?? ""}:${options.value}`),
    language: options.language ?? null,
    meta: options.meta ?? null,
    plainText: options.value,
    type: "code",
    value: options.value,
  };
}

export function createTableCell(options: {
  children: Inline[];
} & PathOptions): TableCell {
  const plainText = extractPlainTextFromInlineNodes(options.children);

  return {
    children: options.children,
    id: resolveNodeId(options.path, "tableCell", plainText),
    plainText,
  };
}

export function createTableRow(options: {
  cells: TableCell[];
} & PathOptions): TableRow {
  return {
    cells: options.cells,
    id: resolveNodeId(options.path, "tableRow", String(options.cells.length)),
  };
}

export function createTableBlock(options: {
  align?: TableBlock["align"];
  rows: TableRow[];
} & PathOptions): TableBlock {
  const plainText = options.rows
    .map((row) => row.cells.map((cell) => cell.plainText).join(" | "))
    .join("\n");

  return {
    align: options.align ?? [],
    id: resolveNodeId(options.path, "table", plainText),
    plainText,
    rows: options.rows,
    type: "table",
  };
}

export function createDividerBlock(): DividerBlock {
  return {
    id: "",
    plainText: "",
    type: "thematicBreak",
  };
}

export function createRawBlock(options: {
  originalType: string;
  raw: string;
} & PathOptions): RawBlock {
  return {
    id: resolveNodeId(options.path, "unsupported", options.raw),
    originalType: options.originalType,
    plainText: options.raw,
    raw: options.raw,
    type: "unsupported",
  };
}

export function rebuildTextBlock(
  block: HeadingBlock | ParagraphBlock,
  children: Inline[],
) {
  return block.type === "heading"
    ? createHeadingBlock({
        children,
        depth: block.depth,
      })
    : createParagraphBlock({
        children,
      });
}

export function rebuildListItemBlock(
  block: ListItemBlock,
  children: Block[],
): ListItemBlock {
  return createListItemBlock({
    checked: block.checked,
    children,
    spread: block.spread,
  });
}

export function rebuildListBlock(
  block: ListBlock,
  children: ListItemBlock[],
  overrides: Partial<Pick<ListBlock, "ordered" | "spread" | "start">> = {},
): ListBlock {
  return createListBlock({
    children,
    ordered: overrides.ordered ?? block.ordered,
    spread: overrides.spread ?? block.spread,
    start: overrides.start ?? block.start,
  });
}

export function rebuildTableBlock(
  block: TableBlock,
  rows: TableRow[],
): TableBlock {
  return createTableBlock({
    align: block.align,
    rows,
  });
}

export function rebuildCodeBlock(
  block: CodeBlock,
  value: string,
): CodeBlock {
  return createCodeBlock({
    language: block.language,
    meta: block.meta,
    value,
  });
}

export function rebuildRawBlock(
  block: RawBlock,
  raw: string,
): RawBlock {
  return createRawBlock({
    originalType: block.originalType,
    raw,
  });
}

function createTextChildren(path: string | undefined, text: string): Text[] {
  return text.length > 0
    ? [createText({
        path: path ? `${path}.children.0` : undefined,
        text,
      })]
    : [];
}

function resolveNodeId(path: string | undefined, type: string, semanticSeed: string) {
  return path ? nodeId(type, path, semanticSeed) : "";
}
