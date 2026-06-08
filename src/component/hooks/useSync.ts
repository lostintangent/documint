import { useEffectEvent, useLayoutEffect, useRef } from "react";
import { createEditorState, type TextRangeTarget } from "@/editor";
import type { Document } from "@/document";
import { serializeDocument, type MarkdownOptions } from "@/markdown";
import { emitDiagnostic } from "../lib/diagnostics";
import { reconcileExternalContentChange, resolveMentionLineChange } from "../sync";
import type { DocumintStore, EditorStateTransition } from "../store";

export type UserMentionEvent = {
  lineMarkdown: string;
  lineNumber: number;
  userId: string;
};

export function useSync({
  content,
  contentDocument,
  markdownOptions,
  onContentChanged,
  onUserMentioned,
  resourceProtocolKey,
  store,
}: {
  content: string;
  contentDocument: Document;
  markdownOptions: MarkdownOptions;
  onContentChanged?: (content: string) => void;
  onUserMentioned?: (event: UserMentionEvent) => void;
  resourceProtocolKey: string;
  store: DocumintStore;
}) {
  /* Reconciliation bookkeeping */

  const lastEmittedContentRef = useRef(content);
  const lastReconciledMarkdownOptionsRef = useRef(markdownOptions);
  const lastReconciledResourceProtocolKeyRef = useRef(resourceProtocolKey);

  /* Local event emission */

  const emitContentChanged = useEffectEvent((transition: EditorStateTransition) => {
    // Emit the live runtime document, not the save-canonical commit document:
    // trimming or empty-document collapse during the host echo can destabilize
    // selection reconciliation, and comment anchors repair on their own path.
    const nextContent = serializeDocument(transition.next.documentIndex.document, markdownOptions);

    lastEmittedContentRef.current = nextContent;
    lastReconciledMarkdownOptionsRef.current = markdownOptions;
    lastReconciledResourceProtocolKeyRef.current = resourceProtocolKey;
    onContentChanged?.(nextContent);
  });

  const emitUserMentioned = useEffectEvent(
    ({
      target,
      transition,
      userId,
    }: {
      target: TextRangeTarget;
      transition: EditorStateTransition;
      userId: string;
    }) => {
      // TODO: replace this hook-specific payload plumbing with a typed
      // semantic effect once mention commands join the editor effect channel.
      const lineDiff = resolveMentionLineChange(transition, target);

      if (!lineDiff) {
        return;
      }

      const event: UserMentionEvent = {
        ...lineDiff,
        userId,
      };

      if (process.env.NODE_ENV !== "production") {
        emitDiagnostic("userMentioned", { ...event });
      }
      onUserMentioned?.(event);
    },
  );

  /* External content reconciliation */

  useLayoutEffect(() => {
    const resourceProtocolsChanged =
      resourceProtocolKey !== lastReconciledResourceProtocolKeyRef.current;
    const markdownOptionsChanged = markdownOptions !== lastReconciledMarkdownOptionsRef.current;
    const isEmittedContent = content === lastEmittedContentRef.current;

    if (isEmittedContent && !resourceProtocolsChanged && !markdownOptionsChanged) {
      return;
    }

    const previousState = store.editor.getState();
    const nextState = createEditorState(contentDocument);
    const reconciliation = reconcileExternalContentChange(previousState, nextState);
    store.editor.replace(reconciliation.state);
    lastEmittedContentRef.current = content;
    lastReconciledMarkdownOptionsRef.current = markdownOptions;
    lastReconciledResourceProtocolKeyRef.current = resourceProtocolKey;
  }, [content, contentDocument, markdownOptions, resourceProtocolKey, store]);

  /* Public API */

  return {
    emitContentChanged,
    emitUserMentioned,
  };
}
