// Plain-text projection of semantic document content. Builders use the inline
// projection to create each node's cached `plainText`; document/query code then
// composes committed block/cell `plainText` fields so anchoring, fragments, and
// future content search all share the same semantic text without markdown
// syntax.

import type { Block, Fragment, Inline } from "../types";

export function extractPlainTextFromInlineNodes(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "lineBreak":
          return "\n";
        case "image":
          return node.alt ?? "";
        case "mention":
          return `@${node.name}`;
        case "resource":
          return node.label;
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

// Plain-text projection of a single uncommitted block shape. Builders call this
// before a node has a durable id, while document queries over committed
// snapshots should prefer the cached `plainText` fields already stored on the
// document model.
export function extractBlockPlainText(node: Block): string {
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
      return node.rows.map((row) => row.cells.map((cell) => cell.plainText).join(" | ")).join("\n");
    case "divider":
      return "";
    case "raw":
      return node.source;
  }
}

// Canonical plain-text projection of a block tree. The result is `.trim()`-ed
// so it matches the canonical form cached on `block.plainText` for container
// blocks (blockquote, listItem) — callers that compare against `plainText` get
// the same answer either way. If you need an untrimmed projection of a single
// node, use `extractBlockPlainText` directly.
//
// Reads each block's cached `plainText` field directly rather than routing
// through `extractBlockPlainText`. Every `Block` reaches this function via a
// builder (`createParagraphBlock`, `createBlockquoteBlock`, etc.) that
// already computed `plainText` from the same text content a recursive walk
// would visit; recursing here would redo `O(total descendant text)` work
// per nesting level for callers like `createListItemBlock` /
// `createBlockquoteBlock`. The cached read keeps the per-call cost
// proportional to the immediate child count.
export function extractPlainTextFromBlockNodes(nodes: readonly Block[]): string {
  return nodes
    .map((node) => node.plainText)
    .join("\n")
    .trim();
}

// Whether an inline list could be losslessly represented as a plain string
// — every node is an unmarked text node. Used by the fragment extractor
// and the markdown bridge to take the `Fragment.text` fast path when the
// slice carries no marks, links, images, or breaks.
export function isPlainTextInlines(inlines: readonly Inline[]): boolean {
  return inlines.every((node) => node.type === "text" && node.marks.length === 0);
}

// Whether a block list could be losslessly represented as a plain string —
// a single paragraph whose children are themselves plain text. Composes
// `isPlainTextInlines` for the inline-level check.
export function isPlainTextBlocks(blocks: readonly Block[]): boolean {
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
