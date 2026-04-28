// Canonical semantic document construction plus small format-agnostic helpers
// shared across markdown, editor, comments, and tests.
import type { CommentThread } from "./comments";
import { rebuildTableBlock, rebuildTextBlock } from "./build";
import { type Block, type Document, type HeadingBlock, type Inline, type TableRow } from "./types";

export function createDocument(
  blocks: Block[],
  comments: CommentThread[] = [],
  frontMatter?: string,
): Document {
  return {
    blocks: blocks.map((block, index) => normalizeRootBlock(block, index)),
    comments,
    frontMatter,
  };
}

export function spliceDocument(
  document: Document,
  rootIndex: number,
  count: number,
  replacements: Block[],
): Document {
  const normalizedReplacements = replacements.map((block, index) =>
    normalizeRootBlock(block, rootIndex + index),
  );
  const suffix = document.blocks.slice(rootIndex + count);
  const normalizedSuffix =
    replacements.length === count
      ? suffix
      : suffix.map((block, index) =>
          normalizeRootBlock(block, rootIndex + normalizedReplacements.length + index),
        );

  return {
    blocks: [
      ...document.blocks.slice(0, rootIndex),
      ...normalizedReplacements,
      ...normalizedSuffix,
    ],
    comments: document.comments,
    frontMatter: document.frontMatter,
  };
}

export function spliceCommentThreads(
  document: Document,
  index: number,
  count: number,
  threads: CommentThread[],
): Document {
  return {
    blocks: document.blocks,
    comments: [
      ...document.comments.slice(0, index),
      ...threads,
      ...document.comments.slice(index + count),
    ],
    frontMatter: document.frontMatter,
  };
}

export function extractPlainTextFromInlineNodes(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "break":
          return "\n";
        case "image":
          return node.alt ?? "";
        case "inlineCode":
          return node.code;
        case "link":
          return extractPlainTextFromInlineNodes(node.children);
        case "text":
          return node.text;
        case "unsupported":
          return node.source;
      }
    })
    .join("");
}

export function extractPlainTextFromBlockNodes(nodes: Block[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "blockquote":
        case "listItem":
          return extractPlainTextFromBlockNodes(node.children);
        case "code":
          return node.source;
        case "directive":
          return node.body;
        case "heading":
        case "paragraph":
          return extractPlainTextFromInlineNodes(node.children);
        case "list":
          return node.items.map((child) => child.plainText).join("\n");
        case "table":
          return node.rows
            .map((row) => row.cells.map((cell) => cell.plainText).join(" | "))
            .join("\n");
        case "thematicBreak":
          return "";
        case "unsupported":
          return node.source;
      }
    })
    .join("\n")
    .trim();
}

function normalizeRootBlock(block: Block, rootIndex: number) {
  return normalizeBlockNode(block, `root.${rootIndex}`);
}

function normalizeBlockNode(node: Block, path: string): Block {
  switch (node.type) {
    case "blockquote": {
      const children = node.children.map((child, index) =>
        normalizeBlockNode(child, `${path}.children.${index}`),
      );
      const plainText = extractPlainTextFromBlockNodes(children);

      return {
        children,
        id: nodeId("blockquote", path, plainText),
        plainText,
        type: "blockquote",
      };
    }
    case "code":
      return {
        id: nodeId("code", path, `${node.language ?? ""}:${node.source}`),
        language: node.language,
        meta: node.meta,
        plainText: node.source,
        source: node.source,
        type: "code",
      };
    case "directive":
      return {
        attributes: node.attributes,
        body: node.body,
        id: nodeId("directive", path, `${node.name}{${node.attributes}}:${node.body}`),
        name: node.name,
        plainText: node.body,
        type: "directive",
      };
    case "heading": {
      const children = node.children.map((child, index) =>
        normalizeInlineNode(child, `${path}.children.${index}`),
      );
      const plainText = extractPlainTextFromInlineNodes(children);

      return {
        children,
        depth: node.depth,
        id: nodeId("heading", path, `${node.depth}:${plainText}`),
        plainText,
        type: "heading",
      } satisfies HeadingBlock;
    }
    case "list": {
      const items = node.items.map((child, index) =>
        normalizeBlockNode(child, `${path}.children.${index}`),
      ) as Extract<Block, { type: "listItem" }>[];
      const plainText = items.map((child) => child.plainText).join("\n");

      return {
        id: nodeId("list", path, `${String(node.ordered)}:${plainText}`),
        items,
        ordered: node.ordered,
        plainText,
        spread: node.spread,
        start: node.start,
        type: "list",
      };
    }
    case "listItem": {
      const children = node.children.map((child, index) =>
        normalizeBlockNode(child, `${path}.children.${index}`),
      );
      const plainText = extractPlainTextFromBlockNodes(children);

      return {
        checked: node.checked,
        children,
        id: nodeId("listItem", path, plainText),
        plainText,
        spread: node.spread,
        type: "listItem",
      };
    }
    case "paragraph": {
      const children = node.children.map((child, index) =>
        normalizeInlineNode(child, `${path}.children.${index}`),
      );
      const plainText = extractPlainTextFromInlineNodes(children);

      return {
        children,
        id: nodeId("paragraph", path, plainText),
        plainText,
        type: "paragraph",
      };
    }
    case "table": {
      const rows = node.rows.map((row, rowIndex) =>
        normalizeTableRowNode(row, `${path}.rows.${rowIndex}`),
      );
      const plainText = rows
        .map((row) => row.cells.map((cell) => cell.plainText).join(" | "))
        .join("\n");

      return {
        align: node.align,
        id: nodeId("table", path, plainText),
        plainText,
        rows,
        type: "table",
      };
    }
    case "thematicBreak":
      return {
        id: nodeId("thematicBreak", path, "thematic-break"),
        plainText: "",
        type: "thematicBreak",
      };
    case "unsupported":
      return {
        id: nodeId("unsupported", path, node.source),
        originalType: node.originalType,
        plainText: node.source,
        source: node.source,
        type: "unsupported",
      };
  }
}

