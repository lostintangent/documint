// Shared inline-region helpers. InlineContainer resolves editable document
// regions whose backing data is `Inline[]`; measureInlineNodeText defines the
// text-coordinate length model used by inline commands and selection queries.

import {
  extractPlainTextFromInlineNodes,
  findBlockById,
  type Block,
  type HeadingBlock,
  type Inline,
  type ParagraphBlock,
  type TableBlock,
  type TableCell,
} from "@/document";
import { INLINE_OBJECT_REPLACEMENT_TEXT } from "../index/shared";
import type { DocumentIndex } from "../index/types";

export type InlineContainer =
  | {
      block: HeadingBlock | ParagraphBlock;
      children: Inline[];
      kind: "inlineBlock";
      path: string;
    }
  | {
      block: TableBlock;
      blockPath: string;
      cell: TableCell;
      children: Inline[];
      kind: "tableCell";
      path: string;
    };

export function resolveInlineContainer(documentIndex: DocumentIndex, regionId: string) {
  const region = documentIndex.regionIndex.get(regionId);

  if (!region) {
    return null;
  }

  const block = findBlockById(documentIndex.document.blocks, region.blockId);

  if (!block) {
    return null;
  }

  return resolveInlineContainerFromBlock(block, region.path, region.semanticRegionId);
}

export function resolveInlineContainerFromBlock(
  block: Block,
  regionPath: string,
  semanticRegionId: string,
): InlineContainer | null {
  if (block.type === "heading" || block.type === "paragraph") {
    return {
      block,
      children: block.children,
      kind: "inlineBlock",
      path: regionPath.replace(/\.children$/, ""),
    };
  }

  if (block.type !== "table") {
    return null;
  }

  const cellPathMatch = /^(.*\.rows\.\d+\.cells\.\d+)$/.exec(regionPath);

  if (!cellPathMatch) {
    return null;
  }

  for (const row of block.rows) {
    for (const cell of row.cells) {
      if (cell.id === semanticRegionId) {
        return {
          block,
          blockPath: cellPathMatch[1]!.replace(/\.rows\.\d+\.cells\.\d+$/, ""),
          cell,
          children: cell.children,
          kind: "tableCell",
          path: cellPathMatch[1]!,
        };
      }
    }
  }

  return null;
}

export function measureInlineNodeText(node: Inline) {
  switch (node.type) {
    case "lineBreak":
      return 1;
    case "image":
    case "mention":
      return INLINE_OBJECT_REPLACEMENT_TEXT.length;
    case "code":
      return node.code.length;
    case "link":
      return extractPlainTextFromInlineNodes(node.children).length;
    case "text":
      return node.text.length;
    case "raw":
      return node.source.length;
  }
}
