import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createEditorState } from "@/editor";
import { findDocumentChanges, type Document, type DocumentChange } from "@/document";
import { serializeDocument, type MarkdownOptions } from "@/markdown";
import type { DocumentChangeEffect } from "@/renderer";
import { emitDiagnostic } from "../lib/diagnostics";
import {
  acknowledgeUnacknowledgedDocumentChanges,
  mergeUnacknowledgedDocumentChanges,
  type UnacknowledgedDocumentChange,
  type UnacknowledgedDocumentChangeMerge,
} from "./live-changes";
import { reconcileExternalContentChange, restoreEquivalentSelection } from "./selection";
import { resolveMentionLineChange } from "./mention-event";
import type { DocumentView } from "./useDocumentView";
import type { DocumintStore, EditorStateTransition } from "../store";

export type UserMentionEvent = {
  lineMarkdown: string;
  lineNumber: number;
  userId: string;
};

const emptyLiveChangeState: UnacknowledgedDocumentChangeMerge = {
  newChanges: [],
  changes: [],
};

export function useDocumentSync({
  content,
  documentView,
  editorDocument,
  markdownOptions,
  onContentChanged,
  onUserMentioned,
  store,
}: {
  content: string;
  documentView: DocumentView;
  editorDocument: Document;
  markdownOptions: MarkdownOptions;
  onContentChanged?: (content: string) => void;
  onUserMentioned?: (event: UserMentionEvent) => void;
  store: DocumintStore;
}) {
  /* Reconciliation bookkeeping */

  const lastReconciledRef = useRef({
    content,
    document: documentView.document,
    kind: documentView.kind,
  });
  const [liveChangeState, setLiveChangeState] = useState(emptyLiveChangeState);
  const showLiveDiffs = documentView.kind === "live" && documentView.showDiffs;

  /* Local event emission */

  const emitContentChanged = useEffectEvent((transition: EditorStateTransition) => {
    // Emit the live runtime document as-is, including trailing whitespace and
    // the caret paragraph of an empty document: this callback describes the
    // editor's current runtime shape.
    const nextContent = serializeDocument(transition.next.documentIndex.document, markdownOptions);
    onContentChanged?.(nextContent);
  });

  const emitUserMentioned = useEffectEvent(
    ({ transition, userId }: { transition: EditorStateTransition; userId: string }) => {
      // TODO: replace this hook-specific payload plumbing with a typed
      // semantic effect once mention commands join the editor effect channel.
      const event: UserMentionEvent = {
        ...resolveMentionLineChange(transition),
        userId,
      };

      if (process.env.NODE_ENV !== "production") {
        emitDiagnostic("userMentioned", { ...event });
      }
      onUserMentioned?.(event);
    },
  );

  /* Live change lifecycle */

  const recordLiveDocumentChanges = useEffectEvent(
    (
      previousState: EditorStateTransition["previous"],
      nextState: EditorStateTransition["next"],
    ) => {
      const changes = findDocumentChanges(
        previousState.documentIndex.document,
        nextState.documentIndex.document,
      );
      setLiveChangeState((current) =>
        mergeUnacknowledgedDocumentChanges(current.changes, changes, nextState),
      );
    },
  );

  const reconcileLiveDocumentChanges = useEffectEvent((transition: EditorStateTransition) => {
    setLiveChangeState((current) => {
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

  useEffect(() => {
    return store.editor.subscribe((transition) => {
      if (showLiveDiffs && transition.source === "local") {
        // Local transitions can dismiss touched diff markers and retarget
        // surviving markers, but only while diff display is active.
        reconcileLiveDocumentChanges(transition);
      }
    });
  }, [showLiveDiffs, store]);

  if (!showLiveDiffs) {
    // Turning diffs off is a host display policy, so drop any already-visible
    // diff lifecycle state instead of letting old markers linger.
    if (liveChangeState.newChanges.length > 0 || liveChangeState.changes.length > 0) {
      setLiveChangeState(emptyLiveChangeState);
    }
  }

  /* Document view reconciliation */

  useLayoutEffect(() => {
    const lastReconciled = lastReconciledRef.current;
    const contentChanged = content !== lastReconciled.content;
    const shouldReconcile =
      contentChanged ||
      documentView.document !== lastReconciled.document ||
      documentView.kind !== lastReconciled.kind;

    if (!shouldReconcile) {
      return;
    }

    const previousState = store.editor.getState();
    const nextState = createEditorState(documentView.document);
    const reconciledState =
      documentView.kind === "snapshot"
        ? (restoreEquivalentSelection(previousState, nextState) ?? nextState)
        : reconcileExternalContentChange(previousState, nextState);
    store.editor.replace(reconciledState);

    if (showLiveDiffs && contentChanged) {
      recordLiveDocumentChanges(previousState, reconciledState);
    }

    lastReconciledRef.current = {
      content,
      document: documentView.document,
      kind: documentView.kind,
    };
  }, [content, documentView.document, documentView.kind, showLiveDiffs, store]);

  const effects = useMemo(
    () => (showLiveDiffs ? liveChangeState.newChanges.map(createDocumentChangeEffect) : []),
    [liveChangeState.newChanges, showLiveDiffs],
  );
  let documentChanges: readonly DocumentChange[] = emptyLiveChangeState.changes;
  if (documentView.kind === "snapshot") {
    if (editorDocument.blocks === documentView.document.blocks) {
      documentChanges = documentView.changes;
    }
  } else if (showLiveDiffs) {
    documentChanges = liveChangeState.changes;
  }

  /* Public API */

  return {
    emitContentChanged,
    emitUserMentioned,
    documentChanges,
    effects,
  };
}

function createDocumentChangeEffect(change: UnacknowledgedDocumentChange): DocumentChangeEffect {
  return {
    changeKey: change.changeKey,
    kind: "document-change",
  };
}
