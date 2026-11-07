// Link mutations within an InlineContainer: wrap, update URL, remove.
import {
  createLink as createDocumentLinkNode,
  isReferenceInlineNode,
  type Inline,
  type Link,
} from "@/document";
import { inlineNodesWithEditorRanges } from "@/editor/text/inline-offsets";
import {
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

  // Link text can't carry images, mentions, or resources in our markdown
  // dialect, so a range containing one isn't linkable.
  if (linkChildren.length === 0 || linkChildren.some(isReferenceInlineNode)) {
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
  for (const { node, start, end } of inlineNodesWithEditorRanges(nodes)) {
    if (node.type === "link" && start === startOffset && end === endOffset) {
      return node;
    }
  }

  return null;
}
