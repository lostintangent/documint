import { useCallback } from "react";
import { replaceTextRange, replaceTextRangeWithMention } from "@/editor";
import { useCompletions, type CompletionController } from "./useCompletions";
import { type ActiveCompletion, type CompletionItem, type CompletionSource } from "./completions";
import {
  resolveDocumentCompletionApplication,
  type DocumentCompletion,
} from "./document-completions";
import { documentCompletionValue, useEditorCommand, useStoreValue } from "../store";
import type { CompletionLeaf } from "../overlays/leaves/core/shared";

export type DocumentCompletionsController = {
  handleBeforeInput: CompletionController["handleBeforeInput"];
  handleKeyDown: CompletionController["handleKeyDown"];
  leaf: CompletionLeaf | null;
};

export function useDocumentCompletions({
  completionSources,
  enabled,
}: {
  completionSources: CompletionSource[] | undefined;
  enabled: boolean;
}): DocumentCompletionsController {
  const activeCompletion = useStoreValue(
    documentCompletionValue,
    enabled ? completionSources : undefined,
  );
  const replaceTextRangeWithMentionCommand = useEditorCommand(replaceTextRangeWithMention);
  const replaceTextRangeCommand = useEditorCommand(replaceTextRange);

  const acceptCompletion = useCallback(
    (item: CompletionItem, completion: DocumentCompletion) => {
      const documentCompletion = resolveDocumentCompletionApplication(item, completion);

      if (documentCompletion.kind === "mention") {
        replaceTextRangeWithMentionCommand(
          documentCompletion.target,
          documentCompletion.userId,
          documentCompletion.name,
          documentCompletion.trailingText,
        );
        return;
      }

      replaceTextRangeCommand(
        documentCompletion.startOffset,
        documentCompletion.endOffset,
        documentCompletion.text,
      );
    },
    [replaceTextRangeCommand, replaceTextRangeWithMentionCommand],
  );

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
            regionId: activeCompletion.regionId,
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
  if (!("regionId" in completion) || typeof completion.regionId !== "string") {
    return null;
  }

  return [
    completion.regionId,
    completion.trigger,
    completion.triggerStart,
    completion.caret,
    completion.query,
  ].join(":");
}