function normalizeTableRowNode(row: TableRow, path: string): TableRow {
  return {
    cells: row.cells.map((cell, cellIndex) => {
      const children = cell.children.map((child, index) =>
        normalizeInlineNode(child, `${path}.cells.${cellIndex}.children.${index}`),
      );
      const plainText = extractPlainTextFromInlineNodes(children);

      return {
        children,
        id: nodeId("tableCell", `${path}.cells.${cellIndex}`, plainText),
        plainText,
      };
    }),
    id: nodeId("tableRow", path, String(row.cells.length)),
  };
}

function normalizeInlineNode(node: Inline, path: string): Inline {
  switch (node.type) {
    case "break":
      return {
        id: nodeId("break", path, "break"),
        type: "break",
      };
    case "image":
      return {
        alt: node.alt,
        id: nodeId("image", path, `${node.url}:${node.width ?? ""}:${node.alt ?? ""}`),
        title: node.title,
        type: "image",
        url: node.url,
        width: node.width,
      };
    case "inlineCode":
      return {
        code: node.code,
        id: nodeId("inlineCode", path, node.code),
        type: "inlineCode",
      };
    case "link": {
      const children = node.children.map((child, index) =>
        normalizeInlineNode(child, `${path}.children.${index}`),
      );
      const plainText = extractPlainTextFromInlineNodes(children);

      return {
        children,
        id: nodeId("link", path, `${node.url}:${plainText}`),
        title: node.title,
        type: "link",
        url: node.url,
      };
    }
    case "text":
      return {
        id: nodeId("text", path, `${node.text}:${node.marks.join(",")}`),
        marks: node.marks,
        text: node.text,
        type: "text",
      };
    case "unsupported":
      return {
        id: nodeId("unsupported", path, node.source),
        originalType: node.originalType,
        source: node.source,
        type: "unsupported",
      };
  }
}

export function trimTrailingWhitespace(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    switch (block.type) {
      case "blockquote":
        return {
          ...block,
          children: trimTrailingWhitespace(block.children),
        };
      case "heading":
      case "paragraph":
        return rebuildTextBlock(block, trimTrailingInlineWhitespace(block.children));
      case "list":
        return {
          ...block,
          items: block.items.map((item) => ({
            ...item,
            children: trimTrailingWhitespace(item.children),
          })),
        };
      case "listItem":
        return {
          ...block,
          children: trimTrailingWhitespace(block.children),
        };
      case "table":
        return rebuildTableBlock(
          block,
          block.rows.map<TableRow>((row) => ({
            ...row,
            cells: row.cells.map((cell) => ({
              ...cell,
              children: trimTrailingInlineWhitespace(cell.children),
            })),
          })),
        );
      default:
        return block;
    }
  });
}

function trimTrailingInlineWhitespace(nodes: Inline[]): Inline[] {
  const nextNodes = [...nodes];

  for (let index = nextNodes.length - 1; index >= 0; index -= 1) {
    const node = nextNodes[index]!;

    if (node.type === "text") {
      const trimmedText = node.text.replace(/[ \t]+$/u, "");

      if (trimmedText.length === node.text.length) {
        return nextNodes;
      }

      if (trimmedText.length === 0) {
        nextNodes.splice(index, 1);
        continue;
      }

      nextNodes[index] = {
        ...node,
        text: trimmedText,
      };

      return nextNodes;
    }

    if (node.type === "link") {
      const trimmedChildren = trimTrailingInlineWhitespace(node.children);

      if (
        trimmedChildren.length === node.children.length &&
        trimmedChildren.every((child, childIndex) => child === node.children[childIndex])
      ) {
        return nextNodes;
      }

      if (trimmedChildren.length === 0) {
        nextNodes.splice(index, 1);
        continue;
      }

      nextNodes[index] = {
        ...node,
        children: trimmedChildren,
      };

      return nextNodes;
    }

    return nextNodes;
  }

  return nextNodes;
}

// Produces stable semantic node IDs from node kind, tree path, and semantic content.
export function nodeId(type: string, path: string, semanticSeed: string) {
  let hash = 2166136261;

  for (const character of `${type}:${path}:${semanticSeed}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return `${type}-${(hash >>> 0).toString(36)}`;
}
