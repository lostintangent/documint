// Link manipulation: create, update, and remove inline links.
import { createLink as createDocumentLinkNode, type Inline } from "@/document";
import { compactInlineNodes } from "../../index/shared";
import type { DocumentIndex } from "../../index/types";
import type { InlineCommandReplacement, InlineCommandTarget } from "./target";
import { createInlineCommandReplacement, replaceInlineRange } from "./target";
import { measureInlineNodeText } from "./shared";

export function replaceExactInlineLinkRange(
  documentIndex: DocumentIndex,
  regionId: string,
  startOffset: number,
  endOffset: number,
  url: string | null,
) {
  return replaceInlineRange(
    documentIndex,
    regionId,
    startOffset,
    endOffset,
    (target, resolvedStartOffset, resolvedEndOffset) =>
      replaceExactInlineLinkTarget(target, resolvedStartOffset, resolvedEndOffset, url),
  );
}

export function replaceExactInlineLinkTarget(
  target: InlineCommandTarget,
  startOffset: number,
  endOffset: number,
  url: string | null,
): InlineCommandReplacement | null {
  const nextChildren = compactInlineNodes(
    replaceExactInlineLink(
      target.children,
      startOffset,
      endOffset,
      url,
      `${target.path}.children`,
    ) ?? [],
  );

  return nextChildren.length > 0
    ? createInlineCommandReplacement(target, nextChildren, startOffset, endOffset)
    : null;
}

function replaceExactInlineLink(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  url: string | null,
  path: string,
): Inline[] | null {
  const nextNodes: Inline[] = [];
  let cursor = 0;
  let didReplace = false;

  for (const [index, node] of nodes.entries()) {
    const nodePath = `${path}.${index}`;
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (!didReplace && node.type === "link" && startOffset === nodeStart && endOffset === nodeEnd) {
      if (url === null) {
        nextNodes.push(...node.children);
      } else {
        nextNodes.push(
          createDocumentLinkNode({
            children: node.children,
            path: nodePath,
            title: node.title,
            url,
          }),
        );
      }

      didReplace = true;
      continue;
    }

    nextNodes.push(node);
  }

  return didReplace ? nextNodes : null;
}
