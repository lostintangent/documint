// Canonical semantic document construction plus small format-agnostic helpers
// shared across markdown, editor, comments, and tests.
import type { CommentThread } from "@/comments";
import {
  type Block,
  type Document,
  type DocumentInit,
  type HeadingBlock,
  type Inline,
  type TableRow,
} from "./types";

export function buildDocument({
  blocks,
  comments,
}: DocumentInit): Document {
  return {
    blocks: blocks.map((block, index) => normalizeRootBlock(block, index)),
    comments: comments ?? [],
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
          return node.raw;
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
          return node.value;
        case "heading":
        case "paragraph":
          return extractPlainTextFromInlineNodes(node.children);
        case "list":
          return node.children.map((child) => child.plainText).join("\n");
        case "table":
          return node.rows
            .map((row) => row.cells.map((cell) => cell.plainText).join(" | "))
            .join("\n");
        case "thematicBreak":
          return "";
        case "unsupported":
          return node.raw;
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
        id: nodeId("code", path, `${node.language ?? ""}:${node.value}`),
        language: node.language,
        meta: node.meta,
        plainText: node.value,
        type: "code",
        value: node.value,
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
      const children = node.children.map((child, index) =>
        normalizeBlockNode(child, `${path}.children.${index}`),
      ) as Extract<Block, { type: "listItem" }>[];
      const plainText = children.map((child) => child.plainText).join("\n");

      return {
        children,
        id: nodeId("list", path, `${String(node.ordered)}:${plainText}`),
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
        id: nodeId("unsupported", path, node.raw),
        originalType: node.originalType,
        plainText: node.raw,
        raw: node.raw,
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
        id: nodeId("unsupported", path, node.raw),
        originalType: node.originalType,
        raw: node.raw,
        type: "unsupported",
      };
  }
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
