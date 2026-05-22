import { createCode, createText, iterateInlineNodeRanges, type Code, type Inline } from "@/document";
import {
  createInlineContainerReplacement,
  extractInlineSelectionText,
  spliceInlineNodes,
  type InlineContainer,
  type InlineContainerReplacement,
} from "./shared";

export function toggleInlineCode(
  inlineContainer: InlineContainer,
  startOffset: number,
  endOffset: number,
): InlineContainerReplacement | null {
  if (startOffset === endOffset) {
    return null;
  }

  const nextChildren = toggleInlineCodeNodes(inlineContainer.children, startOffset, endOffset);

  return nextChildren !== inlineContainer.children && nextChildren.length > 0
    ? createInlineContainerReplacement(inlineContainer, nextChildren, startOffset, endOffset)
    : null;
}

function toggleInlineCodeNodes(nodes: Inline[], startOffset: number, endOffset: number): Inline[] {
  const exactInlineCode = resolveExactSelectedInlineCode(nodes, startOffset, endOffset);

  if (exactInlineCode) {
    const replacement =
      exactInlineCode.code.length > 0 ? [createText(exactInlineCode.code, [])] : [];
    return spliceInlineNodes(nodes, startOffset, endOffset, replacement);
  }

  const selectedText = extractInlineSelectionText(nodes, startOffset, endOffset);

  if (selectedText.length === 0) {
    return nodes;
  }

  return spliceInlineNodes(nodes, startOffset, endOffset, [createCode(selectedText)]);
}

function resolveExactSelectedInlineCode(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
): Code | null {
  for (const { node, start, end } of iterateInlineNodeRanges(nodes)) {
    if (startOffset === start && endOffset === end && node.type === "code") {
      return node;
    }

    if (node.type === "link") {
      const nested = resolveExactSelectedInlineCode(
        node.children,
        Math.max(0, startOffset - start),
        Math.min(end - start, endOffset - start),
      );

      if (nested) {
        return nested;
      }
    }
  }

  return null;
}
