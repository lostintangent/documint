// Inline actions barrel. These helpers receive resolved inline context and
// produce reducer actions; context resolution stays in `context.ts`.
//
// More specific inline actions live in sibling modules (marks, code, links)
// and are re-exported from here.

import type { Inline } from "@/document";
import type { EditorStateAction } from "../../types";
import {
  spliceInlineContainer,
  type InlineContainer,
  type InlineContainerReplacement,
} from "./shared";
import type { InlineContext } from "../../context";

export type { InlineContainer, InlineContainerReplacement } from "./shared";

export { toggleInlineMark, resolveInlineMarks } from "./marks";
export { toggleInlineCode } from "./code";
export { resolveImageResize, type ImageResizeTarget } from "./images";
export { removeInlineLink, updateInlineLinkUrl, wrapInlineLink } from "./links";
export { resolveMentionReplacement } from "./mentions";

// Runs `applyEdit` over a resolved inline range and wraps the resulting
// replacement in a `replace-block` action.
export function resolveInlineRangeReplacement(
  context: InlineContext,
  applyEdit: (
    inlineContainer: InlineContainer,
    startOffset: number,
    endOffset: number,
  ) => InlineContainerReplacement | null,
): EditorStateAction | null {
  const replacement = applyEdit(context.inlineContainer, context.startOffset, context.endOffset);

  return replacement
    ? {
        kind: "replace-block",
        block: replacement.block,
        blockId: replacement.blockId,
        selection: replacement.selection,
      }
    : null;
}

// Inserts a single inline node over a resolved inline range.
export function insertInlineNode(context: InlineContext, node: Inline): EditorStateAction {
  return {
    kind: "replace-block",
    ...spliceInlineContainer(context.inlineContainer, context.startOffset, context.endOffset, [
      node,
    ]),
  };
}

// Splices a sequence of inline nodes over a resolved inline range.
export function insertInlines(context: InlineContext, inlines: Inline[]): EditorStateAction {
  return {
    kind: "replace-block",
    ...spliceInlineContainer(
      context.inlineContainer,
      context.startOffset,
      context.endOffset,
      inlines,
    ),
  };
}
