// Mention mutations within an InlineContainer.
import { createMention, createText } from "@/document";
import type { InlineContext } from "../../context";
import type { EditorStateAction } from "../../../types";
import { spliceInlineContainer } from "./shared";

export function resolveMentionReplacement(
  context: InlineContext,
  userId: string,
  name: string,
  trailingText: string = "",
): EditorStateAction {
  const replacement = spliceInlineContainer(
    context.inlineContainer,
    context.startOffset,
    context.endOffset,
    [
      createMention({ name, userId }),
      ...(trailingText.length > 0 ? [createText(trailingText)] : []),
    ],
  );

  return {
    kind: "replace-block",
    ...replacement,
  };
}
