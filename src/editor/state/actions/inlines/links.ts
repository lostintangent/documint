// Link mutations within an InlineContainer: wrap, update URL, remove.
import { createLink as createDocumentLinkNode, type Inline, type Link } from "@/document";
import {
  measureInlineNodeText,
  sliceInlineChildren,
  spliceInlineContainer,
  type InlineContainer,
  type InlineContainerReplacement,
} from "./shared";

export function wrapInlineLink(
  inlineContainer: InlineContainer,
  startOffset: number,
  endOffset: number,
  url: string,
): InlineContainerReplacement | null {
  const linkChildren = sliceInlineChildren(inlineContainer.children, startOffset, endOffset);

  if (linkChildren.length === 0) {
    return null;
  }

  return spliceInlineContainer(inlineContainer, startOffset, endOffset, [
    createDocumentLinkNode({
      children: linkChildren,
      title: null,
      url,
    }),
  ]);
}

export function updateInlineLinkUrl(
  inlineContainer: InlineContainer,
  startOffset: number,
  endOffset: number,
  url: string,
): InlineContainerReplacement | null {
  const link = findExactInlineLink(inlineContainer.children, startOffset, endOffset);

  if (!link) {
    return null;
  }

  return spliceInlineContainer(inlineContainer, startOffset, endOffset, [
    createDocumentLinkNode({
      children: link.children,
      title: link.title,
      url,
    }),
  ]);
}

export function removeInlineLink(
  inlineContainer: InlineContainer,
  startOffset: number,
  endOffset: number,
): InlineContainerReplacement | null {
  const link = findExactInlineLink(inlineContainer.children, startOffset, endOffset);

  if (!link) {
    return null;
  }

  return spliceInlineContainer(inlineContainer, startOffset, endOffset, link.children);
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
