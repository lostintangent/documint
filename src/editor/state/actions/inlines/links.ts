// Link mutations within an InlineRegion: wrap, update URL, remove.
import { createLink as createDocumentLinkNode, type Inline, type Link } from "@/document";
import {
  measureInlineNodeText,
  selectedNodePath,
  sliceInlineChildren,
  spliceRegionInlines,
  type InlineRegion,
  type InlineRegionReplacement,
} from "./shared";

export function wrapInlineLink(
  inlineRegion: InlineRegion,
  startOffset: number,
  endOffset: number,
  url: string,
): InlineRegionReplacement | null {
  const linkChildren = sliceInlineChildren(
    inlineRegion.children,
    startOffset,
    endOffset,
    `${inlineRegion.path}.children`,
  );

  if (linkChildren.length === 0) {
    return null;
  }

  return spliceRegionInlines(inlineRegion, startOffset, endOffset, [
    createDocumentLinkNode({
      children: linkChildren,
      path: selectedNodePath(inlineRegion),
      title: null,
      url,
    }),
  ]);
}

export function updateInlineLinkUrl(
  inlineRegion: InlineRegion,
  startOffset: number,
  endOffset: number,
  url: string,
): InlineRegionReplacement | null {
  const link = findExactInlineLink(inlineRegion.children, startOffset, endOffset);

  if (!link) {
    return null;
  }

  return spliceRegionInlines(inlineRegion, startOffset, endOffset, [
    createDocumentLinkNode({
      children: link.children,
      path: selectedNodePath(inlineRegion),
      title: link.title,
      url,
    }),
  ]);
}

export function removeInlineLink(
  inlineRegion: InlineRegion,
  startOffset: number,
  endOffset: number,
): InlineRegionReplacement | null {
  const link = findExactInlineLink(inlineRegion.children, startOffset, endOffset);

  if (!link) {
    return null;
  }

  return spliceRegionInlines(inlineRegion, startOffset, endOffset, link.children);
}

function findExactInlineLink(nodes: Inline[], startOffset: number, endOffset: number): Link | null {
  let cursor = 0;

  for (const node of nodes) {
    const nodeLength = measureInlineNodeText(node);

    if (node.type === "link" && cursor === startOffset && cursor + nodeLength === endOffset) {
      return node;
    }

    cursor += nodeLength;
  }

  return null;
}
