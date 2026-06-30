// Document-level adapter for shared completion primitives. It projects the
// editor's current collapsed selection into the active text path, then lets
// the pure completion detector operate on that path text.

import { getCaretTextContext, type EditorState, type TextRangeTarget } from "@/editor";
import {
  detectCompletionContext,
  equalCompletionItemLists,
  resolveCompletionInsertionText,
  type ActiveCompletion,
  type CompletionItem,
  type CompletionSource,
} from "./completions";

export type DocumentCompletion = ActiveCompletion & {
  path: string;
};

export function resolveDocumentCompletionContext(
  state: EditorState,
  completionSources: CompletionSource[] | undefined,
): DocumentCompletion | null {
  const textContext = getCaretTextContext(state);
  if (!textContext) {
    return null;
  }

  const activeCompletion = detectCompletionContext(
    textContext.text,
    textContext.offset,
    completionSources ?? [],
  );

  return activeCompletion ? { ...activeCompletion, path: textContext.path } : null;
}

export function equalDocumentCompletions(
  previous: DocumentCompletion | null,
  next: DocumentCompletion | null,
) {
  if (previous === next) return true;
  if (!previous || !next) return false;

  return (
    previous.path === next.path &&
    previous.trigger === next.trigger &&
    previous.query === next.query &&
    previous.triggerStart === next.triggerStart &&
    previous.caret === next.caret &&
    equalCompletionItemLists(previous.matches, next.matches)
  );
}

export type DocumentCompletionApplication =
  | {
      kind: "mention";
      name: string;
      target: TextRangeTarget;
      trailingText: string;
      userId: string;
    }
  | {
      endOffset: number;
      kind: "text";
      startOffset: number;
      text: string;
    };

export function resolveDocumentCompletionApplication(
  item: CompletionItem,
  completion: DocumentCompletion,
): DocumentCompletionApplication {
  const target = {
    endOffset: completion.caret,
    path: completion.path,
    startOffset: completion.triggerStart,
  };

  if (isDocumentMentionCompletion(item, completion)) {
    return {
      kind: "mention",
      name: item.label,
      target,
      trailingText: " ",
      userId: item.id,
    };
  }

  return {
    endOffset: completion.caret,
    kind: "text",
    startOffset: completion.triggerStart,
    text: resolveCompletionInsertionText(completion, item),
  };
}

function isDocumentMentionCompletion(
  item: CompletionItem,
  completion: ActiveCompletion,
): item is CompletionItem & { id: string } {
  return Boolean(item.id) && (item.kind === "mention" || completion.trigger === "@");
}
