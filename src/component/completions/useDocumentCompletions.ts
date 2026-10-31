import { insertMention, replaceTextRange, type EditorSelectionRange } from "@/editor";
import { useCompletions, type CompletionController } from "./useCompletions";
import { type ActiveCompletion, type CompletionItem, type CompletionSource } from "./completions";
import {
  resolveDocumentCompletionApplication,
  type DocumentCompletion,
} from "./document-completions";
import {
  documentCompletionSprig,
  useEditorCommand,
  useSprig,
  type EditorStateTransition,
} from "../store";
import type { CompletionLeaf } from "../overlays/leaves/core/shared";

export type DocumentCompletionsController = {
  handleBeforeInput: CompletionController["handleBeforeInput"];
  handleKeyDown: CompletionController["handleKeyDown"];
  leaf: CompletionLeaf | null;
};

export function useDocumentCompletions({
  completionSources,
  enabled,
  onMentionAccepted,
}: {
  completionSources: CompletionSource[] | undefined;
  enabled: boolean;
  onMentionAccepted?: (mention: {
    target: EditorSelectionRange;
    transition: EditorStateTransition;
    userId: string;
  }) => void;
}): DocumentCompletionsController {
  const activeCompletion = useSprig(
    documentCompletionSprig,
    enabled ? completionSources : undefined,
  );
  const insertMentionCommand = useEditorCommand(insertMention);
  const replaceTextRangeCommand = useEditorCommand(replaceTextRange);

  const acceptCompletion = (item: CompletionItem, completion: DocumentCompletion) => {
    const documentCompletion = resolveDocumentCompletionApplication(item, completion);

    if (documentCompletion.kind === "mention") {
      const transition = insertMentionCommand(
        documentCompletion.target,
        documentCompletion.userId,
        documentCompletion.name,
        documentCompletion.trailingText,
      );
      if (transition) {
        onMentionAccepted?.({
          target: documentCompletion.target,
          transition,
          userId: documentCompletion.userId,
        });
      }
      return;
    }

    replaceTextRangeCommand(
      documentCompletion.startOffset,
      documentCompletion.endOffset,
      documentCompletion.text,
    );
  };

  const completion = useCompletions({
    activeCompletion,
    contextKey: activeCompletion ? documentCompletionKey(activeCompletion) : null,
    onAccept: acceptCompletion,
  });

  const leaf: CompletionLeaf | null =
    activeCompletion && completion.leafProps
      ? {
          kind: "completion",
          anchor: {
            path: activeCompletion.path,
            offset: activeCompletion.triggerStart,
          },
          ...completion.leafProps,
        }
      : null;

  return {
    handleBeforeInput: completion.handleBeforeInput,
    handleKeyDown: completion.handleKeyDown,
    leaf,
  };
}

function documentCompletionKey(completion: ActiveCompletion) {
  if (!("path" in completion) || typeof completion.path !== "string") {
    return null;
  }

  return [
    completion.path,
    completion.trigger,
    completion.triggerStart,
    completion.caret,
    completion.query,
  ].join(":");
}
