import { useEffectEvent, useLayoutEffect, useRef } from "react";
import { createEditorState, getDocument, type TextRangeTarget } from "@/editor";
import type { Document } from "@/document";
import { serializeDocument } from "@/markdown";
import { emitDiagnostic } from "../lib/diagnostics";
import { resolveDocumintPatch, type DocumintPatch } from "@/sync/content-patch";
import { resolveMentionLineChange } from "@/sync/mention-event";
import { reconcileExternalContentChange } from "@/sync/external-reconciliation";
import type { DocumintStore, EditorStateTransition } from "../store";

export type UserMentionEvent = {
  lineMarkdown: string;
  lineNumber: number;
  userId: string;
};

export function useSync({
  content,
  contentDocument,
  onContentChanged,
  onUserMentioned,
  resourceProtocolKey,
  revision,
  store,
}: {
  content: string;
  contentDocument: Document;
  onContentChanged?: (content: string, document: Document, patch: DocumintPatch | null) => void;
  onUserMentioned?: (event: UserMentionEvent) => void;
  resourceProtocolKey: string;
  revision?: string | null;
  store: DocumintStore;
}) {
  /* Reconciliation bookkeeping */

  const lastEmittedContentRef = useRef(content);
  const lastReconciledRevisionRef = useRef(revision ?? null);
  const lastReconciledResourceProtocolKeyRef = useRef(resourceProtocolKey);

  /* Local event emission */

  const emitContentChanged = useEffectEvent((transition: EditorStateTransition) => {
    const nextDocument = getDocument(transition.next);
    const baseRevision = lastReconciledRevisionRef.current;
    const patch = baseRevision !== null ? resolveDocumintPatch(transition, baseRevision) : null;
    const nextContent = patch ? lastEmittedContentRef.current : serializeDocument(nextDocument);

    if (!patch) {
      lastEmittedContentRef.current = nextContent;
    }
    lastReconciledResourceProtocolKeyRef.current = resourceProtocolKey;
    onContentChanged?.(nextContent, nextDocument, patch);
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
      // TODO: replace this hook-specific payload plumbing with a general
      // command-effect channel once editor commands can report semantic effects.
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
    const isEmittedContent = content === lastEmittedContentRef.current;

    if (isEmittedContent && !resourceProtocolsChanged) {
      lastEmittedContentRef.current = content;
      lastReconciledRevisionRef.current = revision ?? null;
      return;
    }

    const previousState = store.editor.getState();
    const nextState = createEditorState(contentDocument);
    const reconciliation = reconcileExternalContentChange(previousState, nextState);
    store.editor.replace(reconciliation.state);
    lastEmittedContentRef.current = content;
    lastReconciledRevisionRef.current = revision ?? null;
    lastReconciledResourceProtocolKeyRef.current = resourceProtocolKey;
  }, [content, contentDocument, revision, resourceProtocolKey, store]);

  /* Public API */

  return {
    emitContentChanged,
    emitUserMentioned,
  };
}
