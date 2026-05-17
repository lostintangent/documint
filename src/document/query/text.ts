// Plain-text projection of the semantic document. Pure data over `Block` and
// `Inline` trees — no IDs, no normalization, no side effects. Used wherever the
// editor, comments, or markdown layer needs a readable string view of structural
// content: comment quotes, fragment-to-text fallbacks, list-item digests, and
// the canonical `plainText` field cached on every block.

import type { Block, Fragment, Inline } from "../types";

export function extractPlainTextFromInlineNodes(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "lineBreak":
          return "\n";
        case "image":
          return node.alt ?? "";
        case "mention":
          return `@${node.name}`;
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

// Plain-text projection of a single block. Used by the normalizer to derive
// each block's canonical `plainText` field, and by `extractPlainTextFromBlockNodes`
// as the per-node recipe. Container blocks read their children's cached
// `plainText` where possible (list, table) and recurse otherwise (blockquote,
// listItem); inline-container blocks (heading, paragraph) project their inline
// children directly.
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
      return node.rows
        .map((row) => row.cells.map((cell) => cell.plainText).join(" | "))
        .join("\n");
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
export function extractPlainTextFromBlockNodes(nodes: Block[]): string {
  return nodes.map(extractBlockPlainText).join("\n").trim();
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
