import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createEditorState, type TextRangeTarget } from "@/editor";
import { findDocumentChanges, type Document } from "@/document";
import { serializeDocument, type MarkdownOptions } from "@/markdown";
import type { DocumentChangeEffect } from "@/renderer";
import { emitDiagnostic } from "../lib/diagnostics";
import {
  acknowledgeUnacknowledgedDocumentChanges,
  mergeUnacknowledgedDocumentChanges,
} from "./external-changes";
import type { UnacknowledgedDocumentChange } from "./external-changes";
import { reconcileExternalContentChange } from "./selection";
import { resolveMentionLineChange } from "./mention-event";
import type { DocumintStore, EditorStateTransition } from "../store";

export type UserMentionEvent = {
  lineMarkdown: string;
  lineNumber: number;
  userId: string;
};

type DocumentChangeState = {
  newChanges: readonly UnacknowledgedDocumentChange[];
  changes: readonly UnacknowledgedDocumentChange[];
};

const emptyDocumentChangeState: DocumentChangeState = {
  newChanges: [],
  changes: [],
};

export function useSync({
  content,
  contentDocument,
  markdownOptions,
  onContentChanged,
  onUserMentioned,
  resourceProtocolKey,
  showDiffs,
  store,
}: {
  content: string;
  contentDocument: Document;
  markdownOptions: MarkdownOptions;
  onContentChanged?: (content: string) => void;
  onUserMentioned?: (event: UserMentionEvent) => void;
  resourceProtocolKey: string;
  showDiffs: boolean;
  store: DocumintStore;
}) {
  /* Reconciliation bookkeeping */

  const lastReconciledContentRef = useRef(content);
  const lastReconciledMarkdownOptionsRef = useRef(markdownOptions);
  const lastReconciledResourceProtocolKeyRef = useRef(resourceProtocolKey);
  const [documentChangeState, setDocumentChangeState] = useState(emptyDocumentChangeState);

  /* Local event emission */

  const emitContentChanged = useEffectEvent((transition: EditorStateTransition) => {
    // Emit the live runtime document, not the save-canonical commit document:
    // trimming or empty-document collapse belongs at persistence boundaries,
    // while this callback describes the editor's current runtime shape.
    const nextContent = serializeDocument(transition.next.documentIndex.document, markdownOptions);
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

  /* Document change lifecycle */

  const applyExternalDocumentChanges = useEffectEvent(
    (
      previousState: EditorStateTransition["previous"],
      nextState: EditorStateTransition["next"],
    ) => {
      const changes = findDocumentChanges(
        previousState.documentIndex.document,
        nextState.documentIndex.document,
      );
      setDocumentChangeState((current) => {
        const merge = mergeUnacknowledgedDocumentChanges(current.changes, changes, nextState);
        return {
          newChanges: merge.newChanges,
          changes: merge.changes,
        };
      });
    },
  );

  const reconcileDocumentChanges = useEffectEvent((transition: EditorStateTransition) => {
    setDocumentChangeState((current) => {
      if (current.changes.length === 0) {
        return current;
      }

      const changes = acknowledgeUnacknowledgedDocumentChanges(current.changes, transition.next, {
        retarget: transition.documentChanged,
      });

      return changes === current.changes
        ? current
        : {
            newChanges: [],
            changes,
          };
    });
  });

  /* External content diffing */

  useEffect(() => {
    return store.editor.subscribe((transition) => {
      if (showDiffs && transition.source === "local") {
        // Local transitions can dismiss touched diff markers and retarget
        // surviving markers, but only while diff display is active.
        reconcileDocumentChanges(transition);
      }
    });
  }, [showDiffs, store]);

  useEffect(() => {
    if (showDiffs) return;

    // Turning diffs off is a host display policy, so drop any already-visible
    // diff lifecycle state instead of letting old markers linger.
    setDocumentChangeState((current) =>
      current.newChanges.length === 0 && current.changes.length === 0
        ? current
        : emptyDocumentChangeState,
    );
  }, [showDiffs]);

  /* External content reconciliation */

  useLayoutEffect(() => {
    const contentChanged = content !== lastReconciledContentRef.current;
    const markdownOptionsChanged = markdownOptions !== lastReconciledMarkdownOptionsRef.current;
    const resourceProtocolsChanged =
      resourceProtocolKey !== lastReconciledResourceProtocolKeyRef.current;

    if (!contentChanged && !markdownOptionsChanged && !resourceProtocolsChanged) {
      return;
    }

    const previousState = store.editor.getState();
    const nextState = createEditorState(contentDocument);
    const reconciliation = reconcileExternalContentChange(previousState, nextState);
    store.editor.replace(reconciliation.state);
    if (showDiffs && contentChanged) {
      applyExternalDocumentChanges(previousState, reconciliation.state);
    }
    lastReconciledContentRef.current = content;
    lastReconciledMarkdownOptionsRef.current = markdownOptions;
    lastReconciledResourceProtocolKeyRef.current = resourceProtocolKey;
  }, [content, contentDocument, markdownOptions, resourceProtocolKey, showDiffs, store]);

  const effects = useMemo(
    () => (showDiffs ? documentChangeState.newChanges.map(createDocumentChangeEffect) : []),
    [documentChangeState.newChanges, showDiffs],
  );
  const documentChanges = useMemo(
    () => (showDiffs ? documentChangeState.changes.map(createDocumentChangeFrameInput) : []),
    [documentChangeState.changes, showDiffs],
  );

  /* Public API */

  return {
    emitContentChanged,
    emitUserMentioned,
    documentChanges,
    effects,
  };
}

function createDocumentChangeFrameInput(change: UnacknowledgedDocumentChange) {
  return {
    changeKey: change.changeKey,
    changeKind: change.change.kind,
    target: change.editorTarget,
  };
}

function createDocumentChangeEffect(change: UnacknowledgedDocumentChange): DocumentChangeEffect {
  return {
    changeKey: change.changeKey,
    changeKind: change.change.kind,
    kind: "document-change",
    target: change.editorTarget,
  };
}
