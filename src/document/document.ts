// Canonical semantic document construction plus small format-agnostic helpers
// shared across markdown, editor, comments, and tests.
import type { CommentThread } from "./comments";
import {
  createBlockquoteBlock,
  rebuildListBlock,
  rebuildListItemBlock,
  rebuildTableBlock,
  rebuildTextBlock,
} from "./build";
import {
  type Block,
  type Document,
  type Fragment,
  type HeadingBlock,
  type Inline,
  type ListItemBlock,
  type TableRow,
} from "./types";
import { mapBlockTree } from "./visit";

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

// Walks the block tree to find the block with the matching id, calls
// `replacer` with the current block, and returns a new document with the
// containing root block rebuilt around the result. Returns null if the id
// isn't found or the replacer returns null. Pass `rootIndex` when the
// caller already knows which root contains the target — the search skips
// straight to that root.
export function replaceDocumentBlock(
  document: Document,
  blockId: string,
  replacer: (block: Block) => Block | null,
  rootIndex?: number,
): Document | null {
  if (rootIndex !== undefined) {
    return replaceBlockInRoot(document, rootIndex, blockId, replacer);
  }

  for (let index = 0; index < document.blocks.length; index += 1) {
    const next = replaceBlockInRoot(document, index, blockId, replacer);

    if (next) {
      return next;
    }
  }

  return null;
}

function replaceBlockInRoot(
  document: Document,
  rootIndex: number,
  blockId: string,
  replacer: (block: Block) => Block | null,
): Document | null {
  const rootBlock = document.blocks[rootIndex];

  if (!rootBlock) {
    return null;
  }

  const nextRootBlock = replaceBlockInTree(rootBlock, blockId, replacer);

  return nextRootBlock ? spliceDocument(document, rootIndex, 1, [nextRootBlock]) : null;
}

function replaceBlockInTree(
  block: Block,
  targetBlockId: string,
  replacer: (block: Block) => Block | null,
): Block | null {
  if (block.id === targetBlockId) {
    return replacer(block);
  }

  switch (block.type) {
    case "blockquote": {
      const nextChildren = replaceBlockInChildren(block.children, targetBlockId, replacer);
      return nextChildren ? createBlockquoteBlock({ children: nextChildren }) : null;
    }
    case "listItem": {
      const nextChildren = replaceBlockInChildren(block.children, targetBlockId, replacer);
      return nextChildren ? rebuildListItemBlock(block, nextChildren) : null;
    }
    case "list": {
      const nextItems = replaceBlockInChildren(block.items, targetBlockId, replacer) as
        | ListItemBlock[]
        | null;
      return nextItems ? rebuildListBlock(block, nextItems) : null;
    }
    default:
      return null;
  }
}

function replaceBlockInChildren(
  blocks: Block[],
  targetBlockId: string,
  replacer: (block: Block) => Block | null,
) {
  let didChange = false;

  const nextBlocks = blocks.map((block) => {
    const nextBlock = replaceBlockInTree(block, targetBlockId, replacer);

    if (!nextBlock) {
      return block;
    }

    didChange = true;
    return nextBlock;
  });

  return didChange ? nextBlocks : null;
}

export function extractPlainTextFromInlineNodes(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "lineBreak":
          return "\n";
        case "image":
          return node.alt ?? "";
        case "code":
          return node.code;
        case "link":
          return extractPlainTextFromInlineNodes(node.children);
        case "text":
          return node.text;
        case "raw":
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
        case "divider":
          return "";
        case "raw":
          return node.source;
      }
    })
    .join("\n")
    .trim();
}

// Whether an inline list could be losslessly represented as a plain string
// — every node is an unmarked text node. Used by the fragment extractor
// and the markdown bridge to take the `Fragment.text` fast path when the
// slice carries no marks, links, images, or breaks.
export function isPlainTextInlines(inlines: Inline[]): boolean {
  return inlines.every((node) => node.type === "text" && node.marks.length === 0);
}

// Whether a block list could be losslessly represented as a plain string —
// a single paragraph whose children are themselves plain text. Composes
// `isPlainTextInlines` for the inline-level check.
export function isPlainTextBlocks(blocks: Block[]): boolean {
  if (blocks.length !== 1) {
    return false;
  }

  const block = blocks[0]!;

  return block.type === "paragraph" && isPlainTextInlines(block.children);
}

