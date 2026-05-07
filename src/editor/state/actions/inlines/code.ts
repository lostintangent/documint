import { createCode, createText, type Code, type Inline } from "@/document";
import {
  createInlineRegionReplacement,
  extractInlineSelectionText,
  measureInlineNodeText,
  spliceInlineNodes,
  type InlineRegion,
  type InlineRegionReplacement,
} from "./shared";

export function toggleInlineCode(
  inlineRegion: InlineRegion,
  startOffset: number,
  endOffset: number,
): InlineRegionReplacement | null {
  const nextChildren = toggleInlineCodeNodes(
    inlineRegion.children,
    startOffset,
    endOffset,
    `${inlineRegion.path}.children`,
  );

  return nextChildren.length > 0
    ? createInlineRegionReplacement(inlineRegion, nextChildren, startOffset, endOffset)
    : null;
}

function toggleInlineCodeNodes(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  path: string,
): Inline[] {
  const exactInlineCode = resolveExactSelectedInlineCode(nodes, startOffset, endOffset);

  if (exactInlineCode) {
    const replacement =
      exactInlineCode.code.length > 0
        ? [createText({ text: exactInlineCode.code, marks: [], path: `${path}.selected` })]
        : [];
    return spliceInlineNodes(nodes, startOffset, endOffset, path, replacement);
  }

  const selectedText = extractInlineSelectionText(nodes, startOffset, endOffset);

  if (selectedText.length === 0) {
    return nodes;
  }

  return spliceInlineNodes(nodes, startOffset, endOffset, path, [
    createCode({ code: selectedText, path: `${path}.selected` }),
  ]);
}

function resolveExactSelectedInlineCode(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
): Code | null {
  let cursor = 0;

  for (const node of nodes) {
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (startOffset === nodeStart && endOffset === nodeEnd && node.type === "code") {
      return node;
    }

    if (node.type === "link") {
      const nested = resolveExactSelectedInlineCode(
        node.children,
        Math.max(0, startOffset - nodeStart),
        Math.min(nodeLength, endOffset - nodeStart),
      );

      if (nested) {
        return nested;
      }
    }
  }

  return null;
}
