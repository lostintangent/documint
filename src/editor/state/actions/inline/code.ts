import { type Code, type Inline } from "@/document";
import type { InlineCommandReplacement, InlineCommandTarget } from "./target";
import { createInlineCommandReplacement } from "./target";
import {
  measureInlineNodeText,
  extractInlineSelectionText,
  createPathTextNode,
  createPathInlineCodeNode,
  spliceInlineNodes,
} from "./shared";

export function toggleInlineCodeTarget(
  target: InlineCommandTarget,
  startOffset: number,
  endOffset: number,
): InlineCommandReplacement | null {
  const nextChildren = toggleInlineCodeNodes(
    target.children,
    startOffset,
    endOffset,
    `${target.path}.children`,
  );

  return nextChildren.length > 0
    ? createInlineCommandReplacement(target, nextChildren, startOffset, endOffset)
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
    return spliceInlineNodes(
      nodes,
      startOffset,
      endOffset,
      path,
      createPathTextNode(exactInlineCode.code, [], `${path}.selected`),
    );
  }

  const selectedText = extractInlineSelectionText(nodes, startOffset, endOffset);

  if (selectedText.length === 0) {
    return nodes;
  }

  return spliceInlineNodes(
    nodes,
    startOffset,
    endOffset,
    path,
    createPathInlineCodeNode(selectedText, `${path}.selected`),
  );
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

    if (startOffset === nodeStart && endOffset === nodeEnd && node.type === "inlineCode") {
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