// Plain-text projection of a `Fragment`, regardless of variant. Used as a
// fallback when a destination can't accept the fragment structurally
// (table cell paste, code block paste) and the editor wants to drop the
// content in as bare characters.
export function extractPlainTextFromFragment(fragment: Fragment): string {
  switch (fragment.kind) {
    case "text":
      return fragment.text;
    case "inlines":
      return extractPlainTextFromInlineNodes(fragment.inlines);
    case "blocks":
      return extractPlainTextFromBlockNodes(fragment.blocks);
  }
}

// Polymorphic block-tree helpers. The semantic block union stores container
// children under different field names (`list.items`, `blockquote.children`,
// `listItem.children`); these accessors close that leak for callers that want
// to traverse or rebuild the tree without re-deriving the dispatch each time.
export function getBlockChildren(block: Block): Block[] | null {
  switch (block.type) {
    case "blockquote":
    case "listItem":
      return block.children;
    case "list":
      return block.items;
    default:
      return null;
  }
}

// Rebuilds a container block with a replacement child list. Returns null when
// the block is not a container or when the replacement would be empty; empty
// structural containers carry no visible content and collapse out of the model.
export function replaceBlockChildren(block: Block, children: Block[]): Block | null {
  if (children.length === 0) {
    return null;
  }

  switch (block.type) {
    case "blockquote":
      return createBlockquoteBlock({ children });
    case "list":
      return rebuildListBlock(block, children as ListItemBlock[]);
    case "listItem":
      return rebuildListItemBlock(block, children);
    default:
      return null;
  }
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
    case "divider":
      return {
        id: nodeId("divider", path, "divider"),
        plainText: "",
        type: "divider",
      };
    case "raw":
      return {
        id: nodeId("raw", path, node.source),
        originalType: node.originalType,
        plainText: node.source,
        source: node.source,
        type: "raw",
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
    case "lineBreak":
      return {
        id: nodeId("lineBreak", path, "lineBreak"),
        type: "lineBreak",
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
    case "code":
      return {
        code: node.code,
        id: nodeId("code", path, node.code),
        type: "code",
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
    case "raw":
      return {
        id: nodeId("raw", path, node.source),
        originalType: node.originalType,
        source: node.source,
        type: "raw",
      };
  }
}

export function trimTrailingWhitespace(blocks: Block[]): Block[] {
  return mapBlockTree(blocks, (block, { recurse }) => {
    switch (block.type) {
      case "blockquote":
      case "list":
      case "listItem":
        return recurse();
      case "heading":
      case "paragraph":
        return rebuildTextBlock(block, trimTrailingInlineWhitespace(block.children));
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

// Trim trailing whitespace from the last non-empty text run in an inline list,
// recursing into the tail of any link encountered. The walk goes right-to-left
// and stops at the first node that doesn't change, so the average case visits a
// single text node. Returns the input array unchanged (===) when nothing
// trimmed, so callers can use referential equality as a fast no-op check.
function trimTrailingInlineWhitespace(nodes: Inline[]): Inline[] {
  let nextNodes: Inline[] | null = null;
  const ensureMutable = () => (nextNodes ??= [...nodes]);

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;

    if (node.type === "text") {
      const trimmedText = node.text.replace(/[ \t]+$/u, "");

      if (trimmedText.length === node.text.length) {
        return nextNodes ?? nodes;
      }

      const mutable = ensureMutable();

      if (trimmedText.length === 0) {
        mutable.splice(index, 1);
        continue;
      }

      mutable[index] = { ...node, text: trimmedText };

      return mutable;
    }

    if (node.type === "link") {
      const trimmedChildren = trimTrailingInlineWhitespace(node.children);

      if (trimmedChildren === node.children) {
        return nextNodes ?? nodes;
      }

      const mutable = ensureMutable();

      if (trimmedChildren.length === 0) {
        mutable.splice(index, 1);
        continue;
      }

      mutable[index] = { ...node, children: trimmedChildren };

      return mutable;
    }

    return nextNodes ?? nodes;
  }

  return nextNodes ?? nodes;
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
