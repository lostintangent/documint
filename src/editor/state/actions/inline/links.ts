// Link manipulation: create, update, and remove inline links.
import {
  createLink as createDocumentLinkNode,
  defragmentTextInlines,
  type Inline,
} from "@/document";
import type { DocumentIndex } from "../../index/types";
import type { InlineRegion, InlineRegionReplacement } from ".";
import { createInlineRegionReplacement, replaceInlineRange } from ".";
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
    (inlineRegion, resolvedStartOffset, resolvedEndOffset) =>
      replaceExactInlineLink(inlineRegion, resolvedStartOffset, resolvedEndOffset, url),
  );
}

export function replaceExactInlineLink(
  inlineRegion: InlineRegion,
  startOffset: number,
  endOffset: number,
  url: string | null,
): InlineRegionReplacement | null {
  const nextChildren = defragmentTextInlines(
    replaceExactInlineLinkInNodes(
      inlineRegion.children,
      startOffset,
      endOffset,
      url,
      `${inlineRegion.path}.children`,
    ) ?? [],
  );

  return nextChildren.length > 0
    ? createInlineRegionReplacement(inlineRegion, nextChildren, startOffset, endOffset)
    : null;
}

function replaceExactInlineLinkInNodes(
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
